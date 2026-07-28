import { MODELS } from "./models";
import type { CatalogSnapshot } from "./snapshot";
import { computeCatalogStats } from "./stats";

// The bundled baseline snapshot.
//
// `models.ts` is now two things at once:
//
//   1. The **curation overlay** — the hand-audited blurbs, benchmark scores,
//      `trending` flags, families, tags, ratings, and measured latency/throughput
//      that no provider API exposes. `lib/catalog/sync/merge.ts` layers these on
//      top of the synced data, and the curated `id` always wins so existing URLs
//      and persisted store values keep resolving.
//
//   2. The **baseline** shipped in the bundle, so the app works with zero
//      configuration, offline, and on the very first request to a cold server
//      that has no persisted snapshot yet. When nothing has been installed, every
//      selector falls back to this and behaves exactly as it did before the
//      catalog became dynamic.
//
// This module pulls in all of `models.ts` (~91 KB), so it must never be imported
// by anything the always-mounted workspace shell can reach. `snapshot.ts` is the
// light module for that job.

/** The date `models.ts` was last hand-refreshed — see its file header. */
const BASELINE_SYNCED_AT = "2026-06-30T00:00:00.000Z";

export const BASELINE_SNAPSHOT: CatalogSnapshot = {
  version: `baseline-${MODELS.length}`,
  syncedAt: BASELINE_SYNCED_AT,
  origin: "baseline",
  models: MODELS,
  stats: computeCatalogStats(MODELS),
  aliases: {},
  diff: [],
  warnings: [],
};
