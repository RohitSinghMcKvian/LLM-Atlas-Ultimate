/**
 * Choosing a voice worth listening to.
 *
 * `speechSynthesis.speak` with no voice set uses the platform default, which on
 * Windows is David or Zira — a 2003-era formant synthesiser that makes the whole
 * feature feel like a toy no matter how good the answer is. Every platform ships
 * something better; nothing selects it. That is the entire reason this exists.
 *
 * Pure: it scores a list of voice descriptions. The browser's real
 * `SpeechSynthesisVoice` objects satisfy `VoiceLike` structurally, so the driver
 * passes them straight in and the ranking is testable with plain objects.
 */

export interface VoiceLike {
  name: string;
  lang: string;
  localService: boolean;
  default?: boolean;
  voiceURI?: string;
}

/**
 * Families that indicate a neural or otherwise modern engine.
 *
 * Matched on the voice *name* because that is the only signal the Web Speech
 * API exposes — there is no quality field. Ordered by how much better they
 * generally sound.
 */
const GOOD_FAMILIES: { pattern: RegExp; score: number }[] = [
  { pattern: /\bnatural\b/i, score: 60 },
  { pattern: /\bneural\b/i, score: 55 },
  { pattern: /\bpremium\b/i, score: 45 },
  { pattern: /\benhanced\b/i, score: 45 },
  { pattern: /\bgoogle\b/i, score: 40 },
  { pattern: /\bsiri\b/i, score: 35 },
  { pattern: /\b(samantha|alex|daniel|karen|moira|tessa|serena)\b/i, score: 25 },
];

/**
 * Families that are the reason this module exists.
 *
 * Penalised rather than excluded: on a machine that has nothing else, a bad
 * voice still beats no speech at all.
 */
const POOR_FAMILIES: { pattern: RegExp; score: number }[] = [
  { pattern: /\b(david|zira|mark|hazel|susan|george)\b/i, score: -30 },
  { pattern: /\bespeak\b/i, score: -40 },
  { pattern: /\bcompact\b/i, score: -25 },
];

/** Language tags compared case-insensitively on their primary subtag. */
function primary(lang: string): string {
  return (lang || "").toLowerCase().replace(/_/g, "-").split("-")[0];
}

/**
 * How good a voice is for this language, higher is better.
 *
 * Locality is worth a little — a local voice starts instantly where a network
 * one can stall on first use — but not enough to outweigh sounding like a
 * person, which is why the family bonus is much larger.
 */
export function scoreVoice(voice: VoiceLike, lang: string): number {
  let score = 0;

  const want = (lang || "en-US").toLowerCase().replace(/_/g, "-");
  const have = (voice.lang || "").toLowerCase().replace(/_/g, "-");
  if (have === want) score += 50;
  else if (primary(have) === primary(want)) score += 30;
  else if (primary(have) === "en") score += 5;
  else score -= 40;

  for (const f of GOOD_FAMILIES) {
    if (f.pattern.test(voice.name)) {
      score += f.score;
      break;
    }
  }
  for (const f of POOR_FAMILIES) {
    if (f.pattern.test(voice.name)) {
      score += f.score;
      break;
    }
  }

  if (voice.localService) score += 8;
  if (voice.default) score += 3;
  return score;
}

/** Every usable voice, best first. Stable for equal scores. */
export function rankVoices(voices: VoiceLike[], lang = "en-US"): VoiceLike[] {
  return voices
    .map((voice, index) => ({ voice, index, score: scoreVoice(voice, lang) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((v) => v.voice);
}

/**
 * The voice to use.
 *
 * A stored preference wins outright when it is still installed — someone who
 * picked a voice meant it, and re-ranking around them every launch is the kind
 * of "helpful" that reads as a bug.
 */
export function bestVoice(
  voices: VoiceLike[],
  lang = "en-US",
  preferredUri?: string,
): VoiceLike | null {
  if (voices.length === 0) return null;
  if (preferredUri) {
    const kept = voices.find((v) => (v.voiceURI ?? v.name) === preferredUri);
    if (kept) return kept;
  }
  return rankVoices(voices, lang)[0] ?? null;
}

/** Speaking-rate bounds. Below 0.6 is unintelligible, above 2 is a chipmunk. */
export const MIN_RATE = 0.6;
export const MAX_RATE = 2;
export const DEFAULT_RATE = 1.05;
export const RATE_STEP = 0.15;

export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return DEFAULT_RATE;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(rate * 100) / 100));
}

/** "Faster"/"slower", as one step. */
export function nudgeRate(rate: number, direction: "faster" | "slower"): number {
  return clampRate(rate + (direction === "faster" ? RATE_STEP : -RATE_STEP));
}

/**
 * Chrome stops speaking after about 15 seconds unless the queue is poked.
 *
 * A long-standing bug rather than a spec behaviour: `pause()` immediately
 * followed by `resume()` resets its internal timer without an audible seam. The
 * interval is the value used here; anything above ~14 s races the cutoff.
 */
export const KEEPALIVE_MS = 10_000;
