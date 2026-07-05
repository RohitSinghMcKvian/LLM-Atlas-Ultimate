"use client";

// Tool policy + hooks for the Atlas Code agent (§6 Phase 6) — the browser-side
// analogue of Claude Code permissions and hooks:
//
//  - ToolPolicy: per-tool allow / ask / deny. "ask" pauses the run and waits
//    for the user to approve the specific call; "deny" refuses it outright
//    (the refusal is fed back to the model so it can adapt).
//  - Hooks: user-defined rules evaluated around tool calls.
//      pre  — regex over the call's raw JSON args; a match BLOCKS the call.
//      post — after a matching tool succeeds, run a shell command in the
//             workspace; its output is appended to the tool result the model
//             sees (so e.g. "npm test after every edit" feeds failures back
//             into the loop immediately).

export type PolicyDecision = "allow" | "ask" | "deny";

/** toolName → decision. Tools absent from the map default to "allow". */
export type ToolPolicy = Record<string, PolicyDecision>;

export interface Hook {
  id: string;
  enabled: boolean;
  event: "pre" | "post";
  /** Regex matched against the tool name, e.g. "write_file|edit_file" or ".*" */
  toolMatch: string;
  /** pre only: regex tested against the raw JSON arguments; match ⇒ block. */
  pattern?: string;
  /** post only: shell command to run in the workspace after the tool succeeds. */
  run?: string;
}

/** Every tool the policy dialog lists, in display order. */
export const POLICY_TOOLS = [
  "read_file",
  "list_files",
  "write_file",
  "edit_file",
  "delete_file",
  "run_command",
  "run_python",
  "spawn_subagent",
] as const;

export const DEFAULT_POLICY: ToolPolicy = Object.fromEntries(
  POLICY_TOOLS.map((t) => [t, "allow" as PolicyDecision]),
);

export const DEFAULT_HOOKS: Hook[] = [
  {
    id: "guard-destructive",
    enabled: true,
    event: "pre",
    toolMatch: "run_command",
    pattern: "rm\\s+-rf|--force|curl[^|]*\\|\\s*(?:ba)?sh|wget[^|]*\\|\\s*(?:ba)?sh",
  },
  // A.3 anti-cheat guards: never delete a failing test to go green, never
  // silence errors with an empty catch.
  {
    id: "guard-test-deletion",
    enabled: true,
    event: "pre",
    toolMatch: "delete_file",
    pattern: "\\.(test|spec)\\.[jt]sx?|(^|[\\\\/\"])test[s]?\\.js|_test\\.py|test_[^\"]*\\.py",
  },
  {
    id: "guard-empty-catch",
    enabled: true,
    event: "pre",
    toolMatch: "write_file|edit_file",
    pattern: "catch\\s*(\\\\n|\\s)*(\\([^)]*\\))?(\\\\n|\\s)*\\{(\\\\n|\\s)*\\}",
  },
  {
    id: "test-after-edit",
    enabled: false,
    event: "post",
    toolMatch: "write_file|edit_file",
    run: "npm test",
  },
];

function safeRegex(src: string): RegExp | null {
  try {
    return new RegExp(src, "i");
  } catch {
    return null;
  }
}

export function policyFor(policy: ToolPolicy | undefined, tool: string): PolicyDecision {
  return policy?.[tool] ?? "allow";
}

/** First enabled pre-hook that blocks this call, or null. */
export function matchPreHook(hooks: Hook[] | undefined, tool: string, argsJson: string): Hook | null {
  for (const h of hooks ?? []) {
    if (!h.enabled || h.event !== "pre" || !h.pattern) continue;
    const toolRe = safeRegex(`^(${h.toolMatch})$`);
    if (!toolRe?.test(tool)) continue;
    if (safeRegex(h.pattern)?.test(argsJson)) return h;
  }
  return null;
}

/** All enabled post-hooks whose toolMatch covers this tool. */
export function matchPostHooks(hooks: Hook[] | undefined, tool: string): Hook[] {
  return (hooks ?? []).filter((h) => {
    if (!h.enabled || h.event !== "post" || !h.run?.trim()) return false;
    return safeRegex(`^(${h.toolMatch})$`)?.test(tool) ?? false;
  });
}

/** Human summary for the hooks list UI. */
export function describeHook(h: Hook): string {
  return h.event === "pre"
    ? `block ${h.toolMatch} when args match /${h.pattern ?? ""}/`
    : `after ${h.toolMatch} → run "${h.run ?? ""}"`;
}
