import "server-only";
import { after } from "next/server";
import { revalidateTag, unstable_cache } from "next/cache";
import { getSupabaseServer, isSupabaseServerConfigured } from "@/lib/supabase/server";
import { BASELINE_NEWS_SNAPSHOT } from "./baseline";
import { isStale, toWireNews } from "./snapshot";
import type { NewsSnapshot, NewsSnapshotRecord } from "./types";

// Server-side corpus storage and the read path every news surface uses.
//
// A near line-for-line mirror of `lib/catalog/store.ts`, deliberately: that file
// already solves this exact problem (a scheduled multi-provider sync behind three
// optional persistence tiers), it has been in production, and a second, subtly
// different implementation of the same thing is how the two drift apart.
//
// Three layers, each allowed to be absent: the Next data cache (shared across
// instances), Supabase (durable, shared, optional), and an in-process tier held
// on `globalThis`. When all three are empty the bundled baseline is served — see
// `baseline.ts` for why that baseline is empty rather than seeded.

export const NEWS_CACHE_TAG = "news";

/** Snapshots retained in Supabase. Fewer than the catalog keeps: a bad news sync is self-correcting within the hour. */
const KEEP_SNAPSHOTS = 5;

// Freshness arithmetic and the wire projection live in `./snapshot`, which is
// import-safe outside a Next runtime — this module is not.
export { isStale, minRefreshMinutes, refreshCooldownMs, syncIntervalMinutes, toWireNews } from "./snapshot";

// The in-process tier.
//
// Held on `globalThis` rather than in module scope: Next compiles route handlers
// and server components into separate module graphs, so a plain module variable
// gives each route its own copy — one route would serve the synced corpus while
// the next served the empty baseline. This also survives dev hot-reload.
const MEMORY_KEY = Symbol.for("atlas.news.snapshotRecord");

type MemoryHost = typeof globalThis & { [MEMORY_KEY]?: NewsSnapshotRecord | null };

function readMemory(): NewsSnapshotRecord | null {
  return (globalThis as MemoryHost)[MEMORY_KEY] ?? null;
}

function writeMemory(record: NewsSnapshotRecord | null): void {
  (globalThis as MemoryHost)[MEMORY_KEY] = record;
}

function isUsableRecord(record: unknown): record is NewsSnapshotRecord {
  const r = record as NewsSnapshotRecord | null;
  // A truncated or hand-edited row must not take the page down.
  return Boolean(r && Array.isArray(r.articles) && Array.isArray(r.clusters) && r.version);
}

/** The newest known record: Supabase when configured, else this process's own. */
export async function loadNewsRecord(): Promise<NewsSnapshotRecord | null> {
  const supabase = getSupabaseServer();
  if (!supabase) return readMemory();

  const { data, error } = await supabase
    .from("news_snapshots")
    .select("payload")
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !isUsableRecord(data?.payload)) return readMemory();

  const record = data.payload as NewsSnapshotRecord;
  // Keep the local tier warm too, so a later database blip degrades to the last
  // known corpus rather than all the way to an empty page.
  const local = readMemory();
  if (!local || record.syncedAt >= local.syncedAt) writeMemory(record);
  return record;
}

export async function saveNewsRecord(record: NewsSnapshotRecord): Promise<void> {
  writeMemory(record);

  const supabase = getSupabaseServer();
  if (!supabase) return;

  // `version` is a content hash with a unique constraint, so an hour in which
  // nothing was published upserts onto the existing row instead of storing
  // another half-megabyte of jsonb. This only works because the hash excludes
  // scores and timestamps — see `hashArticles` in `sync/merge.ts`.
  await supabase.from("news_snapshots").upsert(
    {
      version: record.version,
      synced_at: record.syncedAt,
      origin: record.origin,
      article_count: record.articles.length,
      payload: record,
    },
    { onConflict: "version" },
  );

  const { data: keep } = await supabase
    .from("news_snapshots")
    .select("id")
    .order("synced_at", { ascending: false })
    .limit(KEEP_SNAPSHOTS);

  if (keep && keep.length === KEEP_SNAPSHOTS) {
    await supabase
      .from("news_snapshots")
      .delete()
      .not("id", "in", `(${keep.map((r) => r.id).join(",")})`);
  }
}

export interface NewsSyncRunLog {
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  sourceResults: unknown;
  warnings: string[];
  articleCount: number;
  clusterCount: number;
}

export async function recordNewsSyncRun(log: NewsSyncRunLog): Promise<void> {
  const supabase = getSupabaseServer();
  if (!supabase) return;
  await supabase.from("news_sync_runs").insert({
    started_at: log.startedAt,
    finished_at: log.finishedAt,
    ok: log.ok,
    source_results: log.sourceResults,
    warnings: log.warnings,
    article_count: log.articleCount,
    cluster_count: log.clusterCount,
  });
}

// Shared across every server instance, so the steady state is a data-cache hit
// rather than a database round trip. `performNewsSync` busts it with
// `revalidateTag`.
const cachedRecord = unstable_cache(async () => loadNewsRecord(), ["news:snapshot"], {
  revalidate: 3_600,
  tags: [NEWS_CACHE_TAG],
});

/**
 * The corpus for this request.
 *
 * Serves stale data happily: when the corpus is older than the sync interval a
 * refresh is scheduled with `after()` and the current corpus is returned
 * immediately. This is what makes "syncs every hour" true on a deployment with
 * no scheduler configured at all — the first request after the interval triggers
 * the sweep, and nobody waits for it.
 */
export async function getNewsSnapshot(): Promise<NewsSnapshot> {
  let record: NewsSnapshotRecord | null = readMemory();

  if (isSupabaseServerConfigured()) {
    try {
      record = (await cachedRecord()) ?? readMemory();
    } catch {
      // A database blip degrades to this process's last known corpus, and only
      // then to the baseline — never a 500 on the news page.
      record = readMemory();
    }
  }

  // Deliberately NOT truncated here: `/api/v1/news` pages over this and would
  // have no tail to serve. The page-level cap lives in the news route segment.
  const snapshot: NewsSnapshot = record ? toWireNews(record) : BASELINE_NEWS_SNAPSHOT;

  if (isStale(snapshot)) scheduleBackgroundSync(record);

  return snapshot;
}

/** Guards against a burst of concurrent requests each starting their own sweep. */
let inflightSync: Promise<NewsSnapshotRecord> | null = null;

/** The in-flight sweep, if one is running. The refresh route awaits this to collapse a herd. */
export function inflightNewsSync(): Promise<NewsSnapshotRecord> | null {
  return inflightSync;
}

function syncDisabled(): boolean {
  return process.env.ATLAS_NEWS_SYNC_DISABLED === "true";
}

function scheduleBackgroundSync(previous: NewsSnapshotRecord | null): void {
  if (inflightSync) return;
  if (syncDisabled()) return;
  // Never during `next build`. A prerender that calls `revalidateTag` is treated
  // as dynamic server usage, which silently demotes otherwise-static pages to
  // on-demand rendering. Build output ships the baseline; the first real request
  // schedules the sync.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  try {
    after(async () => {
      if (inflightSync) return;
      await performNewsSync(previous).catch(() => {
        // Already logged into the record's warnings by `mergeNews`; a background
        // task must never reject.
      });
    });
  } catch {
    // `after()` throws outside a request scope (e.g. during a static build).
    // A build-time page simply renders the baseline; the first real request
    // schedules the sync.
  }
}

/**
 * Run a sync, persist it, and bust the cache.
 *
 * Concurrent callers share one sweep — the promise is published before any
 * upstream work begins, so the refresh route and a stale-read scheduled by
 * `after()` collapse into a single set of requests to 37 publishers.
 */
export async function performNewsSync(
  previous?: NewsSnapshotRecord | null,
): Promise<NewsSnapshotRecord> {
  const existing = inflightSync;
  if (existing) return existing;

  const run = (async () => {
    const startedAt = new Date().toISOString();
    // Imported lazily so the feed registry, the parser and the adapters stay out
    // of the module graph of every page that merely reads the corpus.
    const { runNewsSync } = await import("./sync");

    const before = previous ?? (await loadNewsRecord());
    const { record, ok } = await runNewsSync({ previous: before });

    await saveNewsRecord(record);
    await recordNewsSyncRun({
      startedAt,
      finishedAt: new Date().toISOString(),
      ok,
      sourceResults: record.results,
      warnings: record.warnings,
      articleCount: record.articles.length,
      clusterCount: record.clusters.length,
    });

    // Non-fatal: outside a request scope (a prerender, a script) this throws,
    // and the sync itself has already succeeded and been persisted.
    try {
      revalidateTag(NEWS_CACHE_TAG);
    } catch {
      /* no cache to bust here */
    }

    return record;
  })();

  inflightSync = run.finally(() => {
    inflightSync = null;
  });

  return inflightSync;
}
