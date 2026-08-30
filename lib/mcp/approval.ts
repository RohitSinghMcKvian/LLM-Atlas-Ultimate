import { parseToolName } from "./protocol";

/**
 * Approval policy for connector tool calls (spec §4, Connectors).
 *
 * An MCP tool call is a side effect on a third-party system, requested by a model,
 * from arguments the model wrote. That is categorically different from
 * `web_search` or reading a project file, and it is why nothing here auto-runs by
 * default.
 *
 * Three deliberate properties:
 *
 *  1. **Default is `ask`.** Not configurable to something looser at install time —
 *     a connector cannot arrive pre-approved, and neither can a tool it adds later.
 *  2. **Remembering is per TOOL, not per connector.** Approving
 *     `create_calendar_event` must not also approve `delete_calendar`. A
 *     connector-wide "always allow" would make the first approval a blank cheque
 *     for every tool the server ever adds.
 *  3. **The server's `readOnlyHint` never grants anything.** It is a claim made by
 *     the party being authorised, so it may inform what the prompt *says* but must
 *     not decide what runs. Treating it as a grant would let a connector
 *     self-certify its way past the gate.
 *
 * Pure: the decision function takes state and returns a decision. Storage and the
 * prompt live elsewhere.
 */

export type ApprovalRule = "ask" | "always" | "never";
export type ApprovalDecision = "allow" | "deny" | "ask";

/** Rules keyed by the namespaced tool name (`mcp__<connector>__<tool>`). */
export type ApprovalPolicy = Record<string, ApprovalRule>;

export const DEFAULT_RULE: ApprovalRule = "ask";

/**
 * What to do about one call.
 *
 * A name that is not a connector tool returns `allow`: built-in tools are gated
 * by their own toggles, and routing them through connector approval would prompt
 * for things like `web_search` that the user already opted into.
 */
export function decideApproval(
  policy: ApprovalPolicy,
  toolName: string,
): ApprovalDecision {
  if (!parseToolName(toolName)) return "allow";
  switch (policy[toolName] ?? DEFAULT_RULE) {
    case "always":
      return "allow";
    case "never":
      return "deny";
    default:
      return "ask";
  }
}

/** Record a remembered choice. `ask` clears the entry rather than storing it. */
export function setRule(
  policy: ApprovalPolicy,
  toolName: string,
  rule: ApprovalRule,
): ApprovalPolicy {
  const next = { ...policy };
  if (rule === "ask") delete next[toolName];
  else next[toolName] = rule;
  return next;
}

/**
 * Drop every rule belonging to a connector.
 *
 * Called when a connector is removed, so reinstalling it later starts from `ask`
 * again. Without this, a stale "always" would silently apply to a server the user
 * had explicitly disconnected — and possibly to a different server that happened
 * to reuse the id.
 */
export function clearConnectorRules(
  policy: ApprovalPolicy,
  connectorId: string,
): ApprovalPolicy {
  const next: ApprovalPolicy = {};
  for (const [name, rule] of Object.entries(policy)) {
    if (parseToolName(name)?.connectorId !== connectorId) next[name] = rule;
  }
  return next;
}

export interface PendingApproval {
  /**
   * Where the call came from.
   *
   * Absent means a connector, which is all this gate covered when it was
   * written. Atlas's own write tools now go through the same prompt rather than
   * a second one beside it: two approval dialogs that look different and mean
   * the same thing is how a person learns to click past both.
   */
  surface?: "connector" | "atlas";
  /** Namespaced tool name. */
  toolName: string;
  connectorId: string;
  /** Connector's display name, so the prompt names a server not an id. */
  connectorName: string;
  /** Bare tool name as the server defines it. */
  tool: string;
  description: string;
  /** Arguments the model produced, pretty-printed for review. */
  args: string;
  /** The server's own read-only claim. Shown as a claim, never acted on. */
  readOnlyHint?: boolean;
}

/**
 * Format tool arguments for a human to read before approving.
 *
 * Approval is meaningless if the user cannot see what they are approving, so this
 * favours legibility over compactness — but it is still capped, because a model
 * can produce an argument blob long enough to push the actual operation off the
 * top of a dialog.
 */
export const MAX_ARGS_PREVIEW_CHARS = 4_000;

export function formatArgsForReview(raw: string): string {
  const text = raw.trim();
  if (!text || text === "{}") return "(no arguments)";
  let out: string;
  try {
    out = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // Unparseable arguments are shown as-is. The call would fail anyway, and
    // hiding them would hide the evidence of why.
    out = text;
  }
  return out.length > MAX_ARGS_PREVIEW_CHARS
    ? `${out.slice(0, MAX_ARGS_PREVIEW_CHARS)}\n…truncated (${out.length} chars)`
    : out;
}

/** The tool result returned when a call is refused, in the model's own terms. */
export function deniedResult(toolName: string): { content: string; isError: true } {
  return {
    content:
      `The user declined the "${toolName}" call. Do not retry it. ` +
      "Continue without it, or explain what you would need them to approve and why.",
    isError: true,
  };
}
