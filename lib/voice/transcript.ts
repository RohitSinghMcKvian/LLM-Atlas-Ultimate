import type { AtlasGraph } from "@/lib/graph/types";
import { buildLexicon, correctTranscript, type Correction, type Lexicon } from "./lexicon";
import { normalizeSpoken } from "./normalize";

/**
 * From what the microphone heard to what the model should read.
 *
 * Order matters and is not arbitrary. Normalisation runs first because it turns
 * spoken quantities into the written forms the lexicon knows: "Meridian seventy
 * be" only becomes a catalog model once "seventy be" has become "70B". Running
 * the lexicon first would leave it matching a phrase no term contains.
 *
 * Pure, so the whole pipeline is testable end to end without a microphone.
 */

export interface RefineResult {
  /** What to send. */
  text: string;
  /** What was heard, kept so the UI can show both. */
  raw: string;
  corrections: Correction[];
  /** True when nothing changed - the common case, and worth knowing. */
  clean: boolean;
}

export function refineTranscript(raw: string, lexicon: Lexicon): RefineResult {
  const normalized = normalizeSpoken(raw);
  const { text, corrections } = correctTranscript(normalized, lexicon);
  return { text, raw, corrections, clean: text === raw.trim() && corrections.length === 0 };
}

/**
 * The bias prompt for a transcriber that accepts one.
 *
 * Whisper-shaped backends take a `prompt` of expected vocabulary and weight
 * their decoding towards it, which fixes a mishearing before it happens rather
 * than afterwards. Correction still runs - the two are complementary, and only
 * one of them works on a backend with no such field.
 *
 * Capped hard: these fields are small, and a prompt longer than the utterance
 * degrades transcription rather than improving it.
 */
export function biasPrompt(lexicon: Lexicon, maxChars = 900): string {
  const parts: string[] = [];
  let length = 0;
  for (const t of lexicon.terms) {
    const next = t.term;
    if (length + next.length + 2 > maxChars) break;
    parts.push(next);
    length += next.length + 2;
  }
  return parts.join(", ");
}

/**
 * A lexicon per graph, built once.
 *
 * Keyed by graph identity, like `nodeIndex` in `lib/graph/retrieve.ts` and for
 * the same reason: `atlasGraph()` memoises on content, so a new object is the
 * signal that the vocabulary changed.
 */
const cache = new WeakMap<AtlasGraph, Lexicon>();

export function lexiconFor(g: AtlasGraph | null): Lexicon {
  if (!g) return buildLexicon(null);
  const hit = cache.get(g);
  if (hit) return hit;
  const built = buildLexicon(g);
  cache.set(g, built);
  return built;
}
