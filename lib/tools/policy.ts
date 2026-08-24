import {
  DEFAULT_RULE,
  decideApproval,
  setRule,
  type ApprovalDecision,
  type ApprovalPolicy,
  type ApprovalRule,
} from "@/lib/mcp/approval";
import { isMcpToolName } from "@/lib/mcp/protocol";
import { classify, needsApproval } from "./spec";

/**
 * One approval gate for every tool that can change something.
 *
 * `lib/mcp/approval.ts` got this right for connector tools and this generalises
 * it rather than replacing it: the three properties that made it right are the
 * three that carry over.
 *
 *  1. **Default is `ask`.** Nothing arrives pre-approved, and a tool added later
 *     is not covered by a choice made earlier.
 *  2. **Memory is per TOOL.** Approving `atlas_prompt` must not also approve
 *     `atlas_bench`; approving a bench run must not approve a compare fan-out.
 *     A surface-wide "always allow" would make the first yes a blank cheque for
 *     everything Atlas ever adds to that surface.
 *  3. **A self-declared hint never grants anything.** `classify()` treats an
 *     unknown tool as a write for exactly this reason.
 *
 * It deliberately does *not* change `decideApproval`, whose own tests pin the
 * connector behaviour. Connector names are delegated to it unchanged; everything
 * else is decided here.
 */

export type { ApprovalDecision, ApprovalPolicy, ApprovalRule };
export { DEFAULT_RULE };

/**
 * What to do about one call.
 *
 * Read and network tools are allowed outright - see `needsApproval` for why
 * prompting on a tool the user already enabled by toggle is worse than not
 * prompting. Everything else consults the policy, defaulting to `ask`.
 */
export function decideToolApproval(policy: ApprovalPolicy, name: string): ApprovalDecision {
  // Connector tools keep their existing path exactly, including the "a tool the
  // user permanently refused is never offered" behaviour in `connectorToolDefs`.
  if (isMcpToolName(name)) return decideApproval(policy, name);
  if (!needsApproval(name)) return "allow";
  switch (policy[name] ?? DEFAULT_RULE) {
    case "always":
      return "allow";
    case "never":
      return "deny";
    default:
      return "ask";
  }
}

/** Record a remembered choice. `ask` clears the entry rather than storing it. */
export function setToolRule(
  policy: ApprovalPolicy,
  name: string,
  rule: ApprovalRule,
): ApprovalPolicy {
  return setRule(policy, name, rule);
}

/** Tool names the user has permanently refused, so they are never offered. */
export function refusedTools(policy: ApprovalPolicy): string[] {
  return Object.keys(policy)
    .filter((name) => policy[name] === "never")
    .sort();
}

/**
 * Drop a tool from the offered set when the user has said never.
 *
 * Offering it anyway costs a round to discover a refusal that was already
 * decided - the same reasoning `connectorToolDefs` applies to connector tools,
 * applied to the rest.
 */
export function offerable(policy: ApprovalPolicy, names: readonly string[]): string[] {
  return names.filter((n) => decideToolApproval(policy, n) !== "deny");
}

export interface PendingToolApproval {
  name: string;
  title: string;
  /** What running it would do, in one word the prompt can use. */
  sideEffect: string;
  /** Arguments as the model wrote them, for review. */
  args: string;
}

export function describePending(name: string, args: string): PendingToolApproval {
  const c = classify(name);
  return { name, title: c.title, sideEffect: c.sideEffect, args };
}

/**
 * What the model is told when a call is refused.
 *
 * Phrased so the model can act on it: a refusal is a fact about this turn, not
 * an error to retry, and saying so stops it burning rounds calling the same
 * tool again with slightly different arguments.
 */
export function deniedToolResult(name: string): { content: string; isError: true } {
  return {
    content: `The user declined the ${name} call. Do not call it again this turn. Say what you would have done and continue without it.`,
    isError: true,
  };
}
