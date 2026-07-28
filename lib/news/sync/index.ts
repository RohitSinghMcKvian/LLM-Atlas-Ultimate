import { getCatalogSnapshot } from "@/lib/catalog/store";
import type { CatalogSnapshot } from "@/lib/catalog/snapshot";
import { activeFeeds, type FeedSource } from "../feeds";
import type { NewsSnapshotRecord } from "../types";
import { fetchFeed } from "./adapters/rss";
import { mergeNews, type MergeResult } from "./merge";
import type { FeedFetchOutcome } from "./types";

// Orchestration for one sync run.
//
// Everything expensive is lazily imported by `lib/news/store.ts`, so a page that
// merely reads the corpus never pulls the feed registry, the parser, or the
// adapters into its module graph — the same split `lib/catalog/store.ts` uses
// for `runSync`.

export interface RunNewsSyncOptions {
  previous?: NewsSnapshotRecord | null;
  now?: number;
  /** Overrides the registry. Used by tests and by the optional keyed adapters. */
  feeds?: readonly FeedSource[];
  catalog?: CatalogSnapshot;
  /** Wall-clock ceiling for the whole fetch stage. */
  budgetMs?: number;
  concurrency?: number;
  signal?: AbortSignal;
}

export type RunNewsSyncResult = MergeResult;

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * Run every feed through a bounded worker pool.
 *
 * Bounded rather than `Promise.all` over 37 feeds: opening that many sockets at
 * once gets a serverless instance rate-limited by its own platform before the
 * publishers ever complain, and the tail latency is worse than the throughput
 * gain. Eight at a time keeps the whole sweep inside a few seconds in the steady
 * state, where most feeds answer 304.
 *
 * Feeds are consumed in registry order, which `activeFeeds()` sorts first-party
 * first — so if the budget expires, what landed is the announcements rather than
 * the commentary about them.
 */
async function runPool(
  feeds: readonly FeedSource[],
  concurrency: number,
  worker: (feed: FeedSource) => Promise<FeedFetchOutcome>,
): Promise<FeedFetchOutcome[]> {
  const outcomes: FeedFetchOutcome[] = new Array(feeds.length);
  let cursor = 0;

  async function drain(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= feeds.length) return;
      // `worker` is contracted never to throw; this is belt-and-braces so one
      // unexpected error cannot abandon a pool lane and stall the run.
      outcomes[index] = await worker(feeds[index]).catch((err) => ({
        feed: feeds[index],
        result: {
          status: "failed" as const,
          items: 0,
          fresh: 0,
          error: err instanceof Error ? err.message.slice(0, 200) : "worker failed",
        },
        articles: [],
      }));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, feeds.length) }, drain));
  return outcomes.filter(Boolean);
}

export async function runNewsSync(options: RunNewsSyncOptions = {}): Promise<RunNewsSyncResult> {
  const {
    previous = null,
    now = Date.now(),
    feeds = activeFeeds(),
    budgetMs = envInt("ATLAS_NEWS_FETCH_BUDGET_MS", 45_000),
    concurrency = envInt("ATLAS_NEWS_FEED_CONCURRENCY", 8),
    signal,
  } = options;

  // The catalog is needed for entity linking. Reading it here rather than per
  // feed means one snapshot is used for the whole run, so two articles fetched
  // seconds apart can never link against different catalogs.
  const catalog = options.catalog ?? (await getCatalogSnapshot());

  // A global deadline on top of the per-feed timeout. Without it, 37 feeds each
  // taking their full 8s inside a pool of 8 is ~37s of wall clock — close enough
  // to the platform's 60s ceiling that a couple of slow retries would blow it,
  // and a killed invocation persists nothing at all.
  const deadline = AbortSignal.timeout(budgetMs);
  const fetchSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;

  const outcomes = await runPool(feeds, concurrency, (feed) =>
    fetchFeed(feed, { catalog, now, signal: fetchSignal, ...validatorsFor(previous, feed) }),
  );

  const llmEnriched = await maybeEnrich(outcomes, { now });

  return mergeNews({ outcomes, previous, now, llmEnriched, feeds });
}

function validatorsFor(
  previous: NewsSnapshotRecord | null,
  feed: FeedSource,
): { etag?: string; lastModified?: string } {
  return previous?.validators?.[feed.id] ?? {};
}

/**
 * The optional LLM enrichment pass.
 *
 * Imported lazily and only when explicitly enabled, so the keyless deployment
 * never loads it and never pays for it. Any failure is swallowed: the
 * deterministic summaries are already in place and are the product's floor, not
 * a fallback.
 */
async function maybeEnrich(
  outcomes: readonly FeedFetchOutcome[],
  context: { now: number },
): Promise<boolean> {
  if (process.env.ATLAS_NEWS_LLM !== "true") return false;

  try {
    const { enrichWithLlm } = await import("./llm");
    return await enrichWithLlm(outcomes, context);
  } catch {
    // A missing module, a missing key, a timeout, a malformed response — all the
    // same from here. The corpus is already complete.
    return false;
  }
}

export { mergeNews };
export type { FeedFetchOutcome };
