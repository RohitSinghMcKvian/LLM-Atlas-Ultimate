import { liveScore } from "./rank";
import type { NewsArticle, NewsSnapshot, NewsSnapshotRecord } from "./types";

// Pure snapshot helpers: freshness arithmetic and the wire projection.
//
// Split out of `store.ts` because that module is `server-only` and pulls in
// `next/cache`, `next/server` and the Supabase client — none of which exist in a
// plain Node test process. These functions are the ones with actual logic worth
// pinning (the staleness boundary, the refresh cooldown), and the refresh route,
// the client sync pill and the tests all need to agree on them.
//
// Same split as `lib/catalog/snapshot.ts` (light, shared) versus
// `lib/catalog/store.ts` (server-only).

function envInt(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = Number(env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Minutes before a served corpus is stale enough to trigger a background refresh. */
export function syncIntervalMinutes(env: Record<string, string | undefined> = process.env): number {
  return envInt(env, "ATLAS_NEWS_SYNC_INTERVAL_MINUTES", 60);
}

/**
 * Minimum minutes between upstream sweeps, however many refreshes are requested.
 *
 * This is the load-bearing number behind the public Refresh button: a per-IP
 * rate limit shapes one abuser, but this caps the entire internet at one sweep
 * per window — strictly less upstream traffic than the hourly cron itself.
 */
export function minRefreshMinutes(env: Record<string, string | undefined> = process.env): number {
  return envInt(env, "ATLAS_NEWS_MIN_REFRESH_MINUTES", 10);
}

export function isStale(
  snapshot: Pick<NewsSnapshot, "syncedAt">,
  now = Date.now(),
  env: Record<string, string | undefined> = process.env,
): boolean {
  const age = now - Date.parse(snapshot.syncedAt);
  // An unparseable timestamp is treated as stale: better one wasted sweep than a
  // corpus that can never refresh because its own clock field is corrupt.
  return !Number.isFinite(age) || age > syncIntervalMinutes(env) * 60_000;
}

/**
 * How long until a manual refresh would actually reach upstream, in ms.
 *
 * Zero means a sweep would run now.
 */
export function refreshCooldownMs(
  snapshot: Pick<NewsSnapshot, "syncedAt">,
  now = Date.now(),
  env: Record<string, string | undefined> = process.env,
): number {
  const age = now - Date.parse(snapshot.syncedAt);
  if (!Number.isFinite(age)) return 0;
  return Math.max(0, minRefreshMinutes(env) * 60_000 - age);
}

/**
 * Strip the server-only bookkeeping before a record crosses the RSC boundary.
 *
 * `limit` caps how many articles travel in the RSC payload. A full corpus is
 * ~600 articles at ~700 bytes of serialized props each, and the /news page
 * embeds them twice (HTML plus the flight payload) — measured at 2.2 MB of
 * document for 238 articles, which is enough to take a dev server out. The page
 * ships the highest-ranked slice and `NewsClient` fetches the tail from
 * `/api/v1/news?offset=` after mount, so nothing is lost and first paint is
 * bounded. Clusters, sources and stats are never truncated: they describe the
 * whole corpus and are small.
 */
export function toWireNews(
  record: NewsSnapshotRecord | NewsSnapshot,
  options: { limit?: number } = {},
): NewsSnapshot {
  const { limit } = options;
  const articles =
    limit !== undefined && record.articles.length > limit
      ? rankedForWire(record.articles).slice(0, limit)
      : record.articles;

  return {
    version: record.version,
    syncedAt: record.syncedAt,
    origin: record.origin,
    articles,
    clusters: record.clusters,
    stats: record.stats,
    sources: record.sources,
    imageHosts: record.imageHosts,
    warnings: record.warnings,
    enrichment: record.enrichment,
  };
}

/**
 * The same ordering `/api/v1/news` applies, so the page's slice and the tail the
 * client pages in are two halves of one list rather than two overlapping ones.
 */
function rankedForWire(articles: readonly NewsArticle[], now = Date.now()): NewsArticle[] {
  return articles
    .map((article) => ({ article, score: liveScore(article, now) }))
    .sort((a, b) => b.score - a.score || (a.article.id < b.article.id ? -1 : 1))
    .map((entry) => entry.article);
}

// --- Per-IP token bucket ----------------------------------------------------
//
// Used by the public refresh route. Pure and injectable so its refill and
// eviction behaviour can be tested without faking timers or a request context.

export interface TokenBucket {
  tokens: number;
  updatedAt: number;
}

export interface BucketConfig {
  capacity: number;
  /** Milliseconds for the bucket to refill from empty to full. */
  refillMs: number;
}

export const REFRESH_BUCKET: BucketConfig = { capacity: 4, refillMs: 10 * 60_000 };

/** Idle buckets older than this are dropped, so the map cannot grow without bound. */
export const BUCKET_IDLE_MS = 30 * 60_000;

export interface BucketDecision {
  allowed: boolean;
  /** Seconds until the next token, for `Retry-After`. Zero when allowed. */
  retryAfterSeconds: number;
}

/**
 * Take one token, mutating the map in place.
 *
 * Continuous refill rather than fixed windows: a fixed window lets a client
 * spend its whole allowance at 11:59 and again at 12:00.
 */
export function takeToken(
  buckets: Map<string, TokenBucket>,
  key: string,
  now: number,
  config: BucketConfig = REFRESH_BUCKET,
): BucketDecision {
  // Sweep on write. There is no timer in a serverless function, so eviction has
  // to ride along with normal traffic.
  for (const [id, bucket] of buckets) {
    if (now - bucket.updatedAt > BUCKET_IDLE_MS) buckets.delete(id);
  }

  const ratePerMs = config.capacity / config.refillMs;
  const existing = buckets.get(key);
  const tokens = existing
    ? Math.min(config.capacity, existing.tokens + (now - existing.updatedAt) * ratePerMs)
    : config.capacity;

  if (tokens < 1) {
    buckets.set(key, { tokens, updatedAt: now });
    return { allowed: false, retryAfterSeconds: Math.ceil((1 - tokens) / ratePerMs / 1000) };
  }

  buckets.set(key, { tokens: tokens - 1, updatedAt: now });
  return { allowed: true, retryAfterSeconds: 0 };
}
