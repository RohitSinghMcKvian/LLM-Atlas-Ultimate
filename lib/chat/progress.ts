/**
 * Did this tool round get anywhere?
 *
 * The no-progress halt in `build-budget.ts` is a good idea implemented against
 * the wrong signal. It asked "did this round write a file or move a task", and
 * called everything else barren — which made `web_search`, `github`,
 * `read_project_file`, `memory`, `skill` and every MCP connector tool count as
 * getting nowhere. Two rounds of that and the build stopped with "no file
 * written and no step completed". Research-then-build is the natural shape of an
 * end-to-end task, so the guard fired on exactly the runs it was meant to
 * protect.
 *
 * What actually separates a stuck run from a working one is **repetition**. A
 * model that reads the same file for the fourth time is stuck. A model that
 * searched, then read a repository, then wrote a file is not — even though two
 * of those three rounds wrote nothing.
 *
 * So three verdicts, and two counters downstream:
 *
 *  - **productive** — something changed. Resets both counters.
 *  - **informative** — nothing changed, but the model learned something it did
 *    not already know. Resets the barren streak; the unproductive streak keeps
 *    counting, so a run that only ever reads still terminates.
 *  - **barren** — errored, empty, or a repeat of a call already made this turn.
 *
 * Pure, and deliberately free of any tool imports: it reads names and argument
 * strings, which is all the loop has when a round completes.
 */

import type { StoredToolCall } from "./types";

export type RoundProgress = "productive" | "informative" | "barren";

/** A JSON field read out of a tool's arguments, tolerating a partial stream. */
function argOf(call: StoredToolCall, key: string): string | undefined {
  if (!call.arguments) return undefined;
  try {
    const parsed = JSON.parse(call.arguments) as Record<string, unknown>;
    const v = parsed[key];
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A result that reads as a failure or as nothing at all.
 *
 * Kept in step with the refusal prose in `tools.ts`. An errored call cannot be
 * progress in either direction — the model has learned only that its own request
 * was malformed, and rounds spent on that are the definition of stuck.
 */
function resultIsEmpty(call: StoredToolCall): boolean {
  const r = call.result;
  if (typeof r !== "string" || !r.trim()) return true;
  return /^(Unknown tool|Invalid arguments|Arguments for|Could not find|Tool "|Search unavailable|Web search is unavailable|No results found|The skill you are following|Connector tool|The workspace is unavailable|Nothing to)/i.test(
    r,
  );
}

/** Commands that only look at state. Everything else on these tools changes it. */
const READ_ONLY: Record<string, RegExp> = {
  workspace: /^(view|list|glob|grep)$/,
  tasks: /^(list|view)$/,
  artifact: /^(read|list)$/,
  memory: /^(view|list)$/,
};

/**
 * What one round accomplished, from the calls it made.
 *
 * The best verdict across the round wins: a round that read three files and
 * wrote one is productive. Judging by the worst call would let a model's habit
 * of re-reading its own output cancel out the work it did alongside it.
 */
export function classifyRound(calls: StoredToolCall[]): RoundProgress {
  let best: RoundProgress = "barren";
  for (const call of calls) {
    const verdict = classifyCall(call);
    if (verdict === "productive") return "productive";
    if (verdict === "informative") best = "informative";
  }
  return best;
}

export function classifyCall(call: StoredToolCall): RoundProgress {
  if (resultIsEmpty(call)) return "barren";

  const readOnly = READ_ONLY[call.name];
  if (readOnly) {
    const command = argOf(call, "command") ?? "";
    return readOnly.test(command) ? "informative" : "productive";
  }

  // Code execution is productive only when it ran. A traceback is the model
  // learning something — worth a round, not worth resetting the write counter.
  if (call.name === "run_python" || call.name === "run_command") {
    return /(^|\n)(exit code: 0\b|ok\b)/i.test(call.result ?? "") ? "productive" : "informative";
  }

  // Everything that reaches outside for information: search, GitHub, project
  // files, past chats, skills, and every connector tool. These are the calls the
  // old classifier treated as getting nowhere.
  return "informative";
}

/**
 * A stable identity for a call, so a repeat can be recognised.
 *
 * Arguments are re-serialised with sorted keys rather than compared raw, because
 * models re-emit the same request with the fields in a different order and with
 * different whitespace. Unparseable arguments fall back to the raw string: a
 * malformed call repeated verbatim is still a repeat.
 */
export function callSignature(call: StoredToolCall): string {
  const raw = call.arguments ?? "";
  try {
    return `${call.name}:${stableStringify(JSON.parse(raw))}`;
  } catch {
    return `${call.name}:${raw.trim()}`;
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

/** How many times one identical call may recur in a turn before it is a loop. */
export const LOOP_THRESHOLD = 3;

/**
 * Whether the call history contains a genuine loop.
 *
 * Counts total occurrences rather than consecutive ones. A model alternating
 * between two calls it has already made is as stuck as one repeating a single
 * call, and a consecutive-only rule would never catch it.
 */
export function isLooping(history: string[], threshold: number = LOOP_THRESHOLD): boolean {
  const counts = new Map<string, number>();
  for (const sig of history) {
    const n = (counts.get(sig) ?? 0) + 1;
    if (n >= threshold) return true;
    counts.set(sig, n);
  }
  return false;
}
