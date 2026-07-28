import "server-only";
import { after } from "next/server";
import { revalidateTag, unstable_cache } from "next/cache";
import { getSupabaseServer, isSupabaseServerConfigured } from "@/lib/supabase/server";
import { BASELINE_SNAPSHOT } from "./baseline";
import {
  installSnapshot,
  toWireSnapshot,
  type CatalogSnapshot,
  type CatalogSnapshotRecord,
} from "./snapshot";

// Server-side snapshot storage and the read path every server surface uses.
//
// Three layers, in order: the Next data cache (shared across instances, 24h),
// Supabase (durable, shared, optional), and the bundled baseline (always
// present). Every layer is allowed to be absent — the app is designed to run
// with no database and no provider keys at all.

export const CATALOG_CACHE_TAG = "catalog";

/** Snapshots retained in Supabase. Enough to diagnose a bad sync, not a log. */
const KEEP_SNAPSHOTS = 10;

function syncIntervalHours(): number {
  const raw = Number(process.env.ATLAS_CATALOG_SYNC_INTERVAL_HOURS ?? 24);
  return Number.isFinite(raw) && raw > 0 ? raw : 24;
}

function isStale(snapshot: CatalogSnapshot, now = Date.now()): boolean {
  const age = now - Date.parse(snapshot.syncedAt);
  return !Number.isFinite(age) || age > syncIntervalHours() * 3_600_000;
}

// The in-process tier.
//
// Supabase is optional, and most self-hosted deployments will not have it.
// Without a tier here the sync would run, produce a catalog, and throw it away —
// every request would serve the bundled baseline forever. This keeps a synced
// catalog alive for the life of the process, which is the whole story for a
// single-instance deploy and a useful warm cache everywhere else.
//
// It is deliberately *not* a substitute for Supabase: serverless instances each
// hold their own copy and lose it on recycle, so a multi-instance deployment
// still wants the database. `.env.example` says so.
// Held on `globalThis` rather than in module scope: Next compiles route handlers
// and server components into separate module graphs, so a plain module variable
// gives each route its own copy — one route would serve the synced catalog while
// the next served the bundled one. This also survives dev hot-reload.
const MEMORY_KEY = Symbol.for("atlas.catalog.snapshotRecord");

type MemoryHost = typeof globalThis & {
  [MEMORY_KEY]?: CatalogSnapshotRecord | null;
};

function readMemory(): CatalogSnapshotRecord | null {
  return (globalThis as MemoryHost)[MEMORY_KEY] ?? null;
}

function writeMemory(record: CatalogSnapshotRecord | null): void {
  (globalThis as MemoryHost)[MEMORY_KEY] = record;
}

function isUsableRecord(record: unknown): record is CatalogSnapshotRecord {
  const r = record as CatalogSnapshotRecord | null;
  // A truncated or hand-edited row must not take the catalog down.
  return Boolean(r && Array.isArray(r.models) && r.models.length > 0 && r.version);
}

/** The newest known record: Supabase when configured, else this process's own. */
export async function loadSnapshotRecord(): Promise<CatalogSnapshotRecord | null> {
  const supabase = getSupabaseServer();
  if (!supabase) return readMemory();

  const { data, error } = await supabase
    .from("catalog_snapshots")
    .select("payload")
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !isUsableRecord(data?.payload)) return readMemory();

  const record = data.payload as CatalogSnapshotRecord;
  // Keep the local tier warm too, so a later database blip degrades to the last
  // known catalog rather than all the way to the bundled one.
  const local = readMemory();
  if (!local || record.syncedAt >= local.syncedAt) writeMemory(record);
  return record;
}

export async function saveSnapshotRecord(record: CatalogSnapshotRecord): Promise<void> {
  writeMemory(record);

  const supabase = getSupabaseServer();
  if (!supabase) return;

  // `version` is a content hash with a unique constraint, so an unchanged sync
  // upserts onto the existing row instead of storing another ~400 KB of jsonb.
  await supabase.from("catalog_snapshots").upsert(
    {
      version: record.version,
      synced_at: record.syncedAt,
      origin: record.origin,
      model_count: record.models.length,
      payload: record,
    },
    { onConflict: "version" },
  );

  const { data: keep } = await supabase
    .from("catalog_snapshots")
    .select("id")
    .order("synced_at", { ascending: false })
    .limit(KEEP_SNAPSHOTS);

  if (keep && keep.length === KEEP_SNAPSHOTS) {
    await supabase
      .from("catalog_snapshots")
      .delete()
      .not("id", "in", `(${keep.map((r) => r.id).join(",")})`);
  }
}

export interface SyncRunLog {
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  providerResults: unknown;
  warnings: string[];
  modelCount: number;
  diffCount: number;
}

export async function recordSyncRun(log: SyncRunLog): Promise<void> {
  const supabase = getSupabaseServer();
  if (!supabase) return;
  await supabase.from("catalog_sync_runs").insert({
    started_at: log.startedAt,
    finished_at: log.finishedAt,
    ok: log.ok,
    provider_results: log.providerResults,
    warnings: log.warnings,
    model_count: log.modelCount,
    diff_count: log.diffCount,
  });
}

// Shared across every server instance and cached for a full interval, so the
// steady state is a data-cache hit rather than a database round trip. The sync
// route busts it with `revalidateTag`.
const cachedRecord = unstable_cache(
  async () => loadSnapshotRecord(),
  ["catalog:snapshot"],
  { revalidate: 86_400, tags: [CATALOG_CACHE_TAG] },
);

/**
 * The snapshot for this request, installed into the module pointer so the
 * server-only router and every server component read the same catalog.
 *
 * Serves stale data happily: when the snapshot is older than the sync interval a
 * refresh is scheduled with `after()` and the current snapshot is returned
 * immediately. This is what makes "synced every 24h" true on a deployment with no
 * scheduler at all — the first request after the interval triggers the refresh,
 * and nobody waits for it.
 */
export async function getCatalogSnapshot(): Promise<CatalogSnapshot> {
  let record: CatalogSnapshotRecord | null = readMemory();

  if (isSupabaseServerConfigured()) {
    try {
      record = (await cachedRecord()) ?? readMemory();
    } catch {
      // A database blip degrades to this process's last known catalog, and only
      // then to the bundled one — never a 500 on every page that reads models.
      record = readMemory();
    }
  }

  const snapshot: CatalogSnapshot = record ? toWireSnapshot(record) : BASELINE_SNAPSHOT;
  installSnapshot(snapshot);

  if (isStale(snapshot)) scheduleBackgroundSync(record);

  return snapshot;
}

/** Guards against a burst of concurrent requests each starting their own sync. */
let inflightSync: Promise<unknown> | null = null;

function scheduleBackgroundSync(previous: CatalogSnapshotRecord | null): void {
  if (inflightSync) return;
  if (process.env.ATLAS_CATALOG_SYNC_DISABLED === "true") return;
  // Never during `next build`. A prerender that calls `revalidateTag` is treated
  // as dynamic server usage, which silently demotes otherwise-static pages to
  // on-demand rendering — a page like /flow that has no per-request state should
  // stay prerendered. Build output ships the bundled catalog; the first real
  // request schedules the sync.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  try {
    after(async () => {
      if (inflightSync) return;
      inflightSync = performSync(previous).finally(() => {
        inflightSync = null;
      });
      await inflightSync;
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
 * Deliberately does not install the result: the pointer may only move from a
 * render body or a post-hydration effect (see `lib/catalog/snapshot.ts`), and
 * this can run concurrently with an in-flight render.
 */
export async function performSync(
  previous?: CatalogSnapshotRecord | null,
): Promise<CatalogSnapshotRecord> {
  const startedAt = new Date().toISOString();
  // Imported lazily so the sync engine and its provider adapters stay out of the
  // module graph of every page that merely reads the catalog.
  const { runSync } = await import("./sync");

  const before = previous ?? (await loadSnapshotRecord());
  const { record, ok } = await runSync({ previous: before });

  await saveSnapshotRecord(record);
  await recordSyncRun({
    startedAt,
    finishedAt: new Date().toISOString(),
    ok,
    providerResults: record.sources,
    warnings: record.warnings,
    modelCount: record.models.length,
    diffCount: record.diff.length,
  });

  // Non-fatal: outside a request scope (a prerender, a script) this throws, and
  // the sync itself has already succeeded and been persisted.
  try {
    revalidateTag(CATALOG_CACHE_TAG);
  } catch {
    /* no cache to bust here */
  }

  return record;
}
