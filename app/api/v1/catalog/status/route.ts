import { getCatalogSnapshot, loadSnapshotRecord } from "@/lib/catalog/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What the catalog sync has been doing, for anyone.
//
// Separate from `/api/v1/catalog` because the questions are different sizes:
// that route serves ~400 models to something that needs to render them, this one
// answers "is this fresh, where did it come from, and what changed" in a couple
// of kilobytes. The sync-status pill and the Catalog updates drawer poll this,
// and neither of them wants the models.
//
// Public and read-only, like `/api/v1/providers`. Everything here is already
// derivable from the snapshot every catalog page ships to the browser — per
// provider it reports only `status`, `count` and latency, never a key, an error
// body, or a base URL.

/** Fall back to the documented default when the operator has not set one. */
function syncIntervalHours(): number {
  const raw = Number(process.env.ATLAS_CATALOG_SYNC_INTERVAL_HOURS ?? 24);
  return Number.isFinite(raw) && raw > 0 ? raw : 24;
}

export async function GET() {
  const snapshot = await getCatalogSnapshot();

  // The record carries per-provider results, which the wire snapshot
  // deliberately drops. Absent (no Supabase, cold instance) is fine — the page
  // just shows fewer details rather than failing.
  const record = await loadSnapshotRecord().catch(() => null);

  const syncedAtMs = Date.parse(snapshot.syncedAt);
  const intervalMs = syncIntervalHours() * 3_600_000;

  return Response.json(
    {
      version: snapshot.version,
      syncedAt: snapshot.syncedAt,
      // "baseline" means no provider list has ever been fetched here — the app
      // is serving the catalog bundled at build time. Saying so is the whole
      // point: a green tick over stale data is worse than no tick.
      origin: snapshot.origin,
      nextDueAt: Number.isFinite(syncedAtMs)
        ? new Date(syncedAtMs + intervalMs).toISOString()
        : null,
      intervalHours: syncIntervalHours(),
      stats: snapshot.stats,
      warnings: snapshot.warnings,
      /** What changed in the sync that produced this snapshot. */
      diff: snapshot.diff,
      /** Per provider: did its model list come back, how many, how fast. */
      sources: Object.fromEntries(
        Object.entries(record?.sources ?? {}).map(([id, result]) => [
          id,
          { status: result?.status ?? "skipped", count: result?.count ?? 0, ms: result?.ms },
        ]),
      ),
      /** Models confirmed gone and removed from the catalog. */
      retired: (record?.tombstones ?? []).slice(-25).map((t) => ({
        id: t.id,
        name: t.name,
        reason: t.reason,
        replacedBy: t.replacedBy,
        lastSeenAt: t.lastSeenAt,
      })),
    },
    {
      headers: {
        ETag: `"${snapshot.version}-status"`,
        "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=86400",
      },
    },
  );
}
