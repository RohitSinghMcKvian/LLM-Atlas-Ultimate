import type { AtlasGraph } from "@/lib/graph/types";

/**
 * Correcting what the microphone heard, against the vocabulary Atlas is about.
 *
 * This is the accuracy work, and it is the one thing a general-purpose voice
 * stack cannot do here. Every transcriber mangles this domain in the same ways:
 * *Qwen* becomes "Quinn", *Nemotron* becomes "Nemo Tron", *MMLU* becomes "MML
 * you", *GPQA* becomes "GP QA", *vLLM* becomes "VLM". Those are exactly the
 * words a question turns on, so getting them wrong does not degrade the answer,
 * it changes the question.
 *
 * Atlas already holds the vocabulary - ~400 model names, their brands and
 * families, every benchmark key, every provider - so the fix is to match the
 * transcript against that rather than hope.
 *
 * ### The rule that matters most
 *
 * A wrong correction is worse than a mangled word. A mangled word leaves the
 * model uncertain; a wrong correction makes it confidently answer about a
 * different model. So every guard here is biased towards leaving text alone:
 *
 *  - a window must clear a high similarity floor,
 *  - and beat its runner-up by a clear margin (ambiguity means leave it),
 *  - and not already be an ordinary English word,
 *  - and not already be an exact term.
 *
 * `lexicon.test.ts` measures both directions: how much it fixes, and that it
 * changes nothing at all on clean text.
 */

export interface LexiconTerm {
  /** The written form to insert. */
  term: string;
  /** Where it came from, for debugging and for the console. */
  kind: string;
  /** Lowercased spellings that should map to `term`. Includes the term itself. */
  variants: string[];
}

export interface Lexicon {
  terms: LexiconTerm[];
  /** variant -> term, for the exact-hit fast path. */
  exact: Map<string, string>;
  /** phonetic key -> terms sharing it. */
  byKey: Map<string, LexiconTerm[]>;
  /** Longest variant in words, so the window scan knows where to stop. */
  maxWords: number;
}

/**
 * Letters whose spoken name is a whole word a transcriber will happily write.
 *
 * This is the acronym fix. "MMLU" read aloud ends "...L, you", and the
 * transcriber writes "you" because that is a word and "u" is not. Generating
 * the variant is far more reliable than trying to match it fuzzily afterwards.
 */
const LETTER_NAMES: Record<string, string> = {
  a: "ay",
  b: "be",
  c: "see",
  g: "gee",
  i: "eye",
  j: "jay",
  k: "kay",
  p: "pea",
  q: "cue",
  r: "are",
  t: "tea",
  u: "you",
  x: "ex",
  y: "why",
  z: "zee",
};

/** The spoken names above, as a set - see `isLetterName`. */
const LETTER_NAME_WORDS = new Set(Object.values(LETTER_NAMES));

/**
 * Whether a word is the spoken name of a letter.
 *
 * Load-bearing at a window boundary: a domain term never ends in an ordinary
 * English word, except when that word is a letter someone read aloud. "MML you"
 * is the acronym case and "Meridian 70B on" is not, and this is what tells them
 * apart.
 */
export function isLetterName(word: string): boolean {
  return LETTER_NAME_WORDS.has(word.toLowerCase());
}

/**
 * Ordinary words that must never be replaced by a lexicon term.
 *
 * Short and high-frequency only. The list exists to stop a model called "Delta"
 * capturing every use of the word delta, not to be a dictionary.
 */
const COMMON_WORDS = new Set([
  "a", "about", "all", "an", "and", "any", "are", "as", "at", "be", "best", "better", "big",
  "but", "by", "can", "cheap", "cheaper", "code", "compare", "cost", "costs", "do", "does",
  "fast", "faster", "for", "from", "get", "give", "good", "has", "have", "how", "i", "if",
  "in", "is", "it", "its", "just", "know", "like", "make", "many", "me", "model", "models",
  "more", "most", "much", "my", "need", "new", "no", "not", "now", "of", "on", "one", "open",
  "other", "others", "another", "over", "under", "same", "different", "each", "both", "every",
  "or", "our", "out", "price", "prices", "run", "runs", "say", "see", "should", "show", "small",
  "so", "some", "than", "that", "the", "their", "them", "then", "there", "these", "they",
  "think", "this", "those", "to", "top", "up", "us", "use", "used", "want", "was", "we",
  "what", "when", "where", "which", "who", "why", "will", "with", "work", "would", "you", "your",
]);

/** Terms Atlas is about that live in no table. */
export const TECHNICAL_TERMS: { term: string; kind: string }[] = [
  { term: "MMLU", kind: "benchmark" },
  { term: "GPQA", kind: "benchmark" },
  { term: "HumanEval", kind: "benchmark" },
  { term: "SWE-bench", kind: "benchmark" },
  { term: "vLLM", kind: "runtime" },
  { term: "Ollama", kind: "runtime" },
  { term: "llama.cpp", kind: "runtime" },
  { term: "OpenRouter", kind: "provider" },
  { term: "quantization", kind: "concept" },
  { term: "context window", kind: "concept" },
  { term: "tok/s", kind: "unit" },
  { term: "BYOK", kind: "concept" },
  { term: "RAG", kind: "concept" },
  { term: "MCP", kind: "concept" },
  { term: "LoRA", kind: "concept" },
  { term: "KV cache", kind: "concept" },
];

/**
 * A consonant skeleton, with the substitutions a transcriber actually makes.
 *
 * Not a full Metaphone: this vocabulary is brand names and acronyms rather than
 * English surnames, and Metaphone's English-specific rules mis-handle exactly
 * the coined words that matter here. Dropping vowels and collapsing runs is what
 * makes "Quinn" and "Qwen" the same key.
 */
export function phoneticKey(raw: string): string {
  let s = raw.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!s) return "";
  s = s
    .replace(/ph/g, "f")
    // `ch` and `sh` are one symbol here. It is what makes "cache" and "cash"
    // the same key, which is the whole point of a phonetic pass.
    .replace(/[cs]h/g, "s")
    .replace(/ck/g, "k")
    .replace(/qu/g, "kw")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/z/g, "s")
    .replace(/c([eiy])/g, "s$1")
    .replace(/c/g, "k")
    .replace(/gh/g, "g")
    .replace(/wr/g, "r");

  const first = s[0];
  // Keep the leading vowel: dropping it makes "Atlas" and "Titles" collide,
  // and a leading sound is the part a listener is most certain about.
  const rest = s.slice(1).replace(/[aeiouhwy]/g, "");
  let out = (/[aeiou]/.test(first) ? first : first) + rest;
  out = out.replace(/(.)\1+/g, "$1");
  return out;
}

/** Levenshtein distance, capped implicitly by string length. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - editDistance(a, b) / longest;
}

function looksLikeAcronym(term: string): boolean {
  const letters = term.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2 || letters.length > 6) return false;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper >= letters.length - 1;
}

/** Digits, as the words a transcriber writes when they are read aloud. */
const DIGIT_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];

/** Spellings a transcriber might produce for one term. */
export function variantsOf(term: string): string[] {
  const plain = term.toLowerCase();
  const compact = plain.replace(/[^a-z0-9]+/g, "");
  const out = new Set<string>([plain, compact]);

  // Model names carry version numbers, and people read them aloud: "Qwen three",
  // "Llama four". Without this the digit is a hard mismatch against every
  // variant and the name is unreachable however clearly it was said.
  if (/[0-9]/.test(compact)) {
    const spoken = compact.replace(/[0-9]/g, (d) => DIGIT_WORDS[Number(d)]);
    out.add(spoken);
  }

  if (looksLikeAcronym(term)) {
    const letters = compact.split("");
    // One substitution at a time, not the combinatorial expansion: the pattern
    // that actually occurs is a single letter at the end being written as a
    // word ("MML you"), and the full product would be thousands of variants
    // per term for no gain.
    letters.forEach((ch, i) => {
      const name = LETTER_NAMES[ch];
      if (!name) return;
      out.add([...letters.slice(0, i), name, ...letters.slice(i + 1)].join(""));
    });
  }
  return [...out].filter(Boolean);
}

export interface BuildLexiconOptions {
  /** Node kinds worth learning. Others are ordinary English and cause false hits. */
  kinds?: readonly string[];
  extra?: { term: string; kind: string }[];
}

const DEFAULT_KINDS = ["model", "brand", "family", "benchmark", "provider"];

export function buildLexicon(g: AtlasGraph | null, opts: BuildLexiconOptions = {}): Lexicon {
  const kinds = new Set(opts.kinds ?? DEFAULT_KINDS);
  const seen = new Map<string, LexiconTerm>();

  const add = (term: string, kind: string) => {
    const key = term.toLowerCase();
    if (!term.trim() || seen.has(key)) return;
    // A single common word as a whole term is a false-positive machine.
    if (COMMON_WORDS.has(key)) return;
    seen.set(key, { term, kind, variants: variantsOf(term) });
  };

  for (const t of [...TECHNICAL_TERMS, ...(opts.extra ?? [])]) add(t.term, t.kind);
  if (g) {
    for (const n of g.nodes.values()) {
      if (kinds.has(n.kind)) add(n.label, n.kind);
    }
  }

  const terms = [...seen.values()];
  const exact = new Map<string, string>();
  const byKey = new Map<string, LexiconTerm[]>();
  let maxWords = 1;

  for (const t of terms) {
    for (const v of t.variants) {
      if (!exact.has(v)) exact.set(v, t.term);
      const key = phoneticKey(v);
      if (!key) continue;
      const list = byKey.get(key);
      if (list) {
        if (!list.includes(t)) list.push(t);
      } else byKey.set(key, [t]);
    }
    maxWords = Math.max(maxWords, t.term.trim().split(/\s+/).length);
  }

  return { terms, exact, byKey, maxWords };
}

export interface CorrectOptions {
  /** Minimum similarity for a replacement. */
  threshold?: number;
  /** How far the best candidate must beat the runner-up. Below it, leave the text. */
  margin?: number;
  /** Longest window, in words. Defaults to the lexicon's own longest term. */
  maxWindow?: number;
}

export const DEFAULT_THRESHOLD = 0.86;
export const DEFAULT_MARGIN = 0.08;

/**
 * A phonetic match is strong evidence, never perfect evidence.
 *
 * The skeleton throws information away, so two different words routinely share
 * a key. Left uncapped it scored "me a" against MMMU at a flat 1.0 - both
 * collapse to "m" - and that is how a voice interface starts rewriting ordinary
 * sentences into model names.
 */
export const PHONETIC_CAP = 0.95;

/** Keys shorter than this match far too much to be evidence of anything. */
export const MIN_KEY_LENGTH = 3;

/**
 * How close a *single* word must be in plain spelling, whatever it sounds like.
 *
 * The dominant false-positive shape is one ordinary English word colliding with
 * one short model name: "other" and "o3" (spoken "o three") reduce to the same
 * skeleton, so the phonetic score was a flat 0.95 and "no I meant the other
 * one" became "no I meant the o3 one". A word list can never be complete, so
 * this is the structural guard - a real mishearing is close in spelling too.
 * Multi-word windows are exempt: "MML you" is not meant to resemble "MMLU"
 * letter by letter.
 */
export const MIN_LITERAL_SINGLE = 0.6;

export interface Correction {
  from: string;
  to: string;
  kind: string;
  score: number;
  /** Word index of the replaced window. */
  at: number;
}

export interface CorrectResult {
  text: string;
  corrections: Correction[];
}

/**
 * Fix domain terms in a transcript.
 *
 * Windows are tried longest-first so "Nemo Tron" is corrected as a pair rather
 * than each half being examined alone and neither matching. Once a window is
 * replaced its words are consumed, so nothing is corrected twice.
 */
export function correctTranscript(
  text: string,
  lexicon: Lexicon,
  opts: CorrectOptions = {},
): CorrectResult {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const margin = opts.margin ?? DEFAULT_MARGIN;
  const maxWindow = Math.min(opts.maxWindow ?? lexicon.maxWords + 1, 4);

  const tokens = text.split(/(\s+)/);
  const wordIndexes: number[] = [];
  tokens.forEach((t, i) => {
    if (t.trim()) wordIndexes.push(i);
  });

  const corrections: Correction[] = [];
  let w = 0;
  while (w < wordIndexes.length) {
    let replaced = false;
    for (let size = Math.min(maxWindow, wordIndexes.length - w); size >= 1 && !replaced; size--) {
      const slice = wordIndexes.slice(w, w + size);
      const raw = slice.map((i) => tokens[i]).join(" ");
      const hit = bestMatch(raw, lexicon, threshold, margin);
      if (!hit) continue;

      // Preserve trailing punctuation the transcriber attached to the last word.
      const tail = tokens[slice[slice.length - 1]].match(/[.,!?;:]+$/)?.[0] ?? "";
      tokens[slice[0]] = hit.term + tail;
      for (let k = 1; k < slice.length; k++) {
        tokens[slice[k]] = "";
        // Remove the whitespace token that preceded it, so the join is clean.
        if (slice[k] - 1 >= 0) tokens[slice[k] - 1] = "";
      }
      corrections.push({ from: raw, to: hit.term, kind: hit.kind, score: hit.score, at: w });
      w += size;
      replaced = true;
    }
    if (!replaced) w += 1;
  }

  return { text: tokens.join("").replace(/\s{2,}/g, " ").trim(), corrections };
}

interface Match {
  term: string;
  kind: string;
  score: number;
}

function bestMatch(
  raw: string,
  lexicon: Lexicon,
  threshold: number,
  margin: number,
): Match | null {
  const cleaned = raw.toLowerCase().replace(/[.,!?;:]+$/, "").trim();
  if (!cleaned) return null;
  const words = cleaned.split(/\s+/);
  const compact = cleaned.replace(/[^a-z0-9]+/g, "");
  if (compact.length < 2) return null;

  // An exact spelling is decided before any guard runs. "Open Router" begins
  // with a common word and is still unambiguously OpenRouter; the guards below
  // are for uncertain matches, and this one is not uncertain.
  const exact = lexicon.exact.get(cleaned) ?? lexicon.exact.get(compact);
  if (exact) {
    // Already written correctly: rewriting it would churn text that was right.
    // Spelled differently but unambiguously the same term ("human eval", "M C
    // P", "Open Router") is a correction, and a certain one.
    if (cleaned === exact.toLowerCase()) return null;
    const t = lexicon.terms.find((x) => x.term === exact);
    return { term: exact, kind: t?.kind ?? "term", score: 1 };
  }

  // A domain term does not begin with an ordinary English word, and does not
  // end with one either unless that word is a letter read aloud - which is the
  // acronym case ("MML you") and the reason the exception exists at all.
  // Without this, longest-window-first grabbed the trailing word of "Meridian
  // 70B on" and corrected the phrase to itself.
  if (words.length > 1) {
    if (COMMON_WORDS.has(words[0])) return null;
    const last = words[words.length - 1];
    if (COMMON_WORDS.has(last) && !isLetterName(last)) return null;
  } else if (COMMON_WORDS.has(cleaned)) {
    // A single ordinary English word is never a mishearing worth fixing.
    return null;
  }

  const key = phoneticKey(compact);
  const usePhonetic = key.length >= MIN_KEY_LENGTH;
  const candidates = new Map<string, LexiconTerm>();
  if (usePhonetic) {
    for (const t of lexicon.byKey.get(key) ?? []) candidates.set(t.term, t);
    // Near-key neighbours, so a one-consonant slip is still reachable.
    for (const [k, list] of lexicon.byKey) {
      if (k.length < MIN_KEY_LENGTH) continue;
      if (Math.abs(k.length - key.length) > 1) continue;
      if (editDistance(k, key) <= 1) for (const t of list) candidates.set(t.term, t);
    }
  }
  // Literal neighbours too, so a term whose key is short is still reachable by
  // spelling alone rather than being unmatchable.
  for (const t of lexicon.terms) {
    if (candidates.has(t.term)) continue;
    const first = t.variants[0]?.replace(/[^a-z0-9]+/g, "") ?? "";
    if (Math.abs(first.length - compact.length) <= 2) candidates.set(t.term, t);
  }
  if (candidates.size === 0) return null;

  const singleWord = words.length === 1;
  const scored: Match[] = [];
  for (const t of candidates.values()) {
    let best = 0;
    for (const v of t.variants) {
      const vc = v.replace(/[^a-z0-9]+/g, "");
      const literal = similarity(compact, vc);
      // A single word must look like the term as well as sound like it.
      if (singleWord && literal < MIN_LITERAL_SINGLE) continue;
      const phonetic =
        usePhonetic && phoneticKey(vc).length >= MIN_KEY_LENGTH
          ? Math.min(similarity(key, phoneticKey(vc)), PHONETIC_CAP)
          : 0;
      best = Math.max(best, literal, phonetic);
    }
    if (best > 0) scored.push({ term: t.term, kind: t.kind, score: best });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score || (a.term < b.term ? -1 : 1));

  const top = scored[0];
  if (!top || top.score < threshold) return null;
  const runnerUp = scored.find((s) => s.term !== top.term);
  // Ambiguous means leave it alone. Two catalog models one edit apart is common,
  // and guessing between them is exactly the confident-wrong-answer failure.
  if (runnerUp && top.score - runnerUp.score < margin) return null;
  return top;
}
