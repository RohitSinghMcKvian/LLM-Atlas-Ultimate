import { z } from "zod";
import { MCP_PROTOCOL_VERSION } from "./protocol";

/**
 * The server half of MCP.
 *
 * `lib/mcp/protocol.ts` makes Atlas an MCP *client*: it builds requests and
 * validates the responses a third-party server sends back. This is the mirror -
 * parsing requests other clients send to Atlas, and shaping the results.
 *
 * A separate module rather than an extension of that one, because the trust
 * direction is reversed. There, the untrusted input is a server's response;
 * here, it is a caller's request. Sharing one file would make it far too easy to
 * validate the wrong half. What they *do* share is the version constant and the
 * JSON-RPC envelope shape, so the two cannot drift on the wire.
 *
 * Pure: no fetch, no route handler, no Next types. The route is a dispatcher
 * over this.
 */

export const JSONRPC_VERSION = "2.0";

/** Standard JSON-RPC error codes, plus the one MCP adds. */
export const ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

const idSchema = z.union([z.string(), z.number(), z.null()]);

export const requestSchema = z.object({
  jsonrpc: z.literal(JSONRPC_VERSION),
  // Absent on a notification, which is a real and different thing: a
  // notification gets no response at all, and answering one is a protocol
  // violation that some clients treat as a fatal error.
  id: idSchema.optional(),
  method: z.string().min(1).max(120),
  params: z.unknown().optional(),
});

export type McpRequest = z.output<typeof requestSchema>;

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type ParsedRequest =
  | { ok: true; request: McpRequest; isNotification: boolean }
  | { ok: false; error: JsonRpcError; id: string | number | null };

/**
 * Parse one incoming message.
 *
 * Never throws. A malformed request has to come back as a JSON-RPC error with
 * the right code, because a client that receives an HTML error page or a raw
 * 500 cannot tell a bad request from a broken server.
 */
export function parseRequest(raw: unknown): ParsedRequest {
  const result = requestSchema.safeParse(raw);
  if (!result.success) {
    // Recover the id if it is there at all, so the client can match the error to
    // the call that caused it.
    const id =
      raw && typeof raw === "object" && "id" in raw
        ? ((raw as { id?: unknown }).id as string | number | null) ?? null
        : null;
    return {
      ok: false,
      error: { code: ERRORS.invalidRequest, message: "Not a valid JSON-RPC 2.0 request." },
      id: typeof id === "string" || typeof id === "number" ? id : null,
    };
  }
  return { ok: true, request: result.data, isNotification: result.data.id === undefined };
}

export function success(id: string | number | null, result: unknown) {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

export function failure(id: string | number | null, error: JsonRpcError) {
  return { jsonrpc: JSONRPC_VERSION, id, error };
}

export interface ServerInfo {
  name: string;
  version: string;
  instructions?: string;
}

export const ATLAS_SERVER_INFO: ServerInfo = {
  name: "llm-atlas",
  version: "1.0.0",
  instructions: [
    "Read-only access to the LLM Atlas catalog, knowledge graph, cost engine and news corpus.",
    "Use atlas_catalog and atlas_graph rather than recalling model specifications:",
    "the catalog changes weekly. Every benchmark score carries its source and the date it was measured.",
  ].join(" "),
};

/**
 * The `initialize` result.
 *
 * `tools: {}` declares the tools capability and nothing else. Atlas serves no
 * resources, prompts or sampling, and declaring a capability it does not
 * implement is how a client ends up calling a method that will always fail.
 */
export function initializeResult(info: ServerInfo = ATLAS_SERVER_INFO) {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: { name: info.name, version: info.version },
    ...(info.instructions ? { instructions: info.instructions } : {}),
  };
}

export interface ExposedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function toolsListResult(tools: readonly ExposedTool[]) {
  // No cursor: the exposed set is four tools and will not paginate. Emitting an
  // empty `nextCursor` would tell a client to ask for a second page that does
  // not exist.
  return { tools: tools.map((t) => ({ ...t, inputSchema: t.inputSchema })) };
}

export const MAX_TOOL_RESULT_CHARS = 24_000;

/**
 * A `tools/call` result.
 *
 * `isError: true` is how MCP reports a *tool* failure, as opposed to a protocol
 * failure - the distinction matters, because the first is something the model
 * can react to and the second is something the client has to handle.
 */
export function toolCallResult(text: string, isError = false) {
  const clipped =
    text.length > MAX_TOOL_RESULT_CHARS
      ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n(truncated)`
      : text;
  return { content: [{ type: "text", text: clipped }], isError };
}

export const callParamsSchema = z.object({
  name: z.string().min(1).max(120),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

export type CallParams = z.output<typeof callParamsSchema>;

/** Methods Atlas answers. Anything else is `methodNotFound`, never a silent success. */
export const SUPPORTED_METHODS = [
  "initialize",
  "notifications/initialized",
  "tools/list",
  "tools/call",
  "ping",
] as const;

export function isSupportedMethod(method: string): boolean {
  return (SUPPORTED_METHODS as readonly string[]).includes(method);
}
