/**
 * "Hey Atlas".
 *
 * Wake detection over the transcript the recogniser is already producing, not a
 * second audio pipeline: there is one microphone, one recogniser, and this
 * reads its words. That is what makes the two listening modes in
 * `use-voice-session.ts` synchronisable at all — arming the wake word and
 * opening a session are the same object in different modes, so they cannot
 * contend for the device or hear the same utterance twice.
 *
 * ### The command can ride along
 *
 * `feedWake` returns the rest of the utterance after the phrase, so
 * "hey atlas, open compare" both wakes *and* carries the command. Waking and
 * then asking the person to repeat themselves is the most irritating thing a
 * wake word can do.
 *
 * ### Bare "atlas" is deliberately restricted
 *
 * The app is called Atlas and the word appears in ordinary sentences about it
 * — "the Atlas catalog", "ask Atlas about this". A bare mention only wakes when
 * it *starts* the utterance, which is where an address goes. The greeted forms
 * ("hey atlas") are unambiguous and match anywhere.
 *
 * Pure, so the whole grammar is testable without a microphone.
 */

/** Greeted forms. Unambiguous: nobody says "hey atlas" about the software. */
export const WAKE_PHRASES = [
  "hey atlas",
  "hi atlas",
  "hello atlas",
  "okay atlas",
  "ok atlas",
  "yo atlas",
  "hey, atlas",
];

/** The name alone. Only honoured at the start of an utterance. */
export const BARE_WAKE = "atlas";

export interface WakeConfig {
  /**
   * Ignore a second trigger inside this window.
   *
   * Recognisers re-emit a growing interim result many times a second, so the
   * same "hey atlas" arrives repeatedly. Without a cooldown one greeting opens
   * a dozen sessions.
   */
  cooldownMs: number;
  /** Whether a bare "atlas" at the start counts. */
  allowBare: boolean;
}

export const DEFAULT_WAKE: WakeConfig = { cooldownMs: 2_000, allowBare: true };

export interface WakeState {
  /**
   * When the last trigger fired, for the cooldown. `0` means *never*, and is
   * checked explicitly rather than left to the arithmetic: `now - 0` is only
   * reliably larger than the cooldown when the clock happens to be a wall-clock
   * epoch, and a driver passing `performance.now()` would have its very first
   * wake silently swallowed.
   */
  firedAt: number;
  /** The utterance text already consumed, so it cannot re-trigger. */
  consumed: string;
}

export function initWake(): WakeState {
  return { firedAt: 0, consumed: "" };
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface WakeResult {
  state: WakeState;
  /** True on the transition into awake, once per utterance. */
  fired: boolean;
  /** Whatever followed the phrase — a command that rode along, or "". */
  rest: string;
}

/**
 * Advance with the transcript so far.
 *
 * Takes the whole current utterance rather than an increment, because that is
 * what a recogniser gives: a growing string, re-emitted. Everything here is
 * idempotent against that.
 */
export function feedWake(
  state: WakeState,
  transcript: string,
  now: number,
  cfg: WakeConfig = DEFAULT_WAKE,
): WakeResult {
  const t = normalize(transcript);
  if (!t) return { state, fired: false, rest: "" };

  let at = -1;
  let length = 0;
  for (const phrase of WAKE_PHRASES) {
    const found = t.indexOf(normalize(phrase));
    if (found >= 0 && (at === -1 || found < at)) {
      at = found;
      length = normalize(phrase).length;
    }
  }
  if (at === -1 && cfg.allowBare && (t === BARE_WAKE || t.startsWith(`${BARE_WAKE} `))) {
    at = 0;
    length = BARE_WAKE.length;
  }
  if (at === -1) return { state: { ...state, consumed: "" }, fired: false, rest: "" };

  const rest = t.slice(at + length).replace(/^[\s,]+/, "").trim();

  // The same growing utterance, already acted on: keep reporting the rest as it
  // arrives, but do not fire again.
  if (state.consumed && t.startsWith(state.consumed)) {
    return { state: { ...state, consumed: t }, fired: false, rest };
  }
  if (state.firedAt > 0 && now - state.firedAt < cfg.cooldownMs) {
    return { state: { ...state, consumed: t }, fired: false, rest };
  }

  return { state: { firedAt: now, consumed: t }, fired: true, rest };
}

/** Forget the current utterance, so the next "hey atlas" counts. */
export function resetWake(state: WakeState): WakeState {
  return { ...state, consumed: "" };
}
