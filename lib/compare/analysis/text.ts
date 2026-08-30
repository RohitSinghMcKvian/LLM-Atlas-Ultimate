// What each answer is made of, measured rather than judged.
//
// Every figure here is computed from the text alone: no model call, no cost, no
// latency, and no opinion to be biased. That makes it the tier that always runs,
// including on Quick, and the floor the model-based analyses sit on top of.
//
// The two that earn their place beyond mere counting:
//
//   * **Hedging.** Two answers can agree on the facts and disagree entirely on
//     how sure they are. "X is faster" and "X may sometimes be faster in certain
//     workloads" are not the same answer, and nothing else in the run surfaces
//     that difference.
//   * **Structure.** A model that returns a table when asked to compare has done
//     something a model returning six paragraphs has not, and it is invisible in
//     a synthesis that flattens both to prose.

/** Words that soften a claim rather than making one. */
const HEDGES = [
  "may", "might", "could", "possibly", "perhaps", "generally", "typically",
  "often", "usually", "sometimes", "somewhat", "relatively", "arguably",
  "seems", "appears", "suggests", "tends", "likely", "roughly", "approximately",
  "in some cases", "it depends", "can vary",
];

/** Words that commit to a claim without qualification. */
const ABSOLUTES = [
  "always", "never", "must", "cannot", "guarantees", "definitely", "certainly",
  "invariably", "every", "none", "impossible", "all cases",
];

export interface StructureProfile {
  headings: number;
  listItems: number;
  tables: number;
  codeBlocks: number;
  links: number;
  paragraphs: number;
}

export interface LengthProfile {
  words: number;
  sentences: number;
  /** Mean words per sentence. The main driver of how hard a text is to read. */
  meanSentenceWords: number;
  /** Approximate US grade level, Flesch-Kincaid. */
  gradeLevel: number;
}

export interface HedgeProfile {
  hedges: number;
  absolutes: number;
  /** Hedges per hundred words. Comparable across answers of different lengths. */
  hedgeDensity: number;
  /**
   * -1 (fully hedged) to +1 (fully absolute), 0 when neither or balanced.
   * A single number so lanes can be ordered by how much they committed.
   */
  commitment: number;
}

export interface TextProfile {
  structure: StructureProfile;
  length: LengthProfile;
  hedging: HedgeProfile;
}

/** Fenced code, stripped before prose is measured so it cannot skew sentences. */
const FENCE = /```[\s\S]*?(?:```|$)/g;

export function stripCode(text: string): string {
  return text.replace(FENCE, " ");
}

export function structureProfile(text: string): StructureProfile {
  const fences = text.match(/```/g)?.length ?? 0;
  const prose = stripCode(text);
  return {
    headings: (prose.match(/^#{1,6}\s+\S/gm) ?? []).length,
    listItems: (prose.match(/^\s*(?:[-*+]|\d+[.)])\s+\S/gm) ?? []).length,
    // A markdown table needs a delimiter row; counting pipes alone would call
    // any sentence containing "|" a table.
    tables: (prose.match(/^\s*\|?[\s:-]*\|[\s:|-]*$/gm) ?? []).length,
    // An unterminated fence is still one block — truncation is common and the
    // block was still attempted.
    codeBlocks: Math.ceil(fences / 2),
    links: (prose.match(/\[[^\]]+\]\((https?:\/\/[^)]+)\)|https?:\/\/\S+/g) ?? []).length,
    paragraphs: prose.split(/\n{2,}/).filter((p) => p.trim().length > 0).length,
  };
}

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const groups = w
    .replace(/(?:es|ed|[^laeiouy]e)$/, "")
    .match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

export function lengthProfile(text: string): LengthProfile {
  const prose = stripCode(text).trim();
  if (!prose) return { words: 0, sentences: 0, meanSentenceWords: 0, gradeLevel: 0 };

  const words = prose.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  // A trailing fragment with no terminator is still a sentence.
  const sentences = Math.max(1, (prose.match(/[.!?]+(?:\s|$)/g) ?? []).length);
  const totalSyllables = words.reduce((n, w) => n + syllables(w), 0);
  const wordsPerSentence = words.length / sentences;
  const syllablesPerWord = words.length > 0 ? totalSyllables / words.length : 0;

  return {
    words: words.length,
    sentences,
    meanSentenceWords: round(wordsPerSentence, 1),
    // Flesch-Kincaid grade level. Floored at 0: the formula goes negative on
    // very short simple text, which is not a reading level anyone recognises.
    gradeLevel: Math.max(0, round(0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59, 1)),
  };
}

function countPhrases(haystack: string, needles: string[]): number {
  let n = 0;
  for (const needle of needles) {
    // Word boundaries, so "may" does not match "maybe" or "dismay".
    const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    n += (haystack.match(re) ?? []).length;
  }
  return n;
}

export function hedgeProfile(text: string): HedgeProfile {
  const prose = stripCode(text).toLowerCase();
  const words = prose.split(/\s+/).filter(Boolean).length;
  const hedges = countPhrases(prose, HEDGES);
  const absolutes = countPhrases(prose, ABSOLUTES);
  const total = hedges + absolutes;
  return {
    hedges,
    absolutes,
    hedgeDensity: words > 0 ? round((hedges / words) * 100, 2) : 0,
    commitment: total > 0 ? round((absolutes - hedges) / total, 2) : 0,
  };
}

export function profileText(text: string): TextProfile {
  return {
    structure: structureProfile(text),
    length: lengthProfile(text),
    hedging: hedgeProfile(text),
  };
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
