/**
 * Keeping a long build's request from growing without bound.
 *
 * `runToolLoop` appends every assistant `tool_calls` message and every
 * `role:"tool"` result to one array and re-sends all of it on every round. One
 * `run_python` result is capped at 24k characters; `workspace view` returns whole
 * files. So round fifteen's request contains rounds one to fourteen in full, and
 * a build that is going well is the one most likely to die of it.
 *
 * That — not the round counter, not the dollar ceiling — is the real limit on
 * how long a build can run, and measuring it more honestly does not raise it.
 * This lowers it.
 *
 * The rules are conservative in the two places where being clever would break a
 * provider, and aggressive in the one place where it pays:
 *
 *  - **Nothing is ever removed.** A `role:"tool"` with no matching `tool_calls`,
 *    or a `tool_calls` with no results, is a 400 from every provider that
 *    validates. A stub replaces *content*; the message and its `tool_call_id`
 *    stay exactly where they were.
 *  - **Nothing before the boundary is touched.** That is the system prompt and
 *    the conversation history — the caller's, not the loop's.
 *  - **The newest round is never stubbed.** The model has not answered it yet.
 *
 * Pure, and idempotent, which is what makes it safe to apply in place.
 */

/** The subset of `LoopMessage` this needs. Structural, so the loop's type fits. */
export interface TrimMessage {
  role: string;
  content: unknown;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface TrimPolicy {
  /** Rounds kept verbatim, counting back from the newest. */
  keepRounds: number;
  /** Results shorter than this are left alone even when old. */
  maxResultChars: number;
  /** Ceiling for the whole loop-owned transcript. */
  maxTotalChars: number;
}

/**
 * Three rounds of full detail is what a model needs to fix what it just broke;
 * older results it can re-fetch. 60k characters is roughly 15k tokens of tool
 * traffic, which leaves room for the system prompt, the history and an answer
 * inside a 128k window.
 *
 * This is the **fallback**, for a model whose window is unknown. Prefer
 * `trimPolicyFor` — see the note on `TRANSCRIPT_SHARE` for why a constant here
 * is actively harmful on a large model.
 */
export const DEFAULT_TRIM: TrimPolicy = {
  keepRounds: 3,
  maxResultChars: 2_000,
  maxTotalChars: 60_000,
};

/** The estimator used everywhere in this codebase. Kept in step with `health.ts`. */
const CHARS_PER_TOKEN = 4;

/**
 * Share of the model's window the loop's own transcript may occupy.
 *
 * The rest pays for the system prompt (up to 24k characters), the conversation
 * history, and an answer that can be 32k tokens on its own. A quarter is
 * comfortable at every window size and is roughly double what the flat 60k gave
 * a 128k model — which was itself conservative.
 */
export const TRANSCRIPT_SHARE = 0.25;

/** Below this, stubbing is pointless: the stub is a meaningful fraction of it. */
export const MIN_TOTAL_CHARS = 20_000;

/**
 * Ceiling regardless of window, because past this point **money** binds before
 * context does.
 *
 * The loop re-sends its whole transcript every round. Twenty rounds against a
 * 400k-character transcript is 100k tokens re-sent twenty times — 2M input
 * tokens, which is $1 on Nemotron 3 Ultra's $0.50/M and half the default build
 * budget. Letting it scale freely with a 1M window would spend the entire
 * ceiling on re-transmission and leave nothing to finish the build with, on a
 * model whose `caching` capability is false so none of it is discounted.
 */
export const MAX_TOTAL_CHARS = 400_000;

/**
 * The trim policy for a specific model.
 *
 * **This function is the fix for the defect that made long builds impossible.**
 * Every constant above was chosen for a 128k window, and an absolute budget that
 * is prudent at 128k is destructive at 1M: a 64k-character transcript is half
 * the window on one model and 1.6% of it on the other, and trimming it in the
 * second case throws away work the model had ample room to remember. The agent's
 * only recovery is to read the same files again — which trips `isLooping` at the
 * third repeat and kills the build outright.
 *
 * So the budget is a share of the window, floored so no model does worse than it
 * did before and capped so a large window cannot spend the build's money on
 * re-transmission.
 */
export function trimPolicyFor(
  model?: { contextWindow?: number } | null,
  base: TrimPolicy = DEFAULT_TRIM,
): TrimPolicy {
  const window = model?.contextWindow;
  if (!window || window <= 0) return base;
  const byWindow = Math.round(window * CHARS_PER_TOKEN * TRANSCRIPT_SHARE);
  // The floor never exceeds the share itself: on a small model, `base`'s 60k
  // characters is more than the whole window, and raising the budget to it would
  // disable trimming exactly where it is most needed.
  const floor = Math.min(base.maxTotalChars, byWindow);
  const maxTotalChars = Math.max(floor, Math.min(byWindow, MAX_TOTAL_CHARS));
  return { ...base, maxTotalChars: Math.max(maxTotalChars, MIN_TOTAL_CHARS) };
}

/** Marks a stubbed message, so trimming twice is a no-op. */
const STUB_PREFIX = "[⋯ ";

export function isStub(content: unknown): boolean {
  return typeof content === "string" && content.startsWith(STUB_PREFIX);
}

function charsOf(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (content == null) return 0;
  try {
    return JSON.stringify(content).length;
  } catch {
    return 0;
  }
}

/** Total characters in a transcript, for the meter and for the ceiling check. */
export function transcriptChars(convo: TrimMessage[], from = 0): number {
  let n = 0;
  for (let i = from; i < convo.length; i++) {
    const m = convo[i];
    n += charsOf(m.content);
    for (const c of m.tool_calls ?? []) n += c.function.name.length + c.function.arguments.length;
  }
  return n;
}

/**
 * The replacement for an elided result.
 *
 * The first line is preserved deliberately. For `workspace` and `tasks` it *is*
 * the outcome — "Created index.html", "Marked step 3 done" — which is what the
 * model needs to know it already did the thing, and what `run-model.ts`'s diff
 * and ledger bodies already read. Throwing it away would turn "I wrote that" into
 * "I have no idea whether I wrote that".
 */
export function stubFor(name: string, result: unknown): string {
  const text = typeof result === "string" ? result : String(result ?? "");
  const firstLine = text.split("\n", 1)[0]?.slice(0, 160).trim() ?? "";
  const head = firstLine ? `${firstLine} — ` : "";
  return `${STUB_PREFIX}${name} result elided to save context: ${head}${text.length} chars. Call it again if you need the detail.]`;
}

/** Which round each message belongs to. A round begins at an assistant tool call. */
function roundIndices(convo: TrimMessage[], boundary: number): number[] {
  const rounds: number[] = new Array(convo.length).fill(-1);
  let round = -1;
  for (let i = boundary; i < convo.length; i++) {
    if (convo[i].role === "assistant" && convo[i].tool_calls?.length) round++;
    rounds[i] = round;
  }
  return rounds;
}

/** The tool name a result belongs to, from the call that requested it. */
function nameFor(convo: TrimMessage[], index: number): string {
  const id = convo[index].tool_call_id;
  if (!id) return "tool";
  for (let i = index - 1; i >= 0; i--) {
    const call = convo[i].tool_calls?.find((c) => c.id === id);
    if (call) return call.function.name;
  }
  return "tool";
}

/**
 * Trim a loop transcript to fit.
 *
 * Returns the input **by identity** when nothing needed changing, so the caller
 * can skip the copy — and so applying it twice is provably free.
 */
export function trimToolTranscript<T extends TrimMessage>(
  convo: T[],
  boundary: number,
  policy: TrimPolicy = DEFAULT_TRIM,
): T[] {
  if (convo.length <= boundary) return convo;

  const rounds = roundIndices(convo, boundary);
  const newest = Math.max(...rounds);
  if (newest < 0) return convo;

  // Candidates, oldest first: a tool result, old enough, long enough, not
  // already a stub. The newest round is excluded — the model has not answered it.
  const candidates: number[] = [];
  for (let i = boundary; i < convo.length; i++) {
    const m = convo[i];
    if (m.role !== "tool" || isStub(m.content)) continue;
    if (rounds[i] < 0 || rounds[i] >= newest) continue;
    if (charsOf(m.content) <= policy.maxResultChars) continue;
    candidates.push(i);
  }
  if (!candidates.length) return convo;

  /**
   * Age alone is not a reason to discard anything.
   *
   * This rule used to read "anything older than the keep window goes, regardless
   * of total", and that was the single most damaging line in the long-context
   * path. It stubbed a result at round four whether the transcript was 90% of
   * the window or 1.6% of it — so on a large-window model the agent lost the
   * files it had read while almost the entire window sat empty, re-read them,
   * and tripped the loop detector on the third repeat. A build that was going
   * well was the one most likely to die of it.
   *
   * `keepRounds` now does the opposite job: it is a **floor**, marking the
   * recent rounds that must survive even when the transcript is over budget.
   * Everything else is decided by pressure, oldest first.
   */
  const protectedFrom = newest - policy.keepRounds;
  const stub = new Set<number>();

  let total = transcriptChars(convo, boundary);
  const saved = (i: number) =>
    charsOf(convo[i].content) - stubFor(nameFor(convo, i), convo[i].content).length;
  for (const i of candidates) {
    if (total <= policy.maxTotalChars) break;
    // Oldest first, and never into the protected window: those are the rounds
    // the model needs verbatim to fix what it has just broken.
    if (rounds[i] >= protectedFrom) continue;
    stub.add(i);
    total -= saved(i);
  }
  // Still over after exhausting everything outside the keep window. Reaching
  // into it is the lesser evil — an over-budget request is a hard provider
  // error, where a stubbed recent result is a re-fetch — but the newest round
  // stays whole, because the model has not answered it.
  if (total > policy.maxTotalChars) {
    for (const i of candidates) {
      if (total <= policy.maxTotalChars) break;
      if (stub.has(i)) continue;
      stub.add(i);
      total -= saved(i);
    }
  }

  if (!stub.size) return convo;
  return convo.map((m, i) =>
    stub.has(i) ? { ...m, content: stubFor(nameFor(convo, i), m.content) } : m,
  );
}
