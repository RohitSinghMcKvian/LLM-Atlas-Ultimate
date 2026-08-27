/**
 * Spoken forms into written ones.
 *
 * A transcriber returns what was said, and what was said about this domain is
 * full of quantities: "one point two five dollars per million", "seventy b",
 * "one twenty eight k context", "tokens per second". Left alone they reach the
 * model as prose, and a model asked to compare "one point two five" with
 * "zero point three five" does arithmetic on words.
 *
 * Pure and ordered: the longest, most specific patterns run first, because
 * "dollars per million tokens" must not be half-consumed by "per million".
 */

const ONES: Record<string, number> = {
  zero: 0,
  oh: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const NUMBER_WORDS = [...Object.keys(ONES), ...Object.keys(TENS), "hundred", "thousand"];

/**
 * Turn a run of number words into a number.
 *
 * Handles the shapes that actually occur when someone reads a model name or a
 * price out loud - "seventy", "seventy two", "one hundred twenty eight", "one
 * point five" - and nothing more. A general number parser would be larger and
 * would start "correcting" ordinary prose that happens to contain "one".
 */
export function wordsToNumber(words: readonly string[]): number | null {
  if (words.length === 0) return null;
  let total = 0;
  let current = 0;
  let seen = false;
  // Magnitude of the previous word, so a descending run is rejected rather than
  // summed. "Gemma four thirty one" is a name and a size, not the number 35 -
  // and summing it silently produced "Gemma 35B", a model that does not exist.
  let lastMagnitude = Infinity;

  for (const raw of words) {
    const w = raw.toLowerCase();
    if (w in ONES) {
      if (ONES[w] >= lastMagnitude) return null;
      lastMagnitude = ONES[w] >= 10 ? 10 : 1;
      current += ONES[w];
      seen = true;
    } else if (w in TENS) {
      if (lastMagnitude <= 10) return null;
      lastMagnitude = 10;
      current += TENS[w];
      seen = true;
    } else if (w === "hundred") {
      // A multiplier opens a new group, so the descending check restarts:
      // "one hundred twenty eight" is well formed even though 1 precedes 20.
      lastMagnitude = Infinity;
      current = (current || 1) * 100;
      seen = true;
    } else if (w === "thousand") {
      lastMagnitude = Infinity;
      total += (current || 1) * 1000;
      current = 0;
      seen = true;
    } else {
      return null;
    }
  }
  return seen ? total + current : null;
}

interface Rule {
  re: RegExp;
  /** `null` declines the rewrite and leaves the matched text alone. */
  to: (m: RegExpMatchArray) => string | null;
}

/** Apply `fn` only when the quantity parsed. */
function nz(value: string | null, fn: (v: string) => string): string | null {
  return value === null ? null : fn(value);
}

const NUM = `(?:${NUMBER_WORDS.join("|")})`;
const NUM_RUN = `(?:${NUM}(?:[ -]${NUM})*)`;
/** A literal number the transcriber already wrote, or one spelled out. */
const QTY = `(\\d[\\d,]*(?:\\.\\d+)?|${NUM_RUN})`;

/** `null` when the words are not a well-formed number, so the rule can decline. */
function quantity(raw: string): string | null {
  const cleaned = raw.trim().toLowerCase();
  if (/^\d/.test(cleaned)) return cleaned.replace(/,/g, "");
  const n = wordsToNumber(cleaned.split(/[ -]+/));
  return n === null ? null : String(n);
}

/**
 * Ordered rules. Longest-match first.
 *
 * Every rule is anchored on a *unit* - dollars, tokens, a context window, a
 * parameter count - not on a bare number. Rewriting bare numbers is how a
 * normaliser starts mangling ordinary sentences.
 */
const RULES: Rule[] = [
  // "one point two five dollars per million (tokens)" -> "$1.25/M"
  {
    re: new RegExp(`${QTY}(?:\\s+point\\s+((?:${NUM}|\\d)(?:\\s+(?:${NUM}|\\d))*))?\\s+dollars?\\s+(?:per|a)\\s+million(?:\\s+tokens?)?`, "gi"),
    to: (m) => nz(decimal(m[1], m[2]), (v) => `$${v}/M`),
  },
  // "fifty cents per million"
  {
    re: new RegExp(`${QTY}\\s+cents?\\s+(?:per|a)\\s+million(?:\\s+tokens?)?`, "gi"),
    to: (m) => nz(quantity(m[1]), (v) => `$${(Number(v) / 100).toFixed(2)}/M`),
  },
  // "one point two five dollars" -> "$1.25"
  {
    re: new RegExp(`${QTY}(?:\\s+point\\s+((?:${NUM}|\\d)(?:\\s+(?:${NUM}|\\d))*))?\\s+dollars?`, "gi"),
    to: (m) => nz(decimal(m[1], m[2]), (v) => `$${v}`),
  },
  // "one twenty eight k context" -> "128k context"
  {
    re: new RegExp(`${QTY}\\s*k\\b`, "gi"),
    to: (m) => nz(quantity(m[1]), (v) => `${v}k`),
  },
  // "seventy b" / "seventy be" / "seventy billion parameters" -> "70B"
  //
  // "be" is here because that is what a transcriber writes when someone reads
  // the letter B aloud - it is a word and "b" is not. Same reason
  // `lib/voice/lexicon.ts` generates letter-name variants for acronyms.
  {
    re: new RegExp(`${QTY}\\s*(?:b\\b|be\\b|billion(?:\\s+param(?:eter)?s?)?)`, "gi"),
    to: (m) => nz(quantity(m[1]), (v) => `${v}B`),
  },
  // "eight million tokens" -> "8M tokens"
  {
    re: new RegExp(`${QTY}\\s+million\\b`, "gi"),
    to: (m) => nz(quantity(m[1]), (v) => `${v}M`),
  },
  // "tokens per second" -> "tok/s"
  { re: /\btokens?\s+per\s+second\b/gi, to: () => "tok/s" },
  { re: /\bmilliseconds?\b/gi, to: () => "ms" },
  // "point nine" as a bare decimal only when it follows a digit we just wrote.
  { re: /(\d)\s+percent\b/gi, to: (m) => `${m[1]}%` },
];

function decimal(whole: string, fraction?: string): string | null {
  const w = quantity(whole);
  if (w === null) return null;
  if (!fraction) return w;
  const digits = fraction
    .trim()
    .split(/\s+/)
    .map((d) => (/^\d$/.test(d) ? d : String(wordsToNumber([d]) ?? "")))
    .join("");
  return digits ? `${w}.${digits}` : w;
}

/**
 * Rewrite spoken quantities in a transcript.
 *
 * Idempotent: running it on already-written text changes nothing, because every
 * rule requires a spoken unit word that the written form no longer contains.
 */
export function normalizeSpoken(text: string): string {
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.re, (...args) => {
      const m = args as unknown as RegExpMatchArray;
      // A rule that cannot parse its quantity leaves the text exactly as it
      // was. Emitting a half-rewritten phrase is worse than not rewriting.
      return rule.to(m) ?? m[0];
    });
  }
  return out;
}
