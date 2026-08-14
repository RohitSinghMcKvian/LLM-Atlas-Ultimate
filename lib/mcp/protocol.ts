import { z } from "zod";

/**
 * Model Context Protocol wire layer (spec §4, Connectors / MCP).
 *
 * MCP is JSON-RPC 2.0 over a transport. Atlas speaks only the **Streamable HTTP**
 * transport, because the other one in the spec — stdio — means spawning a local
 * process, which a browser cannot do and which §1.7's free-tier constraint rules
 * out doing on the server. A connector is therefore always a URL.
 *
 * Everything here is pure: request builders, response parsing, and the mapping
 * from MCP's content blocks to the flat string a tool result has to be. No fetch,
 * no storage, no React — so the parsing of untrusted server responses, which is
 * the part that has to be right, is testable in Node.
 *
 * Responses are Zod-validated rather than cast. A connector is a third party: its
 * response is untrusted input, and `as McpToolsListResult` would turn a malformed
 * payload into a crash somewhere far from the cause.
 */

export const JSONRPC_VERSION = "2.0";

/**
 * Protocol version Atlas implements.
 *
 * **Inference label:** pinned to a published revision. A server that negotiates a
 * different one still works — `initialize` returns the version it chose and Atlas
 * records it — but Atlas does not adapt its behaviour per version, so a future
 * revision with breaking semantics would need code, not configuration.
 */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

export const CLIENT_INFO = { name: "atlas-chat", version: "1.0.0" } as const;

// ── requests ────────────────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: typeof JSONRPC_VERSION;
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

let nextId = 1;

/** Monotonic request ids. Reset between clients is unnecessary — only uniqueness matters. */
export function newRequestId(): number {
  return nextId++;
}

/** Test seam so id-sensitive assertions don't depend on execution order. */
export function resetRequestIds(): void {
  nextId = 1;
}

export function initializeRequest(): JsonRpcRequest {
  return {
    jsonrpc: JSONRPC_VERSION,
    id: newRequestId(),
    method: "initialize",
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      // Atlas consumes tools; it does not expose sampling or roots back to the
      // server. Declaring capabilities it does not have would invite calls it
      // cannot answer.
      capabilities: {},
      clientInfo: CLIENT_INFO,
    },
  };
}

export function toolsListRequest(cursor?: string): JsonRpcRequest {
  return {
    jsonrpc: JSONRPC_VERSION,
    id: newRequestId(),
    method: "tools/list",
    ...(cursor ? { params: { cursor } } : {}),
  };
}

export function toolsCallRequest(name: string, args: unknown): JsonRpcRequest {
  return {
    jsonrpc: JSONRPC_VERSION,
    id: newRequestId(),
    method: "tools/call",
    params: { name, arguments: args ?? {} },
  };
}

// ── responses ───────────────────────────────────────────────────────────────

const jsonRpcError = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional(),
});

const jsonRpcEnvelope = z.object({
  jsonrpc: z.literal(JSONRPC_VERSION),
  id: z.union([z.number(), z.string(), z.null()]).optional(),
  result: z.unknown().optional(),
  error: jsonRpcError.optional(),
});

export const initializeResult = z.object({
  protocolVersion: z.string(),
  capabilities: z.record(z.string(), z.unknown()).default({}),
  serverInfo: z
    .object({ name: z.string().default(""), version: z.string().default("") })
    .default({ name: "", version: "" }),
  instructions: z.string().optional(),
});
export type InitializeResult = z.infer<typeof initializeResult>;

export const mcpTool = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  description: z.string().default(""),
  // The server's own JSON Schema, passed to the model unchanged. Atlas does not
  // rewrite it: a schema it "fixed" would no longer describe what the server
  // will accept.
  inputSchema: z.record(z.string(), z.unknown()).default({ type: "object" }),
  annotations: z
    .object({
      title: z.string().optional(),
      /** Server's claim that the tool does not mutate. A HINT, never a grant. */
      readOnlyHint: z.boolean().optional(),
      destructiveHint: z.boolean().optional(),
      idempotentHint: z.boolean().optional(),
      openWorldHint: z.boolean().optional(),
    })
    .optional(),
});
export type McpTool = z.infer<typeof mcpTool>;

export const toolsListResult = z.object({
  tools: z.array(mcpTool),
  nextCursor: z.string().optional(),
});

/**
 * A tool result's content blocks.
 *
 * Unknown block types are kept rather than rejected — MCP adds block kinds over
 * time, and a server returning an audio block should not fail the whole call.
 * `flattenContent` decides what a block contributes to the text.
 */
const contentBlock = z.looseObject({ type: z.string() });

export const toolsCallResult = z.object({
  content: z.array(contentBlock).default([]),
  structuredContent: z.unknown().optional(),
  /** The server reporting that the TOOL failed, distinct from a protocol error. */
  isError: z.boolean().default(false),
});
export type ToolsCallResult = z.infer<typeof toolsCallResult>;

export interface McpFailure {
  error: string;
  /** JSON-RPC error code when the failure came from the protocol layer. */
  code?: number;
}

export function isFailure<T>(r: T | McpFailure): r is McpFailure {
  return typeof r === "object" && r !== null && "error" in r;
}

/**
 * Pull a typed result out of a JSON-RPC envelope.
 *
 * Three distinct outcomes are kept distinct, because they call for different
 * handling: a malformed envelope (the endpoint is not an MCP server), a JSON-RPC
 * error (the server refused), and a result whose shape does not match (the server
 * is speaking a dialect Atlas does not).
 */
export function parseResponse<S extends z.ZodType>(
  raw: unknown,
  schema: S,
): z.infer<S> | McpFailure {
  const env = jsonRpcEnvelope.safeParse(raw);
  if (!env.success) {
    return { error: "Response was not valid JSON-RPC 2.0." };
  }
  if (env.data.error) {
    return { error: env.data.error.message, code: env.data.error.code };
  }
  if (env.data.result === undefined) {
    return { error: "Response carried neither a result nor an error." };
  }
  const parsed = schema.safeParse(env.data.result);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      error: `Unexpected result shape: ${issue.path.join(".") || "(root)"} ${issue.message}`,
    };
  }
  return parsed.data;
}

/**
 * The Streamable HTTP transport may answer with SSE instead of plain JSON.
 *
 * Only the LAST `data:` payload that parses as a JSON-RPC envelope is returned —
 * a server may emit progress notifications before the response, and taking the
 * first would hand back a notification as if it were the answer.
 */
export function parseSseBody(body: string): unknown | null {
  let found: unknown = null;
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const obj = JSON.parse(payload);
      if (obj && typeof obj === "object" && "jsonrpc" in obj) found = obj;
    } catch {
      /* a partial or non-JSON data line is not fatal; keep scanning */
    }
  }
  return found;
}

/** Parse an MCP HTTP body, whichever of the two forms it takes. */
export function parseTransportBody(contentType: string, body: string): unknown | null {
  if (contentType.includes("text/event-stream")) return parseSseBody(body);
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

// ── content flattening ──────────────────────────────────────────────────────

/** How much of one tool result may reach the model. */
export const MAX_RESULT_CHARS = 24_000;

/**
 * Turn MCP content blocks into the single string a tool result must be.
 *
 * Images and audio are named, not embedded: a base64 payload inlined into a tool
 * message would blow the context window for a model that mostly cannot read it
 * there anyway. Resource links keep their URI, since that is the actionable part.
 */
export function flattenContent(result: ToolsCallResult): string {
  const parts: string[] = [];
  for (const block of result.content) {
    switch (block.type) {
      case "text":
        if (typeof block.text === "string") parts.push(block.text);
        break;
      case "image":
        parts.push(`[image omitted: ${String(block.mimeType ?? "unknown type")}]`);
        break;
      case "audio":
        parts.push(`[audio omitted: ${String(block.mimeType ?? "unknown type")}]`);
        break;
      case "resource_link":
        parts.push(`[resource: ${String(block.uri ?? "")}]`);
        break;
      case "resource": {
        const r = block.resource as { text?: string; uri?: string } | undefined;
        if (typeof r?.text === "string") parts.push(r.text);
        else if (r?.uri) parts.push(`[resource: ${r.uri}]`);
        break;
      }
      default:
        parts.push(`[${block.type} content omitted]`);
    }
  }
  // Some servers answer only with structuredContent and an empty content array.
  if (parts.length === 0 && result.structuredContent !== undefined) {
    try {
      parts.push(JSON.stringify(result.structuredContent));
    } catch {
      /* circular or otherwise unserialisable — fall through to the empty case */
    }
  }
  const text = parts.join("\n").trim();
  if (!text) return "The tool returned no content.";
  return text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}\n…truncated (${text.length} chars)`
    : text;
}

// ── tool namespacing ────────────────────────────────────────────────────────

/**
 * Prefix separating a connector's tools from Atlas's own.
 *
 * Without it, a connector could ship a tool called `web_search` or `memory` and
 * shadow a built-in — which is not a naming inconvenience but a way for a third
 * party to intercept calls the user believes are local. The separator is a
 * double underscore so it cannot occur by accident in a normal tool name.
 */
export const MCP_TOOL_PREFIX = "mcp__";
const SEPARATOR = "__";

export function namespacedToolName(connectorId: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${connectorId}${SEPARATOR}${toolName}`;
}

/** Split a namespaced name back apart, or null if it isn't one. */
export function parseToolName(
  name: string,
): { connectorId: string; toolName: string } | null {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return null;
  const rest = name.slice(MCP_TOOL_PREFIX.length);
  const at = rest.indexOf(SEPARATOR);
  if (at <= 0) return null;
  const connectorId = rest.slice(0, at);
  const toolName = rest.slice(at + SEPARATOR.length);
  if (!connectorId || !toolName) return null;
  return { connectorId, toolName };
}

export function isMcpToolName(name: string): boolean {
  return parseToolName(name) !== null;
}
