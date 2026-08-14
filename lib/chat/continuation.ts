/**
 * Recovering an answer the provider cut off.
 *
 * A model asked for a landing page writes 400–900 lines. Providers stop at their
 * output limit and report `finish_reason: "length"`, and until now Atlas threw
 * that field away — so a truncated page was indistinguishable from a finished
 * one. Worse, truncation lands mid-fence, and an unclosed fence used to mean no
 * artifact was detected at all, so the user got a wall of raw HTML and no
 * preview. This module is the other half of that fix: notice the cut, ask for the
 * rest, and join the halves without a seam.
 *
 * Pure string work, no network and no React, so the joining rules can be tested
 * directly — they are the part most likely to go subtly wrong.
 */

/**
 * Ceiling on the per-turn output budget, in tokens.
 *
 * Chat sent no `max_tokens` at all before this, so every turn ran at whatever
 * the route happened to default to — 1–4k on many, which is under half a landing
 * page. Asking for a frontier model's full 128k instead would be the opposite
 * mistake: it is a reservation against the context window on some providers, and
 * one runaway answer's worth of spend on all of them. 16k is roughly 1,500 lines
 * of HTML, and anything longer is what `stitch` and the resume loop are for.
 */
export const MAX_OUTPUT_BUDGET = 16384;

/** Used when the catalog has no `maxOutput` for the model, e.g. a synced entry. */
export const DEFAULT_OUTPUT_BUDGET = 8192;

/**
 * The `max_tokens` to request for one turn, given the model's own ceiling.
 *
 * `ceiling` is a parameter rather than the constant it used to be because build
 * mode raises it to 32k. The default keeps every existing caller — playground,
 * compare, the short single-shot calls — on exactly the previous number.
 */
export function outputBudget(maxOutput?: number, ceiling: number = MAX_OUTPUT_BUDGET): number {
  const cap = ceiling > 0 ? ceiling : MAX_OUTPUT_BUDGET;
  if (!maxOutput || maxOutput <= 0) return Math.min(DEFAULT_OUTPUT_BUDGET, cap);
  return Math.min(maxOutput, cap);
}

/**
 * How many times one answer may be resumed.
 *
 * A cap rather than "until it stops": a model that ignores the resume
 * instruction and starts over would otherwise loop, each round paying for the
 * whole partial answer as input. Three rounds is enough for a long page and
 * cheap enough to be safe.
 */
export const MAX_CONTINUATIONS = 3;

/**
 * What we send to get the rest.
 *
 * The three prohibitions are each a failure seen from real models: re-opening
 * the code fence (which produces a nested fence and breaks extraction),
 * apologising first (which lands prose in the middle of the HTML), and starting
 * the file over (which `stitch` can absorb, but only up to a point).
 */
export const RESUME_INSTRUCTION =
  "Your previous message stopped early because it hit the output limit. Continue it from " +
  "exactly where it stopped. Output only the continuation: do not repeat text you already " +
  "sent, do not re-open the code fence, and do not add any preamble, apology or explanation.";

/**
 * Whether a finished stream should be resumed.
 *
 * Only `"length"`. The router also reports `"stalled"` for an idle-timeout, but
 * that is a hung connection rather than a full buffer, and retrying it is the
 * failover layer's job, not this one's.
 */
export function shouldContinue(
  finishReason: string | undefined,
  alreadyDone: number,
  max: number = MAX_CONTINUATIONS,
): boolean {
  return finishReason === "length" && alreadyDone < max;
}

/** Longest overlap we will look for, and the shortest we will trust. */
const MAX_OVERLAP = 600;
const MIN_OVERLAP = 16;

/** A fence the model re-opened despite being told not to. */
const LEADING_FENCE = /^[ \t]*`{3,}[A-Za-z0-9_+#.-]*[ \t]*\r?\n/;

/**
 * Join a truncated answer to its continuation.
 *
 * Two repairs, in order:
 *
 *  1. Drop a re-opened fence at the head of the continuation. Left in, it would
 *     appear in the middle of the artifact's own source.
 *  2. Drop a repeated tail. Models often restate the last line or two for
 *     context before carrying on; concatenating blind duplicates them. Only
 *     overlaps of at least `MIN_OVERLAP` characters count — a one-character
 *     match is a coincidence, not a repeat.
 *
 * Nothing is trimmed beyond that. Truncation frequently lands mid-token
 * (`<div cla`), so the two halves must be able to join with no separator at all.
 */
export function stitch(prev: string, next: string): string {
  if (!next) return prev;
  if (!prev) return next;

  let tail = next.replace(LEADING_FENCE, "");

  const window = Math.min(MAX_OVERLAP, prev.length, tail.length);
  for (let k = window; k >= MIN_OVERLAP; k--) {
    if (prev.endsWith(tail.slice(0, k))) {
      tail = tail.slice(k);
      break;
    }
  }

  return prev + tail;
}
