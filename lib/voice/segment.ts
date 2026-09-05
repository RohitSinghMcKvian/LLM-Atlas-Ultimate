/**
 * Cutting a streaming answer into speakable pieces.
 *
 * Without this, speech starts when generation ends. A twenty-second answer is
 * twenty seconds of silence followed by twenty seconds of talking, and the user
 * concludes it has hung. Emitting a sentence at a time turns the same answer
 * into a reply that begins almost immediately.
 *
 * Pure and incremental: `feed` takes whatever arrived and returns whatever is
 * now safe to speak. The hard part is *not* cutting - a decimal point, an
 * abbreviation, a URL and a code fence all contain characters that end
 * sentences, and speaking half of "$1.25" is worse than waiting.
 */

export interface SegmentState {
  /** Text received but not yet emitted. */
  buffer: string;
  /**
   * Whether anything has been spoken yet this answer.
   *
   * Only the *first* piece is allowed to cut early (see `firstCutChars`): once
   * the agent is talking, the listener is no longer waiting in silence and
   * ordinary sentence boundaries read better.
   */
  emitted: boolean;
}

export interface SegmentOptions {
  /**
   * Emit anyway once the buffer passes this, at the last clause break.
   *
   * A model can write a very long sentence, and waiting for its full stop is
   * the stall this module exists to remove.
   */
  maxChars?: number;
  /** Never emit a fragment shorter than this; it reads as clipped. */
  minChars?: number;
  /**
   * Budget for the *first* piece only, cut at a clause break.
   *
   * Time-to-first-word is the number a spoken interface is judged on, and
   * waiting for a full sentence spends the whole opening clause of an answer
   * that is already streaming. A comma is a place a listener expects a pause,
   * so cutting there costs nothing and starts the reply roughly twice as fast.
   * Set to 0 to keep the old sentence-only behaviour.
   */
  firstCutChars?: number;
}

export const DEFAULT_MAX_CHARS = 240;
export const DEFAULT_MIN_CHARS = 24;
export const DEFAULT_FIRST_CUT_CHARS = 70;

/** Abbreviations whose full stop does not end a sentence. */
const ABBREVIATIONS = [
  "e.g.",
  "i.e.",
  "etc.",
  "vs.",
  "approx.",
  "no.",
  "fig.",
  "dr.",
  "mr.",
  "mrs.",
  "ms.",
  "st.",
  "inc.",
  "ltd.",
];

export function initSegmenter(): SegmentState {
  return { buffer: "", emitted: false };
}

/**
 * Whether the full stop at `index` really ends a sentence.
 *
 * Exported because every one of these cases was a bug worth naming, and they
 * deserve their own tests.
 */
export function isBoundary(text: string, index: number): boolean {
  const ch = text[index];
  if (ch !== "." && ch !== "!" && ch !== "?") return false;

  // A decimal point: "$1.25", "3.5 tok/s". Speaking "one dollar" then "twenty
  // five per M" as two utterances is worse than any stall.
  if (ch === "." && /\d/.test(text[index - 1] ?? "") && /\d/.test(text[index + 1] ?? "")) {
    return false;
  }
  // Inside a URL or a version string.
  if (ch === "." && /[a-z0-9/]/i.test(text[index + 1] ?? "")) return false;

  const before = text.slice(0, index + 1).toLowerCase();
  for (const abbr of ABBREVIATIONS) {
    if (before.endsWith(abbr)) return false;
  }

  // A boundary needs whitespace after it - otherwise it is punctuation inside a
  // token. The end of the buffer does NOT count while streaming: a chunk that
  // happens to end on "$1." would be cut there, and the same text would split
  // differently depending on how the network happened to slice it. `flush`
  // handles the genuine end.
  const after = text[index + 1];
  return after !== undefined && /\s/.test(after);
}

/**
 * How far into the buffer it is safe to look for a boundary.
 *
 * Two things make the tail unsafe, and both were chunk-size bugs before they
 * were rules. An unterminated code fence means everything after it is code, and
 * speaking code is never right. A trailing run of one or two backticks may be
 * the start of a fence marker that has not fully arrived.
 */
export function safeEnd(buffer: string): number {
  let cursor = 0;
  let lastOpen = -1;
  let open = false;
  for (;;) {
    const at = buffer.indexOf("```", cursor);
    if (at === -1) break;
    open = !open;
    lastOpen = open ? at : -1;
    cursor = at + 3;
  }
  if (open && lastOpen >= 0) return lastOpen;

  const partial = buffer.match(/`{1,2}$/);
  return partial ? buffer.length - partial[0].length : buffer.length;
}

/**
 * The first complete fenced block, if the buffer holds one.
 *
 * A finished code block is atomic: `speech-plan.ts` replaces the whole thing
 * with one announcing sentence, so cutting inside it is never useful. Treating
 * it as a unit is also what stops the short-fragment rule from stepping over a
 * real sentence boundary and landing in the middle of the code - which is
 * exactly what it did before this existed.
 */
export function firstFenceBlock(buffer: string): { start: number; end: number } | null {
  const start = buffer.indexOf("```");
  if (start === -1) return null;
  const close = buffer.indexOf("```", start + 3);
  if (close === -1) return null;
  return { start, end: close + 3 };
}

export interface SegmentResult {
  state: SegmentState;
  /** Whole utterances, ready to speak, in order. */
  segments: string[];
}

/**
 * The first clause break at or after `from`, or -1.
 *
 * Used only for the opening piece. A comma, semicolon, colon or dash is a place
 * a listener already expects a pause, so cutting there is free; cutting at an
 * arbitrary space ("at thirty cents per million" / "tokens, which is…") is not,
 * which is why this returns -1 rather than falling back to one.
 */
export function earliestClause(text: string, from: number): number {
  // Only within the opening line. An early cut is a *prose* optimisation, and
  // past the first newline the answer may be a table, a list or a heading —
  // `| - | - |` reads as a dash clause break and cutting there lands inside a
  // table that `speech-plan.ts` was about to announce as one thing.
  const firstBreak = text.indexOf("\n");
  const line = firstBreak === -1 ? text : text.slice(0, firstBreak);

  for (let i = Math.max(0, from); i < line.length - 1; i++) {
    const ch = line[i];
    if (!/\s/.test(line[i + 1])) continue;
    if (ch === "," || ch === ";" || ch === ":") return i + 1;
    // An em or en dash used as a clause break. The ASCII hyphen is excluded on
    // purpose: it is also a bullet marker and a table rule.
    if ((ch === "—" || ch === "–") && /\s/.test(line[i - 1] ?? "")) return i + 1;
  }
  return -1;
}

export function feed(
  state: SegmentState,
  chunk: string,
  opts: SegmentOptions = {},
): SegmentResult {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const minChars = opts.minChars ?? DEFAULT_MIN_CHARS;
  const firstCutChars = opts.firstCutChars ?? DEFAULT_FIRST_CUT_CHARS;

  let buffer = state.buffer + chunk;
  let emitted = state.emitted;
  const segments: string[] = [];

  for (;;) {
    const fence = firstFenceBlock(buffer);
    if (fence && fence.start === 0) {
      const block = buffer.slice(0, fence.end).trim();
      if (block) segments.push(block);
      buffer = buffer.slice(fence.end);
      continue;
    }

    const limit = Math.min(safeEnd(buffer), fence ? fence.start : Number.MAX_SAFE_INTEGER);
    if (limit <= 0) break;

    let cut = -1;
    let searchFrom = 0;
    while (searchFrom < limit) {
      let found = -1;
      for (let i = searchFrom; i < limit; i++) {
        if (isBoundary(buffer, i)) {
          found = i + 1;
          break;
        }
      }
      if (found === -1) break;
      // Too short to stand alone: look past it rather than emitting a clipped
      // fragment ("Yes." on its own reads as a glitch).
      if (found < minChars) {
        searchFrom = found;
        continue;
      }
      cut = found;
      break;
    }

    if (cut === -1 && fence && fence.start > 0 && limit === fence.start) {
      // Prose right before a code block, with no sentence end of its own. Emit
      // it anyway rather than letting it be swallowed into the block.
      cut = fence.start;
    }

    // The opening piece cuts at the *earliest* natural pause past the minimum,
    // not the latest one that fits: nothing has been said yet, so every
    // character waited for is silence the listener hears. Later pieces do the
    // opposite — the agent is already talking, so they fill the budget.
    if (cut === -1 && !emitted && firstCutChars > 0) {
      const window = buffer.slice(0, Math.min(limit, maxChars));
      const clause = earliestClause(window, Math.max(minChars, firstCutChars - 40));
      if (clause > 0) cut = clause;
    }

    if (cut === -1) {
      if (limit <= maxChars) break;
      // Over budget with no full stop in sight: fall back to the last clause
      // break so the pause lands somewhere a listener expects one.
      const window = buffer.slice(0, maxChars);
      const clause = Math.max(
        window.lastIndexOf(", "),
        window.lastIndexOf("; "),
        window.lastIndexOf(": "),
        window.lastIndexOf(" - "),
      );
      cut = clause > minChars ? clause + 1 : window.lastIndexOf(" ");
      if (cut <= 0) break;
    }

    const piece = buffer.slice(0, cut).trim();
    if (piece) {
      segments.push(piece);
      emitted = true;
    }
    buffer = buffer.slice(cut);
  }

  return { state: { buffer, emitted }, segments };
}

/** Emit whatever is left. Called when the answer is finished. */
export function flush(state: SegmentState): SegmentResult {
  const piece = state.buffer.trim();
  return {
    state: { buffer: "", emitted: state.emitted || piece.length > 0 },
    segments: piece ? [piece] : [],
  };
}
