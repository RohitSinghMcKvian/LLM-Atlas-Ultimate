import { intrinsicAccess, type RoutableModel } from "./availability";
import { BENCHMARKS } from "./benchmarks";
import { PROVIDER_LIST } from "./providers";
import type { CatalogStats } from "./snapshot";
import type { CatalogModel, ModelAccess } from "./types";

// Access derivation and snapshot statistics.
//
// These live outside `index.ts` because both `baseline.ts` and the sync engine
// need them, and `index.ts` imports `baseline.ts` — putting them there would
// close a cycle. `index.ts` re-exports `modelAccess` / `isFree` so no call site
// changed.

/**
 * The model's access tier, derived from its routes.
 *
 * Deliberately ignores the legacy `m.access` field. That field was hand-audited
 * when every free model was NVIDIA-served, and it went stale the moment the sync
 * started attaching live OpenRouter routes: 38 models still claimed `"free"`
 * while their only live route was a metered OpenRouter endpoint that answers 402
 * on a zero-credit key. Deriving from `routes` leaves exactly one thing that can
 * be wrong — the route list — and the liveness probe is what keeps that honest.
 *
 * This is the *intrinsic* tier ("could this ever be free"), which is what the
 * leaderboard filter, the `?access=` API contract and `computeCatalogStats` want.
 * For "can the user in front of me run this right now", call `modelAvailability`
 * in `./availability` instead.
 */
export function modelAccess(m: RoutableModel): ModelAccess {
  return intrinsicAccess(m);
}

export function isFree(m: RoutableModel): boolean {
  return modelAccess(m) === "free";
}

/**
 * Whether a model should be offered to the user right now.
 *
 * `upcoming` models are announced but not routable. `deprecated` models have
 * been delisted upstream and are inside their removal grace period — they stay
 * visible in the leaderboard as a record, but every picker filters them out so
 * nobody can select a model that no longer exists. See
 * `lib/catalog/sync/merge.ts` for how a model enters that state.
 */
export function isSelectable(m: CatalogModel): boolean {
  return m.status !== "upcoming" && m.status !== "deprecated";
}

export function computeCatalogStats(models: CatalogModel[]): CatalogStats {
  let free = 0;
  let byok = 0;
  let upcoming = 0;
  let deprecated = 0;
  const brands = new Set<string>();

  for (const m of models) {
    brands.add(m.provider);
    if (m.status === "upcoming") upcoming++;
    else if (m.status === "deprecated") deprecated++;
    else if (modelAccess(m) === "free") free++;
    else byok++;
  }

  return {
    models: models.length,
    free,
    byok,
    brandProviders: brands.size,
    routeProviders: PROVIDER_LIST.length,
    benchmarks: BENCHMARKS.length,
    upcoming,
    deprecated,
  };
}
