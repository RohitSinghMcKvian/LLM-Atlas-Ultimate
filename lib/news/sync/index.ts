import { getCatalogSnapshot } from "@/lib/catalog/store";
import type { CatalogSnapshot } from "@/lib/catalog/snapshot";
import { activeFeeds, type FeedSource } from "../feeds";
import type { NewsSnapshotRecord, SourceImageYield } from "../types";
import { fetchFeed } from "./adapters/rss";
import { carriedArticles, mergeNews, type MergeResult } from "./merge";
import type { FeedFetchOutcome, RawArticle } from "./types";

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

  const startedAt = Date.now();

  const outcomes = await runPool(feeds, concurrency, (feed) =>
    fetchFeed(feed, { catalog, now, signal: fetchSignal, ...validatorsFor(previous, feed) }),
  );

  // The carried corpus is rehydrated HERE rather than inside `mergeNews`, because
  // the image pass below needs to see it. In the steady state every feed answers
  // 304 and `outcomes` carries no articles at all, so a pass that only looked at
  // fresh arrivals would find nothing to do on every sweep after the first — and
  // coverage would freeze at whatever the cold start happened to manage.
  const carried = carriedArticles(previous);

  const images = await recoverImages([...outcomes.flatMap((o) => o.articles), ...carried], {
    signal,
    elapsedMs: Date.now() - startedAt,
    misses: previous?.imageMisses,
    sourceYield: previous?.imageYield,
  });

  const llmEnriched = await maybeEnrich(outcomes, { now });

  return mergeNews({
    outcomes,
    previous,
    carried,
    now,
    llmEnriched,
    feeds,
    imageMissed: images.missed,
    imageOutcomes: images.sourceOutcomes,
  });
}

/**
 * The OpenGraph image pass.
 *
 * Runs over the WHOLE corpus — this sweep's arrivals first, then everything
 * carried forward that still has no picture — and enriches a bounded number of
 * them. `mergeNews` preserves an image once found, so coverage climbs sweep by
 * sweep towards the whole corpus instead of being capped at what any single run
 * could reach.
 *
 * Doing it per-sweep-only was the obvious design and it was wrong in a way that
 * a single run cannot show: conditional requests mean the steady state is all
 * 304s, so after the first sweep there are no fresh articles, and coverage
 * froze exactly where the cold start left it.
 *
 * Deliberately positioned *after* the feed sweep rather than inside it. The feed
 * sweep has its own budget and a hard serverless ceiling above it; letting an
 * unbounded set of publisher page loads share that budget would mean a slow news
 * hour costs us feed coverage, which is the thing that actually matters. This
 * pass takes only what the sweep left and is allowed to give up with work
 * outstanding — whatever it did not reach gets another chance next hour.
 *
 * Failure here is never fatal and never even a warning: an image is the one part
 * of an article Atlas can do without.
 */
async function recoverImages(
  articles: readonly RawArticle[],
  context: {
    signal?: AbortSignal;
    elapsedMs: number;
    misses?: Readonly<Record<string, number>>;
    sourceYield?: Readonly<Record<string, SourceImageYield>>;
  },
): Promise<{ missed: string[]; sourceOutcomes: Record<string, SourceImageYield> }> {
  const nothing = { missed: [], sourceOutcomes: {} };
  if (process.env.ATLAS_NEWS_OG_IMAGES === "false") return nothing;

  const budgetMs = imageBudgetMs(context.elapsedMs);
  // Below a few seconds there is no point starting: one page load plus its HEAD
  // probe is most of that, and a pass that aborts mid-flight has spent the
  // requests without keeping the answers.
  if (budgetMs < 4_000) return nothing;

  try {
    const { discoverImages } = await import("./og");
    const result = await discoverImages(articles, {
      signal: context.signal,
      budgetMs,
      misses: context.misses,
      sourceYield: context.sourceYield,
    });
    return { missed: result.missed, sourceOutcomes: result.sourceOutcomes };
  } catch {
    // A network failure, an expired budget, a malformed page. The corpus is
    // already complete without this.
    return nothing;
  }
}

/**
 * What is left of the invocation, minus a reserve for finishing the job.
 *
 * A fixed budget here was simply wrong arithmetic, and the sums did not close:
 * the feed sweep is allowed 45 seconds and the platform kills the invocation at
 * 60, so a fixed 20-second image pass could only ever run if the feeds finished
 * early — and on the run where they did not, it would take the whole sync down
 * with it, persisting nothing at all.
 *
 * So the pass takes what is actually left. In the steady state most feeds answer
 * 304 in a couple of seconds and the images get nearly the whole window; on a
 * slow sweep they get very little, which is the correct trade — a story with no
 * picture is worth vastly more than a picture with no story, and the next sweep
 * picks up what this one could not reach.
 */
function imageBudgetMs(elapsedMs: number): number {
  // Matches `maxDuration` on the routes that call this. Configurable because a
  // self-hosted deployment on a long-lived server has no such ceiling.
  const ceiling = envInt("ATLAS_NEWS_SYNC_CEILING_MS", 60_000);
  // Clustering, verification, ranking and the Supabase write all happen after
  // this pass and are not free at several hundred articles.
  const reserve = envInt("ATLAS_NEWS_SYNC_RESERVE_MS", 8_000);
  const configured = envInt("ATLAS_NEWS_OG_BUDGET_MS", 20_000);

  return Math.min(configured, ceiling - reserve - elapsedMs);
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
