import type { FeedTier } from "./feeds";

// The Atlas News data model.
//
// This module is deliberately dependency-free apart from one type import — the
// client imports it on every /news render, so it must never drag the sync
// engine, the feed registry's data, or `server-only` into the browser bundle.
// Same split as `lib/catalog/snapshot.ts` (light, shared) versus
// `lib/catalog/store.ts` (server-only).

/**
 * Topic taxonomy.
 *
 * The first seven ids are kept verbatim from the retired `lib/news/data.ts`: a
 * persisted filter set or a shared `/news?t=agents` link from the old feed must
 * keep resolving. The last four are new — a live corpus of several hundred real
 * articles has whole categories (silicon, regulation, funding rounds) that
 * twelve hand-authored demo items never needed.
 */
export type NewsTopic =
  | "models"
  | "pricing"
  | "agents"
  | "open-source"
  | "research"
  | "safety"
  | "tools"
  | "infrastructure"
  | "policy"
  | "funding"
  | "multimodal";

/**
 * What Atlas is willing to claim about an item.
 *
 * Deliberately about *evidence*, not truth. Atlas cannot know whether a story is
 * correct; it can know who published it, on whose domain, and how many
 * independent publishers said the same thing. Every level below is a statement
 * about provenance only, and the UI says exactly that.
 */
export type VerificationLevel = "verified" | "corroborated" | "reported" | "unconfirmed";

/**
 * The individual predicates behind a level. The last three are negative — their
 * presence lowers the verdict rather than raising it.
 *
 * These are surfaced one by one in the deep-dive panel, so a reader can see
 * precisely why an item carries the badge it does instead of trusting a score.
 */
export type VerificationSignal =
  | "first_party_source"
  | "publisher_domain_match"
  | "canonical_link"
  | "multi_source"
  | "multi_domain"
  | "research_preprint"
  | "author_attributed"
  | "domain_mismatch"
  | "no_canonical_link"
  | "single_low_trust";

export interface Verification {
  level: VerificationLevel;
  /**
   * 0..100. An ordering aid for the "Most verified" sort and nothing else — the
   * *level* is what the UI states. A number invites false precision about
   * something that is fundamentally a handful of booleans.
   */
  score: number;
  signals: VerificationSignal[];
  /** Distinct feed ids in this article's cluster. */
  corroboration: number;
  /**
   * Distinct registrable domains in this article's cluster. This, never
   * `corroboration`, is what gates the `corroborated` level: three feeds from
   * one publisher are one publisher.
   */
  distinctDomains: number;
  /** At least one cluster member is a first-party announcement on its own domain. */
  firstParty: boolean;
}

export interface NewsImage {
  /**
   * Upstream absolute https URL. Never rendered directly — always through
   * `/api/v1/news/image`, which pins requests to the hosts this snapshot
   * actually references. See `lib/news/image.ts`.
   */
  url: string;
  host: string;
  width?: number;
  height?: number;
  alt?: string;
  /**
   * How the image was found.
   *
   * `feed` came out of the feed's own `media:content`/`enclosure`/inline markup.
   * `opengraph` was recovered from the article page's `<head>` by
   * `lib/news/sync/og.ts`, which is where the large majority come from — RSS
   * almost never carries one.
   *
   * Optional because snapshots persisted before the OpenGraph pass existed have
   * no value here, and a stored corpus must keep deserialising across a deploy.
   */
  source?: "feed" | "opengraph";
}

export interface NewsArticle {
  /**
   * `fnv1a` of the canonical URL. Derived rather than authored so it is stable
   * across every sync — which is what lets a user's saved/read state survive the
   * corpus being rebuilt hourly.
   */
  id: string;
  title: string;
  /**
   * Deterministic extractive summary drawn from the feed's own description,
   * 1–3 sentences and hard-capped. Never verbatim beyond the cap, and always
   * rendered alongside `url` so attribution travels with it.
   */
  summary: string;
  /**
   * LLM-written abstract. Present ONLY when an operator key existed at sync
   * time, and always labelled as machine-generated in the UI. Optional by
   * design: the keyless deployment must not look degraded.
   */
  abstract?: string;
  /** Canonical absolute URL — tracking params stripped, host lowercased. */
  url: string;
  /**
   * Registrable domain of `url`, used for *corroboration counting* — two
   * articles only corroborate each other if these differ.
   *
   * Not always the right thing to show a reader: `qwenlm.github.io` and
   * `importai.substack.com` both reduce to their platform here, which is the
   * conservative choice for counting independence and a confusing one to print.
   * Use `host` for display.
   */
  domain: string;
  /**
   * The article's actual hostname, minus `www.`. This is what every card and
   * detail view prints, so a reader can always judge the source themselves
   * rather than trusting our badge.
   */
  host: string;

  sourceId: string;
  sourceName: string;
  tier: FeedTier;
  /** Brand this source speaks for, set only when the source is that brand's own channel. */
  brand?: string;
  author?: string;

  /** ISO instant. Falls back to `firstSeenAt` when the feed gave no usable date. */
  publishedAt: string;
  /** ISO instant this corpus first observed the article. Drives "new since last visit". */
  firstSeenAt: string;

  topics: NewsTopic[];
  /**
   * Catalog model ids, already run through `resolveModelId` at sync time — so
   * the dangling-chip bug that `lib/news/data.test.ts` existed to catch is now
   * structurally impossible rather than merely tested for.
   */
  models: string[];
  /** Organisation names mentioned (Anthropic, OpenAI, Google, …). */
  orgs: string[];

  image?: NewsImage;

  /**
   * The recency-INDEPENDENT half of the rank: source trust, corroboration,
   * topical relevance, enrichment completeness.
   *
   * Stored, because the snapshot's content hash must be stable across syncs. A
   * recency-derived score changes every hour, which would mint a new version —
   * and a new half-megabyte Supabase row — on every single sync even when
   * nothing upstream moved. The recency half is applied at render by
   * `liveScore()` in `lib/news/rank.ts`.
   */
  baseScore: number;

  verification: Verification;
  clusterId: string;
  /** Whether this article is its cluster's elected representative. */
  lead: boolean;
  readMinutes?: number;
}

export interface NewsCluster {
  id: string;
  leadId: string;
  /** Lead first, then descending source weight. */
  memberIds: string[];
  /** Distinct registrable domains across members. */
  domains: string[];
  topics: NewsTopic[];
  models: string[];
  /** Newest member `publishedAt` — the cluster's position on the timeline. */
  latestAt: string;
  /** Oldest member `publishedAt` — "first reported". */
  firstAt: string;
  baseScore: number;
  verification: Verification;
}

export type NewsSourceStatus = "ok" | "not_modified" | "failed" | "skipped" | "disabled";

export interface NewsSourceResult {
  status: NewsSourceStatus;
  /** Items the feed returned. */
  items: number;
  /** Items that survived the relevance gate and were new to the corpus. */
  fresh: number;
  ms?: number;
  httpStatus?: number;
  error?: string;
}

/** The per-source metadata the client needs to render the source filter. */
export interface NewsSourceSummary {
  id: string;
  name: string;
  tier: FeedTier;
  brand?: string;
  homepage: string;
  /** Articles from this source currently in the corpus. */
  count: number;
  status: NewsSourceStatus;
}

export interface NewsStats {
  articles: number;
  clusters: number;
  sources: number;
  sourcesOk: number;
  verified: number;
  firstParty: number;
  last24h: number;
  /**
   * Articles carrying a real publisher image.
   *
   * Tracked as a headline number because it is the one quality metric that
   * degrades silently: an OpenGraph pass that starts timing out does not fail
   * any sanity gate, it just quietly returns a feed of gradients. Surfacing the
   * count means the regression is visible in the UI and in the sync log rather
   * than only to whoever happens to scroll.
   */
  withImage: number;
  byTopic: Record<NewsTopic, number>;
}

/**
 * The client-visible snapshot. Everything here is paid for on every render of
 * /news, so keep it lean — server-only bookkeeping lives on the record below.
 */
export interface NewsSnapshot {
  /**
   * Content hash over `id|publishedAt|title|url` of the sorted article list.
   *
   * Deliberately EXCLUDES scores and counts. See the note on `baseScore`: hashing
   * anything recency-derived would change the version every hour forever, which
   * defeats both the ETag on `/api/v1/news` and the upsert-on-conflict that keeps
   * Supabase from storing a fresh copy of the corpus every sync.
   */
  version: string;
  syncedAt: string;
  origin: "baseline" | "synced";
  articles: NewsArticle[];
  clusters: NewsCluster[];
  stats: NewsStats;
  sources: NewsSourceSummary[];
  /**
   * Image hosts this snapshot's articles legitimately reference — the allowlist
   * `/api/v1/news/image` pins requests against. Written by the sync from images
   * that already passed their feed's domain check, so no user input reaches it.
   */
  imageHosts: string[];
  /** Non-fatal problems (a dead feed, a rejected sanity gate) — surfaced in the UI, not just logged. */
  warnings: string[];
  /** What enrichment actually ran. `llm` is false on every keyless deployment. */
  enrichment: { deterministic: true; llm: boolean };
}

/**
 * The persisted snapshot. Extends the wire shape with bookkeeping the client has
 * no use for — its effects are already baked into `firstSeenAt`, `clusterId`,
 * and `verification` by the time a snapshot is served.
 */
export interface NewsSnapshotRecord extends NewsSnapshot {
  results: Record<string, NewsSourceResult>;
  /**
   * Feed id → conditional-request validators. An hourly sweep over ~37 feeds is
   * mostly 304s because of this, which is the difference between a few kilobytes
   * and a few megabytes of upstream traffic every hour.
   */
  validators: Record<string, { etag?: string; lastModified?: string }>;
  /** Article id → ISO first observed. Outlives retention pruning of the article itself. */
  firstSeen: Record<string, string>;
  /** Article id → shingle sketch, so clustering is incremental across syncs. */
  signatures: Record<string, string[]>;
  /** Ids retention dropped, so a re-crawled item is not announced as "new" a second time. */
  retired: string[];
  /**
   * Article id → how many times the OpenGraph pass has tried and failed to find
   * it a picture.
   *
   * Without this the pass has no memory, and a bounded sweep over a corpus
   * ordered by source weight picks the *same* candidates every hour: the ones
   * whose pages genuinely have no usable `og:image`. Coverage then plateaus
   * permanently a little above where the cold start left it, having spent a
   * bounded budget re-proving the same failures forever.
   *
   * Two strikes and an article is left alone. Pruned to live ids on every merge,
   * so it cannot outgrow the corpus.
   */
  imageMisses?: Record<string, number>;
  /**
   * Source id → how the OpenGraph pass has historically fared on that source.
   *
   * `imageMisses` above gives the pass a memory of individual articles, which is
   * enough to stop it re-proving the same failure forever. It is NOT enough to
   * stop it re-proving the same *source*: arXiv publishes roughly 120 new
   * preprints a day, every one of them arrives with `misses: 0`, and its
   * research-tier weight of 0.85 sorts all of them ahead of every press story.
   * Their `og:image` is the arXiv logo — the quality gate rejects it, correctly
   * — so a bounded pass spent its entire budget on candidates that cannot
   * resolve, and the press sources that do carry artwork were never reached at
   * all. Measured on a live corpus: TechCrunch, whose every article has a good
   * `og:image`, sat at 0 of 8.
   *
   * So the pass carries a per-source hit rate and spends the budget where images
   * have actually been found. Deliberately learned rather than declared: a
   * hand-maintained "this source has no pictures" list is wrong the day a
   * publisher adds them, and nobody goes back to check.
   *
   * Deprioritised, never excluded — a barren source is still tried with whatever
   * budget is left over, which is what lets it climb back out on its own.
   */
  imageYield?: Record<string, SourceImageYield>;
}

/** Cumulative OpenGraph outcomes for one source. See `imageYield`. */
export interface SourceImageYield {
  /** Article pages fetched for this source. */
  tried: number;
  /** Of those, how many produced an image that passed the quality gate. */
  resolved: number;
}

/** Sort modes offered in the filter bar. */
export type NewsSort = "top" | "latest" | "verified" | "corroborated";

/** Feed layout modes. */
export type NewsView = "magazine" | "grid" | "compact" | "timeline";

/** The complete filter state, mirrored into the URL so a view is shareable. */
export interface NewsFilterState {
  topics: NewsTopic[];
  query: string;
  sources: string[];
  verifiedOnly: boolean;
  savedOnly: boolean;
  /**
   * Hide stories that have no real publisher image.
   *
   * On by default, and the default is the point: with the OpenGraph pass in
   * place the large majority of the corpus carries a genuine photograph, and a
   * grid where every fourth tile is a generated gradient reads as a broken page
   * rather than as a considered one. Treated as a display preference rather than
   * a content filter — `hasActiveFilters` ignores it and "clear filters"
   * preserves it, the same way `sort` and `view` are preserved.
   *
   * `selectArticles` relaxes it automatically rather than ever showing an empty
   * feed; see `imageGateRelaxed`.
   */
  imagesOnly: boolean;
  sort: NewsSort;
  view: NewsView;
  /** Article id whose deep dive is open, if any. */
  articleId?: string;
}
