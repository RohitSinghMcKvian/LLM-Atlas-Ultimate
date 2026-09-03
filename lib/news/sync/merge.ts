import { fnv1a } from "@/lib/catalog/sync/normalize";
import { activeFeeds, type FeedSource } from "../feeds";
import { baseScore } from "../rank";
import { TOPIC_IDS } from "../topics";
import type {
  NewsArticle,
  NewsCluster,
  NewsSnapshotRecord,
  NewsSourceResult,
  NewsSourceSummary,
  NewsStats,
  NewsTopic,
} from "../types";
import { relevanceScore } from "./classify";
import { clusterArticles } from "./cluster";
import type { FeedFetchOutcome, RawArticle } from "./types";
import { bestVerification, verifyArticle, type ClusterEvidence } from "./verify";

// Folding one sync's results into a new snapshot record.
//
// The doctrine is inherited from `lib/catalog/sync/merge.ts` and is worth
// restating because it is the whole reason an hourly job against 37 third
// parties is safe to run unattended:
//
//   **A failed source removes nothing.**
//
// A feed that times out, 404s, or returns an error page contributes no new
// articles — but its existing articles carry forward from the previous snapshot
// untouched. Combined with the sanity gates below, that means the corpus can
// only be emptied by a deliberate change, never by a bad afternoon at a CDN.

export interface MergeOptions {
  outcomes: readonly FeedFetchOutcome[];
  previous?: NewsSnapshotRecord | null;
  now?: number;
  retentionDays?: number;
  maxArticles?: number;
  /** Whether the optional LLM enrichment pass ran. */
  llmEnriched?: boolean;
  /** Feeds that were in scope for this run; defaults to the active registry. */
  feeds?: readonly FeedSource[];
  /**
   * The previous corpus, already rehydrated.
   *
   * Passed in when the caller needed the carried articles *before* the merge —
   * `runNewsSync` does, because the OpenGraph image pass runs over the whole
   * corpus rather than only over what this sweep fetched. Rehydrating twice
   * would be wasteful and, worse, would discard the images that pass just found.
   */
  carried?: readonly RawArticle[];
  /** Ids the OpenGraph pass tried and failed on this run. */
  imageMissed?: readonly string[];
}

export interface MergeResult {
  record: NewsSnapshotRecord;
  /** False when a sanity gate rejected the run and the previous corpus was kept. */
  ok: boolean;
}

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export function mergeNews(options: MergeOptions): MergeResult {
  const {
    outcomes,
    previous = null,
    now = Date.now(),
    retentionDays = envInt("ATLAS_NEWS_RETENTION_DAYS", 14),
    maxArticles = envInt("ATLAS_NEWS_MAX_ARTICLES", 600),
    llmEnriched = false,
    feeds = activeFeeds(),
  } = options;

  const warnings: string[] = [];
  const results: Record<string, NewsSourceResult> = {};
  const validators: Record<string, { etag?: string; lastModified?: string }> = {
    ...(previous?.validators ?? {}),
  };

  for (const outcome of outcomes) {
    results[outcome.feed.id] = outcome.result;
    if (outcome.etag || outcome.lastModified) {
      validators[outcome.feed.id] = { etag: outcome.etag, lastModified: outcome.lastModified };
    }
  }

  // --- Sanity gate 1: did anything succeed at all? -------------------------
  //
  // Every feed failing is a symptom of *our* environment — no egress, a bad
  // deploy, a clock so wrong that TLS fails — not of 37 publishers going down
  // together. Publishing an empty corpus on that evidence would be wrong.
  const attempted = outcomes.filter((o) => o.result.status !== "disabled");
  // `skipped` counts as a success here: the publisher answered with a valid feed
  // that had nothing in it. It contributed no articles, but it is evidence that
  // our egress works, which is the only thing this gate is testing for.
  const succeeded = attempted.filter(
    (o) =>
      o.result.status === "ok" ||
      o.result.status === "not_modified" ||
      o.result.status === "skipped",
  );

  if (attempted.length > 0 && succeeded.length === 0) {
    warnings.push(
      `All ${attempted.length} sources failed — keeping the previous corpus. ${describeFailures(outcomes)}`,
    );
    return { record: carryForward(previous, now, results, validators, warnings, feeds), ok: false };
  }

  const failed = attempted.filter((o) => o.result.status === "failed");
  if (failed.length) {
    warnings.push(
      `${failed.length} of ${attempted.length} sources failed: ${failed
        .map((o) => o.feed.name)
        .slice(0, 6)
        .join(", ")}${failed.length > 6 ? "…" : ""}`,
    );
  }

  // --- Combine fresh articles with the carried-forward corpus ---------------

  const fresh = outcomes.flatMap((o) => o.articles);
  const carried = options.carried ?? carriedArticles(previous);

  // A fresh copy wins over a carried one for everything the FEED asserts: the
  // publisher may have corrected a headline or a summary, and their version is
  // authoritative.
  //
  // It does NOT win for enrichment we derived ourselves. An image recovered from
  // the article's `og:image` by `sync/og.ts` is not something the feed has an
  // opinion about — a re-parsed item simply has no image field at all — so
  // letting the fresh copy overwrite it would throw the image away on the very
  // next sweep. That defect is invisible in one run and devastating over a day:
  // the OpenGraph pass enriches a bounded number of articles per sweep, so
  // coverage is supposed to ACCUMULATE towards the whole corpus. Overwriting
  // would have pinned it to whatever one run managed, permanently.
  //
  // `firstSeen` is preserved for a related reason: "new since your last visit"
  // must not reset because a publisher edited a post.
  const byId = new Map<string, RawArticle>();
  for (const article of carried) byId.set(article.id, article);
  for (const article of fresh) {
    const existing = byId.get(article.id);
    if (!existing) {
      byId.set(article.id, article);
      continue;
    }
    byId.set(article.id, {
      ...article,
      firstSeenAt: existing.firstSeenAt,
      // Carried enrichment survives a fresh copy that lacks it. A fresh copy
      // that HAS an image still wins — the publisher changed their artwork.
      image: article.image ?? existing.image,
      abstract: article.abstract ?? existing.abstract,
    });
  }

  const firstSeen: Record<string, string> = { ...(previous?.firstSeen ?? {}) };
  for (const article of byId.values()) {
    const known = firstSeen[article.id];
    if (known) article.firstSeenAt = known;
    else firstSeen[article.id] = article.firstSeenAt;
  }

  // --- Retention ------------------------------------------------------------

  const cutoff = now - retentionDays * 86_400_000;
  const retired = new Set(previous?.retired ?? []);

  let kept = [...byId.values()].filter((article) => {
    const published = Date.parse(article.publishedAt);
    return !Number.isFinite(published) || published >= cutoff;
  });

  // Rank before the cap so the cap drops the least valuable, not the newest.
  // `baseScore` is recency-independent, so a story is never pruned for being old
  // *here* — retention above already handled age.
  const scored = kept.map((article) => ({ article, score: provisionalScore(article) }));
  scored.sort((a, b) => b.score - a.score || compareIds(a.article, b.article));

  if (scored.length > maxArticles) {
    for (const { article } of scored.slice(maxArticles)) retired.add(article.id);
  }
  kept = scored.slice(0, maxArticles).map((s) => s.article);

  // --- Sanity gate 2: did the corpus collapse? -----------------------------
  //
  // A drop this large without every source failing means something subtler went
  // wrong — a parser regression, a bad denylist, a relevance gate that suddenly
  // rejects everything. Keeping the previous corpus makes that visible in the
  // warnings strip instead of silently emptying the page.
  const previousCount = previous?.articles.length ?? 0;
  if (previousCount >= 40 && kept.length < previousCount * 0.4) {
    warnings.push(
      `Article count fell from ${previousCount} to ${kept.length} — keeping the previous corpus.`,
    );
    return { record: carryForward(previous, now, results, validators, warnings, feeds), ok: false };
  }

  // --- Cluster, verify, score ----------------------------------------------

  const { clusterOf, members, leads } = clusterArticles(kept);
  const byArticleId = new Map(kept.map((a) => [a.id, a]));

  const evidenceByCluster = new Map<string, ClusterEvidence>();
  for (const [id, memberIds] of members) {
    const group = memberIds.map((m) => byArticleId.get(m)!).filter(Boolean);
    evidenceByCluster.set(id, {
      domains: group.map((a) => a.domain),
      sourceIds: group.map((a) => a.sourceId),
      hasFirstParty: group.some((a) => a.tier === "first_party" && a.domainMatch),
    });
  }

  const articles: NewsArticle[] = kept.map((raw) => {
    const cluster = clusterOf.get(raw.id)!;
    const evidence = evidenceByCluster.get(cluster)!;
    const verification = verifyArticle(raw, evidence);

    return {
      id: raw.id,
      title: raw.title,
      summary: raw.summary,
      abstract: raw.abstract,
      url: raw.url,
      domain: raw.domain,
      host: raw.host,
      sourceId: raw.sourceId,
      sourceName: raw.sourceName,
      tier: raw.tier,
      brand: raw.brand,
      author: raw.author,
      publishedAt: raw.publishedAt,
      firstSeenAt: raw.firstSeenAt,
      topics: raw.topics,
      models: raw.models,
      orgs: raw.orgs,
      image: raw.image,
      baseScore: baseScore({
        tier: raw.tier,
        sourceWeight: raw.sourceWeight,
        verification,
        relevance: relevanceScore(`${raw.title} ${raw.summary}`),
        topicCount: raw.topics.length,
        modelCount: raw.models.length,
        hasImage: Boolean(raw.image),
        summaryLength: raw.summary.length,
      }),
      verification,
      clusterId: cluster,
      lead: leads.get(cluster) === raw.id,
      readMinutes: raw.readMinutes,
    };
  });

  // Newest first is the natural storage order; the client re-sorts by `liveScore`.
  articles.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || (a.id < b.id ? -1 : 1));

  const articleById = new Map(articles.map((a) => [a.id, a]));

  const clusters: NewsCluster[] = [...members.entries()]
    .map(([id, memberIds]) => {
      const group = memberIds.map((m) => articleById.get(m)!).filter(Boolean);
      if (!group.length) return null;
      const times = group.map((a) => Date.parse(a.publishedAt)).filter(Number.isFinite);
      return {
        id,
        leadId: leads.get(id)!,
        memberIds: group.map((a) => a.id),
        domains: [...new Set(group.map((a) => a.domain))].sort(),
        topics: [...new Set(group.flatMap((a) => a.topics))],
        models: [...new Set(group.flatMap((a) => a.models))],
        latestAt: new Date(times.length ? Math.max(...times) : now).toISOString(),
        firstAt: new Date(times.length ? Math.min(...times) : now).toISOString(),
        baseScore: Math.max(...group.map((a) => a.baseScore)),
        verification: bestVerification(group.map((a) => a.verification)),
      } satisfies NewsCluster;
    })
    .filter((c): c is NewsCluster => c !== null)
    .sort((a, b) => Date.parse(b.latestAt) - Date.parse(a.latestAt) || (a.id < b.id ? -1 : 1));

  // --- Bookkeeping ----------------------------------------------------------

  const signatures: Record<string, string[]> = {};
  for (const raw of kept) signatures[raw.id] = raw.signature;

  // Failed image lookups, accumulated and then pruned to what is still in the
  // corpus. Pruning here rather than on write is what stops the map growing
  // without bound across months of hourly syncs — the same treatment
  // `firstSeen` gets a few lines below.
  const liveArticleIds = new Set(kept.map((raw) => raw.id));
  const imageMisses: Record<string, number> = {};
  for (const [id, count] of Object.entries(previous?.imageMisses ?? {})) {
    if (liveArticleIds.has(id)) imageMisses[id] = count;
  }
  for (const id of options.imageMissed ?? []) {
    if (liveArticleIds.has(id)) imageMisses[id] = (imageMisses[id] ?? 0) + 1;
  }

  // Prune `firstSeen` down to what is still reachable, so it does not grow
  // without bound across months of hourly syncs.
  const liveIds = new Set(articles.map((a) => a.id));
  const prunedFirstSeen: Record<string, string> = {};
  for (const id of liveIds) prunedFirstSeen[id] = firstSeen[id] ?? new Date(now).toISOString();

  const imageHosts = [
    ...new Set(articles.map((a) => a.image?.host).filter((h): h is string => Boolean(h))),
  ].sort();

  const sources = summarizeSources(feeds, results, articles);
  const stats = computeStats(articles, clusters, sources, now);

  const record: NewsSnapshotRecord = {
    version: hashArticles(articles),
    syncedAt: new Date(now).toISOString(),
    origin: "synced",
    articles,
    clusters,
    stats,
    sources,
    imageHosts,
    warnings,
    enrichment: { deterministic: true, llm: llmEnriched },
    results,
    validators,
    firstSeen: prunedFirstSeen,
    signatures,
    // Bounded: only the most recent retirements matter, and only to stop a
    // re-crawled item being announced as "new" twice.
    retired: [...retired].slice(-2_000),
    imageMisses,
  };

  return { record, ok: failed.length === 0 };
}

// --- Helpers ----------------------------------------------------------------

/**
 * The snapshot's content hash.
 *
 * Covers identity fields ONLY — never scores, never counts, never `syncedAt`.
 *
 * This is the subtlest constraint in the whole feature. Scores derived from
 * recency change every hour by definition; folding them into the hash would mint
 * a new version on every sync forever, which defeats the ETag on `/api/v1/news`,
 * defeats the CDN, and makes Supabase store a fresh half-megabyte row hourly —
 * all while nothing upstream actually moved.
 */
export function hashArticles(articles: readonly NewsArticle[]): string {
  const canonical = articles
    .map((a) => `${a.id}|${a.publishedAt}|${a.title}|${a.url}`)
    .sort()
    .join("\n");
  return fnv1a(canonical);
}

/** Rank used only to decide what the retention cap drops. */
function provisionalScore(article: RawArticle): number {
  const weight = article.sourceWeight * 40;
  const tier = article.tier === "first_party" ? 30 : article.tier === "research" ? 20 : 10;
  const enrichment = (article.summary ? 8 : 0) + (article.image ? 6 : 0) + article.models.length * 3;
  const published = Date.parse(article.publishedAt);
  const ageHours = Number.isFinite(published) ? (Date.now() - published) / 3_600_000 : 999;
  return weight + tier + enrichment - Math.min(40, ageHours / 12);
}

function compareIds(a: RawArticle, b: RawArticle): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Reconstruct `RawArticle`s from a stored record.
 *
 * The stored `NewsArticle` drops the sync-only fields, so they are recovered
 * from the record's bookkeeping (`signatures`) and from the registry
 * (`sourceWeight`, `aggregator`). A source that has since been removed from the
 * registry falls back to conservative values rather than dropping its articles.
 */
/**
 * The previous corpus as raw articles, ready to be merged or re-enriched.
 *
 * Exported because `runNewsSync` needs it before the merge: in the steady state
 * every feed answers 304 and this sweep therefore has NO fresh articles at all,
 * so an image pass that only looked at fresh arrivals would have nothing to do
 * forever. Image coverage is meant to accumulate across sweeps, and this is the
 * set it accumulates over.
 */
export function carriedArticles(previous: NewsSnapshotRecord | null): RawArticle[] {
  return previous ? rehydrate(previous) : [];
}

function rehydrate(record: NewsSnapshotRecord): RawArticle[] {
  const feedById = new Map(activeFeeds().map((f) => [f.id, f]));

  return record.articles.map((article) => {
    const feed = feedById.get(article.sourceId);
    return {
      id: article.id,
      urlKey: article.url.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase(),
      title: article.title,
      summary: article.summary,
      abstract: article.abstract,
      bodyText: "",
      url: article.url,
      domain: article.domain,
      host: article.host,
      sourceId: article.sourceId,
      sourceName: article.sourceName,
      tier: article.tier,
      brand: article.brand,
      author: article.author,
      publishedAt: article.publishedAt,
      firstSeenAt: article.firstSeenAt,
      topics: article.topics,
      models: article.models,
      orgs: article.orgs,
      image: article.image,
      readMinutes: article.readMinutes,
      // Recomputing this would need the feed's domain list; the stored
      // verification already encodes the answer.
      domainMatch: !article.verification.signals.includes("domain_mismatch"),
      signature: record.signatures[article.id] ?? [],
      aggregator: Boolean(feed?.aggregator),
      sourceWeight: feed?.weight ?? 0.5,
    } satisfies RawArticle;
  });
}

/** The record to publish when a sanity gate rejected the run. */
function carryForward(
  previous: NewsSnapshotRecord | null,
  now: number,
  results: Record<string, NewsSourceResult>,
  validators: Record<string, { etag?: string; lastModified?: string }>,
  warnings: string[],
  feeds: readonly FeedSource[],
): NewsSnapshotRecord {
  if (previous) {
    return {
      ...previous,
      // `syncedAt` DOES advance: the run happened, and the staleness check must
      // not schedule another one immediately. The corpus is what is preserved.
      syncedAt: new Date(now).toISOString(),
      results,
      validators,
      warnings: [...warnings, ...previous.warnings.filter((w) => !w.includes("keeping the previous"))],
    };
  }

  // No previous snapshot and nothing fetched — a cold start with no network.
  // An empty record is correct here; the store falls back to the bundled
  // baseline when it sees one.
  return {
    version: "empty",
    syncedAt: new Date(now).toISOString(),
    origin: "baseline",
    articles: [],
    clusters: [],
    stats: emptyStats(),
    sources: summarizeSources(feeds, results, []),
    imageHosts: [],
    warnings,
    enrichment: { deterministic: true, llm: false },
    results,
    validators,
    firstSeen: {},
    signatures: {},
    retired: [],
    imageMisses: {},
  };
}

function describeFailures(outcomes: readonly FeedFetchOutcome[]): string {
  const first = outcomes.find((o) => o.result.error);
  return first?.result.error ? `First error: ${first.result.error}` : "";
}

export function summarizeSources(
  feeds: readonly FeedSource[],
  results: Record<string, NewsSourceResult>,
  articles: readonly NewsArticle[],
): NewsSourceSummary[] {
  const counts = new Map<string, number>();
  for (const article of articles) {
    counts.set(article.sourceId, (counts.get(article.sourceId) ?? 0) + 1);
  }

  return feeds
    .map((feed) => ({
      id: feed.id,
      name: feed.name,
      tier: feed.tier,
      brand: feed.brand,
      homepage: feed.homepage,
      count: counts.get(feed.id) ?? 0,
      status: results[feed.id]?.status ?? "skipped",
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function emptyStats(): NewsStats {
  return {
    articles: 0,
    clusters: 0,
    sources: 0,
    sourcesOk: 0,
    verified: 0,
    firstParty: 0,
    last24h: 0,
    withImage: 0,
    byTopic: Object.fromEntries(TOPIC_IDS.map((t) => [t, 0])) as Record<NewsTopic, number>,
  };
}

export function computeStats(
  articles: readonly NewsArticle[],
  clusters: readonly NewsCluster[],
  sources: readonly NewsSourceSummary[],
  now: number,
): NewsStats {
  const byTopic = Object.fromEntries(TOPIC_IDS.map((t) => [t, 0])) as Record<NewsTopic, number>;
  let verified = 0;
  let firstParty = 0;
  let last24h = 0;
  let withImage = 0;
  const dayAgo = now - 86_400_000;

  for (const article of articles) {
    for (const topic of article.topics) byTopic[topic] += 1;
    if (article.verification.level === "verified" || article.verification.level === "corroborated") {
      verified++;
    }
    if (article.tier === "first_party") firstParty++;
    if (article.image?.url) withImage++;
    const published = Date.parse(article.publishedAt);
    if (Number.isFinite(published) && published >= dayAgo) last24h++;
  }

  return {
    articles: articles.length,
    clusters: clusters.length,
    // Only sources that actually produced something are counted as "live" — a
    // headline number that includes dead feeds is a headline number that lies.
    sources: sources.filter((s) => s.count > 0).length,
    sourcesOk: sources.filter((s) => s.status === "ok" || s.status === "not_modified").length,
    verified,
    firstParty,
    last24h,
    withImage,
    byTopic,
  };
}
