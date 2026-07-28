import type { FeedSource } from "../feeds";
import type { NewsImage, NewsSourceResult, NewsTopic } from "../types";

// Intermediate shapes used inside one sync run.
//
// A `RawArticle` is what a feed item becomes after normalization and
// deterministic enrichment, but before clustering, verification and ranking have
// run — those three need the whole set at once, so they cannot be folded into
// the per-item pass. Splitting the type this way keeps every stage a pure
// function of the stage before it, which is what makes the pipeline testable
// without a network, a database, or a mock.

export interface RawArticle {
  id: string;
  /** Aggressively normalized URL used for identity and exact-duplicate detection. */
  urlKey: string;
  title: string;
  summary: string;
  /**
   * Written by the optional LLM pass only, and the only field it may write.
   * Absent on every keyless deployment.
   */
  abstract?: string;
  /** Full flattened body text when the feed shipped one. Used for entity linking only. */
  bodyText: string;
  url: string;
  domain: string;
  /** Display hostname, minus `www.`. See the note on `NewsArticle.host`. */
  host: string;
  sourceId: string;
  sourceName: string;
  tier: FeedSource["tier"];
  brand?: string;
  author?: string;
  publishedAt: string;
  firstSeenAt: string;
  topics: NewsTopic[];
  models: string[];
  orgs: string[];
  image?: NewsImage;
  readMinutes?: number;
  /**
   * True when the article's canonical link is on a domain the feed declared.
   * Computed during normalization because it needs the `FeedSource`, and
   * consumed by `verify.ts`, which does not.
   */
  domainMatch: boolean;
  /** Shingle sketch for clustering. Persisted so later syncs cluster incrementally. */
  signature: string[];
  /** Aggregator items can corroborate a cluster but may never lead one. */
  aggregator: boolean;
  /** Source trust, carried through so ranking does not need the registry. */
  sourceWeight: number;
}

export interface FeedFetchOutcome {
  feed: FeedSource;
  result: NewsSourceResult;
  articles: RawArticle[];
  /** Validators to persist for the next sync's conditional request. */
  etag?: string;
  lastModified?: string;
}

export type { NewsSourceResult };
