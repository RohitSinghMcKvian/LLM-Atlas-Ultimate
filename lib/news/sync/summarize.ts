import { htmlToText } from "./html";

// Extractive summarisation.
//
// This takes the excerpt the publisher already chose to syndicate and trims it
// to a consistent length. It does not paraphrase, and it deliberately does not
// try to: paraphrasing without a model produces mangled prose, and paraphrasing
// *with* one is the optional enrichment pass in `llm.ts`, which most
// deployments will never run.
//
// COPYRIGHT POSTURE
//
// Every summary is (a) drawn only from what the feed itself publishes — Atlas
// never fetches or scrapes the article page — (b) hard-capped well below the
// length of the original, and (c) rendered next to the publisher's name, domain
// and a link to the source. That is the same posture a feed reader has taken for
// twenty years, and it is why `SUMMARY_MAX` is a cap rather than a target.

/** Hard ceiling on a stored summary. Roughly three sentences of news prose. */
export const SUMMARY_MAX = 320;

/**
 * Boilerplate publishers append to every syndicated item.
 *
 * These are matched against the flattened text and removed along with everything
 * after them, because they always sit at the end. Left in, they would eat a
 * third of the character budget on every WordPress-hosted source in the registry
 * and make three unrelated stories look like near-duplicates to the clusterer.
 */
const TRAILING_BOILERPLATE = [
  /\bthe post\b[^.]*\bappeared first on\b.*/is,
  /\bthis (?:post|article|story) (?:first )?appeared\b.*/is,
  /\bcontinue reading\b.*/is,
  /\bread more\b\s*(?:»|>>|→|\.\.\.)?\s*$/i,
  /\bsubscribe to\b[^.]*\bnewsletter\b.*/is,
  /\bsign up for\b[^.]*\bnewsletter\b.*/is,
  /\bshare this:.*/is,
  /\brelated:\s.*/is,
  /\bimage credits?:.*/is,
  /\bphoto(?: credit)?:\s*(?:getty|reuters|ap|shutterstock).*/is,
  /\bfollow us on\b.*/is,
  /\byou can (?:also )?(?:read|find) (?:the )?(?:full )?(?:story|article|post)\b.*/is,
];

/**
 * arXiv wraps every abstract in machine preamble. Stripping it is the difference
 * between a summary that starts "arXiv:2507.01234 Announce Type: new Abstract:"
 * and one that starts with the actual finding.
 */
const LEADING_NOISE = [
  /^arxiv:\s*\d{4}\.\d{4,5}(v\d+)?\s*/i,
  /^announce type:\s*\w+\s*/i,
  /^abstract:\s*/i,
  /^summary:\s*/i,
  /^\[[^\]]{1,40}\]\s*/, // "[Sponsored] ", "[Video] "
];

/** Sentence boundary that does not split on common abbreviations or decimals. */
const SENTENCE_END = /(?<![A-Z][a-z]\.)(?<!\b(?:Mr|Mrs|Ms|Dr|Prof|Inc|Ltd|Co|vs|etc|al|Fig|No|St)\.)(?<!\d)\.(?=\s+[A-Z0-9"“'(])/g;

function cleanup(text: string): string {
  let out = text.replace(/\s+/g, " ").trim();

  for (const pattern of LEADING_NOISE) out = out.replace(pattern, "").trim();
  for (const pattern of TRAILING_BOILERPLATE) out = out.replace(pattern, "").trim();

  // A dangling separator left behind by boilerplate removal.
  return out.replace(/[\s–—|·•,;:-]+$/, "").trim();
}

/**
 * A boundary marker inserted before splitting.
 *
 * `String.split` with a lookbehind-bearing pattern discards the delimiter, and
 * the period is part of the sentence — so the boundary is marked first and split
 * on afterwards. NUL cannot survive `htmlToText`, so it can never collide with
 * real content.
 */
const SENTINEL = "\u0000";

/** Split into sentences, keeping their terminating punctuation. */
function sentences(text: string): string[] {
  return text
    .replace(SENTENCE_END, `.${SENTINEL}`)
    .split(SENTINEL)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Cut at a word boundary and add an ellipsis, never mid-word. */
function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > max * 0.5 ? slice.slice(0, lastSpace) : slice;
  return `${cut.replace(/[\s,;:—–-]+$/, "")}…`;
}

export interface SummarizeInput {
  /** The feed's excerpt, still HTML. */
  summaryHtml?: string;
  /** The feed's full body, still HTML. Used only when the excerpt is too thin. */
  contentHtml?: string;
  /** Used to avoid a summary that merely restates the headline. */
  title?: string;
}

/**
 * Build the stored summary for an article.
 *
 * Deterministic: the same input always produces the same output, which is what
 * keeps the snapshot's content hash stable across syncs that fetched identical
 * data. Never returns markup, and never returns something longer than
 * `SUMMARY_MAX`.
 */
export function summarize(input: SummarizeInput): string {
  const excerpt = cleanup(htmlToText(input.summaryHtml));
  const body = cleanup(htmlToText(input.contentHtml));

  // Prefer the publisher's own excerpt — it is the summary they wrote. Fall back
  // to the body only when the excerpt is too thin to say anything, which is the
  // case for feeds that ship a title-only `<description>`.
  let source = excerpt.length >= 80 ? excerpt : body.length > excerpt.length ? body : excerpt;
  if (!source) return "";

  const title = (input.title ?? "").trim();
  if (title && source.toLowerCase().startsWith(title.toLowerCase())) {
    // Several feeds prefix the description with the headline verbatim. Dropping
    // it buys back a whole sentence of the character budget.
    const stripped = cleanup(source.slice(title.length));
    if (stripped.length >= 60) source = stripped;
  }

  const parts = sentences(source);
  if (!parts.length) return truncateAtWord(source, SUMMARY_MAX);

  let out = "";
  let taken = 0;
  for (const sentence of parts) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > SUMMARY_MAX) break;
    out = next;
    taken++;
    // Three sentences is enough context to decide whether to open the source,
    // which is all this summary is for.
    if (taken >= 3) break;
  }

  // A single sentence longer than the cap still needs to say something.
  if (!out) return truncateAtWord(parts[0], SUMMARY_MAX);
  return out.length > SUMMARY_MAX ? truncateAtWord(out, SUMMARY_MAX) : out;
}
