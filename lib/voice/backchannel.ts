/**
 * The noise a listener makes while they are thinking.
 *
 * The single biggest reason the P20 voice surface felt slow was not the model:
 * it was that the gap between "you stopped talking" and "the first word of the
 * answer" was *silent*. A person who says nothing for three seconds has not
 * heard you. A person who says "let me check" has, and the same three seconds
 * stop registering as a stall.
 *
 * This is deliberately not a spinner in audio form. It fires only when the
 * answer is genuinely late (`BACKCHANNEL_AFTER_MS`), it never fires twice in a
 * row with the same words, and the moment a real segment is ready it is dropped
 * rather than queued behind — an acknowledgement that arrives *after* the answer
 * has started is worse than none.
 *
 * Pure, with the randomness injected, so the rotation is testable.
 */

export interface BackchannelState {
  /** The last two phrases said, newest first. Never repeated immediately. */
  recent: string[];
}

/**
 * How long an answer may take before it is worth acknowledging.
 *
 * Under this, an acknowledgement makes the exchange *longer*: the phrase itself
 * takes a second to say, and it would land on top of the answer.
 */
export const BACKCHANNEL_AFTER_MS = 350;

/** How many previous phrases to avoid repeating. */
export const RECENT_MEMORY = 2;

/**
 * Ordinary waiting noises.
 *
 * Short, because they are spoken while the real answer is being written and a
 * long one collides with it. Neutral, because they are said before the answer
 * is known — "great question" commits to an opinion nothing has formed yet.
 */
export const THINKING_PHRASES = [
  "One moment.",
  "Let me check.",
  "Checking.",
  "Just a second.",
  "Looking that up.",
  "Give me a moment.",
];

/**
 * Said when the turn is reaching for Atlas's own data rather than thinking.
 *
 * Worth distinguishing: "looking that up in the catalog" tells the listener the
 * answer will be grounded, which is the whole reason the tools exist.
 */
export const LOOKUP_PHRASES = [
  "Looking that up.",
  "Checking the catalog.",
  "Pulling that up.",
  "Let me look.",
];

export function initBackchannel(): BackchannelState {
  return { recent: [] };
}

/** Whether an answer has been slow enough to be worth acknowledging. */
export function shouldBackchannel(waitedMs: number, spokenYet: boolean): boolean {
  return !spokenYet && waitedMs >= BACKCHANNEL_AFTER_MS;
}

export interface BackchannelResult {
  state: BackchannelState;
  /** Null when every candidate was said too recently. */
  phrase: string | null;
}

/**
 * Choose something to say, avoiding the last few.
 *
 * A voice assistant that says "one moment" every single time is a voice
 * assistant with one line, and people notice by the third turn.
 */
export function pickBackchannel(
  state: BackchannelState,
  opts: { lookup?: boolean; random?: () => number } = {},
): BackchannelResult {
  const pool = opts.lookup ? LOOKUP_PHRASES : THINKING_PHRASES;
  const fresh = pool.filter((p) => !state.recent.includes(p));
  // Every phrase used recently: rather than repeat, say nothing. Silence for
  // one turn is better than a tic.
  if (fresh.length === 0) return { state, phrase: null };

  const random = opts.random ?? Math.random;
  const phrase = fresh[Math.min(fresh.length - 1, Math.floor(random() * fresh.length))];
  return {
    state: { recent: [phrase, ...state.recent].slice(0, RECENT_MEMORY) },
    phrase,
  };
}
