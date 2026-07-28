import { AI_RELEVANCE_TERMS, TOPIC_IDS, TOPIC_LEXICON } from "../topics";
import type { NewsTopic } from "../types";

// Topic assignment and the AI-relevance gate.
//
// Deterministic weighted keyword matching. Two reasons it is not a model call:
// the sync has to produce a complete, correctly-tagged corpus on a deployment
// with no API keys at all, and a keyword table can be inspected, tested, and
// corrected by anyone reading the diff. When the optional LLM pass runs it may
// refine a *summary*; it is never allowed to rewrite topics, because a filter
// that silently changes meaning between deployments is worse than one that is
// occasionally coarse.

/** No article carries more than this many topics — a chip row is not a tag cloud. */
export const MAX_TOPICS = 3;

/**
 * Build a matcher for a lexicon term.
 *
 * Word boundaries matter more than they look: without them "ai" fires on
 * "chain", "said", and "maintain", and "gpt" fires on nothing useful at all.
 * `\b` is wrong at the edges of terms that begin or end with a non-word
 * character (".ai", "a.i."), so the boundary is asserted with lookarounds
 * against the actual characters instead.
 */
function termPattern(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Allow a hyphen or a space to stand in for a space in multi-word terms:
  // "open source" must also match "open-source".
  const body = escaped.replace(/ /g, "[\\s-]+");
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, "i");
}

/** Compiled once per process — a sync classifies hundreds of articles. */
const LEXICON_PATTERNS: Record<NewsTopic, { re: RegExp; weight: number }[]> = Object.fromEntries(
  TOPIC_IDS.map((topic) => [
    topic,
    TOPIC_LEXICON[topic].map(({ term, weight }) => ({ re: termPattern(term), weight })),
  ]),
) as Record<NewsTopic, { re: RegExp; weight: number }[]>;

const AI_PATTERNS = AI_RELEVANCE_TERMS.map(termPattern);

/**
 * Does this item belong in an AI news corpus at all?
 *
 * Applied only to feeds flagged `requiresAiFilter` — general technology sections
 * and personal blogs. A lab's own announcement feed is on-topic by construction,
 * and running a keyword gate over it would only produce false negatives on
 * genuinely new terminology, which is precisely the news worth having.
 */
export function isAiRelevant(text: string): boolean {
  return AI_PATTERNS.some((re) => re.test(text));
}

export interface ClassifyInput {
  title: string;
  summary: string;
  /** Feed-declared categories. Weak evidence, but free. */
  categories?: readonly string[];
  /** Topics the source always implies. Seeds the score, never overrides it. */
  hints?: readonly NewsTopic[];
}

/**
 * Assign 1–3 topics.
 *
 * The title is weighted more heavily than the summary because a headline is
 * written to say what the story is about, whereas a summary drifts into context.
 * Every article gets at least one topic: an untagged article is invisible the
 * moment a reader touches a filter chip, which is a worse failure than a
 * slightly wrong tag.
 */
export function classify(input: ClassifyInput): NewsTopic[] {
  const title = input.title ?? "";
  const summary = input.summary ?? "";
  const categoryText = (input.categories ?? []).join(" ");

  const scores = new Map<NewsTopic, number>();
  const bump = (topic: NewsTopic, amount: number) => {
    scores.set(topic, (scores.get(topic) ?? 0) + amount);
  };

  for (const topic of TOPIC_IDS) {
    for (const { re, weight } of LEXICON_PATTERNS[topic]) {
      // A term counts once per field, not once per occurrence — otherwise a
      // single word repeated in a long body outranks three distinct signals.
      if (re.test(title)) bump(topic, weight * 2);
      if (re.test(summary)) bump(topic, weight);
      if (categoryText && re.test(categoryText)) bump(topic, weight * 0.5);
    }
  }

  // Hints are a floor, not a verdict: enough to win a tie, not enough to beat
  // real evidence from the text.
  for (const hint of input.hints ?? []) bump(hint, 1.5);

  const ranked = [...scores.entries()]
    .filter(([, score]) => score > 0)
    // Ties broken by taxonomy order so the result is stable across runs — an
    // unstable tag order would change the content hash on every sync.
    .sort((a, b) => b[1] - a[1] || TOPIC_IDS.indexOf(a[0]) - TOPIC_IDS.indexOf(b[0]));

  if (!ranked.length) {
    return input.hints?.length ? [input.hints[0]] : ["models"];
  }

  // Keep only topics within reach of the winner. Without this, a strong "models"
  // score drags along a "pricing" that scored 1 from a single passing mention,
  // and every article ends up with three chips.
  const top = ranked[0][1];
  const threshold = Math.max(2, top * 0.4);

  const chosen = ranked
    .filter(([, score], index) => index === 0 || score >= threshold)
    .slice(0, MAX_TOPICS)
    .map(([topic]) => topic);

  return chosen;
}

/**
 * Score how strongly an item reads as AI news, 0..1.
 *
 * Feeds into `baseScore` so that, between two equally-trusted sources, the item
 * that is unambiguously about AI ranks above the one that merely mentions it.
 */
export function relevanceScore(text: string): number {
  let hits = 0;
  for (const re of AI_PATTERNS) {
    if (re.test(text)) hits++;
    if (hits >= 6) break;
  }
  return Math.min(1, hits / 6);
}
