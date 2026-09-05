/**
 * Turn-taking: deciding when the microphone should close.
 *
 * VAD answers "is there voice in this frame". That is not the same question as
 * "has the person finished their turn", and conflating them is why simple voice
 * UIs cut people off mid-thought. Someone pausing to think is silent; someone
 * finished is also silent; the difference is duration, what came before, and
 * whether the pause followed a word that promises more.
 *
 * Pure, so the timing can be tested against traces without a microphone.
 */

export interface EndpointConfig {
  /** Silence that ends an ordinary turn. */
  silenceMs: number;
  /**
   * Silence tolerated after a word that promises more ("so", "and", "um").
   *
   * A person who trails off mid-sentence has not finished, and cutting them
   * there is the single most irritating thing a voice interface does.
   */
  trailingSilenceMs: number;
  /**
   * Silence that ends a turn the recogniser has already finalised.
   *
   * `silenceMs` is a bet that more words may still be coming. Once the engine
   * has emitted a *final* result for the utterance, that bet is settled — the
   * words are in — and the rest of the wait is dead air the person hears as the
   * assistant being slow. Still non-zero: a final can land mid-thought, and
   * `promisesMore` continues to override this entirely.
   */
  finalizedSilenceMs: number;
  /** Below this, the utterance is a cough or a click, not a turn. */
  minUtteranceMs: number;
  /** Above this, close anyway - something is holding the microphone open. */
  maxUtteranceMs: number;
  /** How long to wait for speech before giving up on an opened microphone. */
  openTimeoutMs: number;
}

export const DEFAULT_ENDPOINT: EndpointConfig = {
  silenceMs: 600,
  finalizedSilenceMs: 380,
  trailingSilenceMs: 1_400,
  minUtteranceMs: 250,
  maxUtteranceMs: 60_000,
  openTimeoutMs: 8_000,
};

/**
 * Words that promise more.
 *
 * Deliberately short and conservative. A long list starts extending pauses
 * after ordinary sentence-final words, which makes the agent feel slow for the
 * sake of a case that rarely happens.
 */
export const TRAILING_WORDS = [
  "and",
  "but",
  "so",
  "or",
  "because",
  "um",
  "uh",
  "erm",
  "like",
  "the",
  "a",
  "of",
  "to",
  "for",
  "with",
  "is",
  "was",
  "that",
];

export type EndpointStatus = "closed" | "waiting" | "listening" | "trailing";

export interface EndpointState {
  status: EndpointStatus;
  /** When the microphone opened. */
  openedAt: number;
  /** When speech first started in this utterance. 0 if none yet. */
  speechStartedAt: number;
  /** When speech last stopped. 0 while speaking. */
  silenceSince: number;
  /** The transcript so far, used only to test its last word. */
  partial: string;
}

export type EndpointAction =
  | { kind: "none" }
  /** Enough speech, enough silence: hand the utterance on. */
  | { kind: "commit"; reason: "silence" | "max_length" }
  /** Nothing was said. Close without sending anything. */
  | { kind: "cancel"; reason: "timeout" | "too_short" };

export function initEndpoint(): EndpointState {
  return { status: "closed", openedAt: 0, speechStartedAt: 0, silenceSince: 0, partial: "" };
}

export function open(now: number): EndpointState {
  return { status: "waiting", openedAt: now, speechStartedAt: 0, silenceSince: 0, partial: "" };
}

export interface EndpointInput {
  /** Whether the detector currently hears voice. */
  speaking: boolean;
  now: number;
  /** Interim transcript, when the backend supplies one. */
  partial?: string;
  /**
   * Whether the recogniser has emitted a final result for this utterance.
   *
   * Separate from `partial` being non-empty: an interim transcript is a guess
   * that keeps changing, a final one is the engine committing.
   */
  finalized?: boolean;
}

/**
 * Whether the last word of a partial transcript promises more.
 *
 * Exported because it is the interesting half of the policy and deserves its own
 * tests. Punctuation ends the check: a backend that emits "so." has already
 * decided the sentence closed.
 */
export function promisesMore(partial: string): boolean {
  const trimmed = partial.trimEnd();
  if (!trimmed) return false;
  if (/[.!?]$/.test(trimmed)) return false;
  const last = trimmed.toLowerCase().match(/[a-z']+$/)?.[0];
  return last ? TRAILING_WORDS.includes(last) : false;
}

export function step(
  state: EndpointState,
  input: EndpointInput,
  cfg: EndpointConfig = DEFAULT_ENDPOINT,
): { state: EndpointState; action: EndpointAction } {
  if (state.status === "closed") return { state, action: { kind: "none" } };

  const partial = input.partial ?? state.partial;
  const next: EndpointState = { ...state, partial };

  if (input.speaking) {
    if (next.speechStartedAt === 0) next.speechStartedAt = input.now;
    next.silenceSince = 0;
    next.status = "listening";
    if (input.now - next.speechStartedAt >= cfg.maxUtteranceMs) {
      return { state: { ...next, status: "closed" }, action: { kind: "commit", reason: "max_length" } };
    }
    return { state: next, action: { kind: "none" } };
  }

  // Silent.
  if (next.speechStartedAt === 0) {
    if (input.now - next.openedAt >= cfg.openTimeoutMs) {
      return { state: { ...next, status: "closed" }, action: { kind: "cancel", reason: "timeout" } };
    }
    return { state: next, action: { kind: "none" } };
  }

  if (next.silenceSince === 0) next.silenceSince = input.now;
  const silentFor = input.now - next.silenceSince;
  const trailing = promisesMore(partial);
  next.status = trailing ? "trailing" : "listening";
  // Trailing wins over finalised: "so..." with a final result behind it is
  // still someone mid-thought, and cutting them there is the single most
  // irritating thing this module can do.
  const needed = trailing
    ? cfg.trailingSilenceMs
    : input.finalized
      ? Math.min(cfg.finalizedSilenceMs, cfg.silenceMs)
      : cfg.silenceMs;

  if (silentFor < needed) return { state: next, action: { kind: "none" } };

  const spokenFor = next.silenceSince - next.speechStartedAt;
  if (spokenFor < cfg.minUtteranceMs) {
    // A cough, a click, a chair. Reopening is the caller's decision, but this
    // must not be sent to a transcriber: a request per throat-clear is how a
    // voice UI burns a budget doing nothing.
    return { state: { ...next, status: "closed" }, action: { kind: "cancel", reason: "too_short" } };
  }
  return { state: { ...next, status: "closed" }, action: { kind: "commit", reason: "silence" } };
}

/** Milliseconds of speech captured so far, for the UI. */
export function spokenMs(state: EndpointState, now: number): number {
  if (state.speechStartedAt === 0) return 0;
  return (state.silenceSince || now) - state.speechStartedAt;
}
