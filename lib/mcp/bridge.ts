import type { ToolDef } from "@/lib/router";
import {
  MCP_TOOL_PREFIX,
  namespacedToolName,
  parseToolName,
  type McpTool,
} from "./protocol";
import {
  decideApproval,
  deniedResult,
  formatArgsForReview,
  type ApprovalPolicy,
  type PendingApproval,
} from "./approval";

/**
 * Bridge between connectors and Atlas's tool layer.
 *
 * Turns discovered MCP tools into the wire definitions the router sends, and runs
 * a call through the approval gate before it reaches the network. Pure and
 * dependency-injected: the caller supplies how to ask the user and how to make
 * the call, so the gate — the part that must not be bypassable — is testable
 * without IndexedDB, a server, or a React tree.
 */

/** What the bridge needs to know about a connector. No credential material. */
export interface BridgeConnector {
  id: string;
  name: string;
  enabled: boolean;
  tools: McpTool[];
  approvals: ApprovalPolicy;
}

/** Cap on how many connector tools may be offered in one turn. */
export const MAX_CONNECTOR_TOOLS = 64;

/**
 * Wire definitions for every enabled connector's tools.
 *
 * Names are namespaced (`mcp__<connector>__<tool>`) so a connector cannot ship a
 * tool called `web_search` and shadow the built-in — which would let a third
 * party intercept calls the user believes are local.
 *
 * The description is prefixed with the connector's name because the model sees
 * only a flat tool list: without it, "Delete a record" gives no clue *whose*
 * record, and the model cannot reason about which system it is acting on.
 *
 * The schema is passed through unchanged. Atlas does not "fix" a server's schema
 * — a rewritten one would no longer describe what the server accepts.
 */
export function connectorToolDefs(connectors: BridgeConnector[]): ToolDef[] {
  const defs: ToolDef[] = [];
  for (const c of connectors) {
    if (!c.enabled) continue;
    for (const t of c.tools) {
      if (defs.length >= MAX_CONNECTOR_TOOLS) return defs;
      // A tool the user has permanently refused is not offered at all. Listing it
      // only invites a call that will be denied, and burns a round doing so.
      const name = namespacedToolName(c.id, t.name);
      if (c.approvals[name] === "never") continue;
      defs.push({
        type: "function",
        function: {
          name,
          description: `[${c.name}] ${t.description || t.title || t.name}`.slice(0, 1024),
          parameters: t.inputSchema as Record<string, unknown>,
        },
      });
    }
  }
  return defs;
}

/** Find the connector and tool behind a namespaced name. */
export function resolveTool(
  connectors: BridgeConnector[],
  namespaced: string,
): { connector: BridgeConnector; tool: McpTool } | null {
  const parsed = parseToolName(namespaced);
  if (!parsed) return null;
  const connector = connectors.find((c) => c.id === parsed.connectorId);
  if (!connector) return null;
  const tool = connector.tools.find((t) => t.name === parsed.toolName);
  if (!tool) return null;
  return { connector, tool };
}

export interface McpCallDeps {
  connectors: BridgeConnector[];
  /**
   * Ask the user. Resolves true to run the call, false to refuse. The caller is
   * responsible for also persisting an "always"/"never" choice.
   */
  requestApproval: (pending: PendingApproval) => Promise<boolean>;
  /** Perform the call once approved. */
  invoke: (
    connector: BridgeConnector,
    toolName: string,
    args: unknown,
  ) => Promise<{ content: string; isError: boolean }>;
}

export interface McpCallResult {
  content: string;
  isError?: boolean;
}

/**
 * Run one connector tool call, through the gate.
 *
 * Order matters and is the whole point: resolve, then **decide approval, then
 * parse arguments, then invoke**. Approval is checked before the arguments are
 * even parsed, so no code path reaches `invoke` without having passed the gate,
 * and a malformed-argument error cannot short-circuit past it.
 */
export async function runMcpTool(
  namespaced: string,
  rawArguments: string,
  deps: McpCallDeps,
): Promise<McpCallResult> {
  const resolved = resolveTool(deps.connectors, namespaced);
  if (!resolved) {
    return {
      content: `No connector tool named "${namespaced}". The connector may have been removed or disabled.`,
      isError: true,
    };
  }
  const { connector, tool } = resolved;
  if (!connector.enabled) {
    return { content: `The "${connector.name}" connector is disabled.`, isError: true };
  }

  const decision = decideApproval(connector.approvals, namespaced);
  if (decision === "deny") return deniedResult(namespaced);
  if (decision === "ask") {
    const approved = await deps.requestApproval({
      toolName: namespaced,
      connectorId: connector.id,
      connectorName: connector.name,
      tool: tool.name,
      description: tool.description || tool.title || tool.name,
      args: formatArgsForReview(rawArguments),
      readOnlyHint: tool.annotations?.readOnlyHint,
    });
    if (!approved) return deniedResult(namespaced);
  }

  let args: unknown;
  try {
    args = rawArguments.trim() ? JSON.parse(rawArguments) : {};
  } catch {
    return {
      content: `Arguments for "${namespaced}" were not valid JSON. Send a JSON object matching the schema.`,
      isError: true,
    };
  }

  const result = await deps.invoke(connector, tool.name, args);
  return { content: result.content, isError: result.isError || undefined };
}

/** Summary line for the system prompt, so the model knows what is connected. */
export function connectorsIndexBlock(connectors: BridgeConnector[]): string {
  const enabled = connectors.filter((c) => c.enabled && c.tools.length > 0);
  if (enabled.length === 0) return "";
  const lines = enabled.map((c) => `- ${c.name}: ${c.tools.length} tool(s)`);
  return (
    "Connected external services. Their tools are prefixed " +
    `\`${MCP_TOOL_PREFIX}\` and act on the user's real accounts, so the user is asked ` +
    "to approve each call. Prefer a built-in tool when it can answer the question, " +
    "and say what you intend to do before calling one of these.\n" +
    lines.join("\n")
  );
}
