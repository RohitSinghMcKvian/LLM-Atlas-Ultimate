import type { NewsArticle, Verification } from "./types";

// Ranking, split into two halves that run at different times.
//
// THE SPLIT IS THE WHOLE POINT
//
// `baseScore` is everything about an article that does NOT change with the clock
// — source trust, corroboration, topical relevance, how complete the enrichment
// is. It is computed once at sync time and stored.
//
// `liveScore` applies recency decay at render.
//
// Folding recency into the stored score would be the obvious thing to do and it
// would be a quiet disaster: the score changes every hour, so the snapshot's
// content hash changes every hour, so `/api/v1/news`'s ETag never matches, the
// CDN never serves a cached copy, and Supabase stores a fresh half-megabyte
// snapshot row on every single sync forever — all while nothing upstream
// actually moved. Hence `NewsSnapshot.version` hashes only identity fields, and
// hence this file.

const LEVEL_BONUS: Record<Verification["level"], number> = {
  verified: 26,
  corroborated: 16,
  reported: 6,
  unconfirmed: 0,
};

const TIER_BONUS: Record<NewsArticle["tier"], number> = {
  first_party: 16,
  research: 11,
  analyst: 9,
  press: 6,
};

export interface BaseScoreInput {
  tier: NewsArticle["tier"];
  sourceWeight: number;
  verification: Verification;
  /** 0..1 from `classify.relevanceScore` — how unambiguously this is AI news. */
  relevance: number;
  topicCount: number;
  modelCount: number;
  hasImage: boolean;
  summaryLength: number;
}

/**
 * The recency-independent half of the rank, 0..100.
 *
 * Deliberately dominated by trust and corroboration rather than by presentation:
 * an item should not out-rank a better-sourced one because it happened to ship a
 * hero image. The image and summary terms are small tie-breakers that keep the
 * magazine layout from filling its lead slot with a card that has nothing to show.
 */
export function baseScore(input: BaseScoreInput): number {
  let score = 0;

  score += LEVEL_BONUS[input.verification.level];
  score += TIER_BONUS[input.tier];
  score += input.sourceWeight * 14;

  // Corroboration past the second domain, with diminishing return — five
  // publishers is not five times the evidence of two.
  const extraDomains = Math.max(0, input.verification.distinctDomains - 1);
  score += Math.min(14, extraDomains * 7);

  score += input.relevance * 12;

  // Enrichment completeness. An article we could not classify or link is one we
  // understand less well, and it should rank below one we do.
  if (input.topicCount > 0) score += 3;
  score += Math.min(6, input.modelCount * 2);
  if (input.hasImage) score += 4;
  if (input.summaryLength >= 120) score += 4;
  else if (input.summaryLength >= 40) score += 2;

  return clamp(score);
}

/** Hours after which a story has lost half its recency weight. */
const HALF_LIFE_HOURS = 20;

/**
 * Exponential recency decay, 1 at publication falling toward 0.
 *
 * Exponential rather than a step function so ordering is continuous: with
 * buckets, an article crossing "24 hours old" jumps down the page between one
 * render and the next for no reason the reader can see.
 */
export function recencyFactor(publishedAt: string, now = Date.now()): number {
  const ms = now - Date.parse(publishedAt);
  if (!Number.isFinite(ms)) return 0.2;
  const hours = Math.max(0, ms / 3_600_000);
  return 2 ** (-hours / HALF_LIFE_HOURS);
}

/**
 * The score the feed actually sorts by, 0..100.
 *
 * Recency is a multiplier on a floor rather than an additive term: a
 * well-sourced week-old story should still rank above a thin one from an hour
 * ago, but nothing should sit at the top of a *news* feed for a week. The 0.35
 * floor is what stops the feed from becoming a pure reverse-chronological list
 * the moment everything is a few days old.
 */
export function liveScore(article: Pick<NewsArticle, "baseScore" | "publishedAt">, now = Date.now()): number {
  const recency = recencyFactor(article.publishedAt, now);
  return clamp(article.baseScore * (0.35 + 0.65 * recency));
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}
