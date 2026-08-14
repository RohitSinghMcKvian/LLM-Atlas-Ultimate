import { BASELINE_SNAPSHOT } from "./baseline";
import { BENCHMARKS, BENCHMARK_MAP, benchmarkLabel } from "./benchmarks";
import { PROVIDERS, PROVIDER_LIST } from "./providers";
import {
  EMPTY_SNAPSHOT,
  activeSnapshot,
  type CatalogSnapshot,
  type CatalogStats,
} from "./snapshot";
import { computeCatalogStats, isFree, isSelectable, modelAccess } from "./stats";
import type { CatalogModel, ProviderId } from "./types";

export { BENCHMARKS, BENCHMARK_MAP, benchmarkLabel, PROVIDERS, PROVIDER_LIST };
export { isFree, isSelectable, modelAccess, computeCatalogStats };
export * from "./types";
export {
  EMPTY_SNAPSHOT,
  activeSnapshot,
  installSnapshot,
  subscribeSnapshot,
  toWireSnapshot,
  type CatalogSnapshot,
  type CatalogSnapshotRecord,
  type CatalogStats,
  type CatalogDiffEntry,
  type CatalogDiffKind,
} from "./snapshot";
export { BASELINE_SNAPSHOT };

// --- Derivation caches ----------------------------------------------------
//
// The catalog is a *snapshot* that can be replaced at runtime (daily sync), so
// the old process-lifetime memoization no longer holds. Instead every derivation
// is cached in a WeakMap keyed on the snapshot object itself — the pattern
// already used for the chat message DAG in `lib/chat/tree.ts`. A new snapshot is
// a new identity and therefore a cache miss, so the cache can go cold but never
// stale, and a replaced snapshot's derivations are collectable.
//
// These helpers are called inside render loops (per message, per row, per
// keystroke), where an unindexed `find` over hundreds of entries or a fresh
// `filter` allocation is the difference between a smooth frame and a dropped one.
//
// Cached arrays are shared, so callers must not mutate them. Every in-repo
// caller either reads or copies first; `freezeInDev` turns a future violation
// into a loud error in development instead of silent cross-component
// corruption, while costing nothing in production.

const DEV = process.env.NODE_ENV !== "production";

function freezeInDev<T>(arr: T[]): T[] {
  return DEV ? (Object.freeze(arr) as T[]) : arr;
}

interface Derivations {
  index?: Map<string, CatalogModel>;
  routable?: CatalogModel[];
  free?: CatalogModel[];
  byok?: CatalogModel[];
  trending?: CatalogModel[];
  brands?: string[];
  byProvider?: [string, CatalogModel[]][];
  routeCounts?: Map<ProviderId, number>;
  /** Keyed `"<days>:<epoch-day>"` — `newModels` depends on both. */
  fresh?: Map<string, CatalogModel[]>;
}

const derivations = new WeakMap<CatalogSnapshot, Derivations>();

/**
 * The snapshot every selector reads. Falls back to the bundled baseline when
 * nothing has been installed, so a module that never sees a snapshot behaves
 * byte-identically to the pre-sync build.
 */
function snap(): CatalogSnapshot {
  const s = activeSnapshot();
  return s === EMPTY_SNAPSHOT ? BASELINE_SNAPSHOT : s;
}

function of(s: CatalogSnapshot): Derivations {
  let d = derivations.get(s);
  if (!d) {
    d = {};
    derivations.set(s, d);
  }
  return d;
}

/**
 * Every model in the catalog, including `upcoming` and `deprecated` entries.
 *
 * This replaced the old `MODELS` re-export on purpose: reading the module
 * constant directly would silently pin a consumer to the bundled baseline and
 * miss every synced model. Surfaces that catalogue the whole ecosystem (the
 * leaderboard, the cost frontier) want this; anything the user can *pick* from
 * wants `routableModels()`.
 */
export function allModels(): CatalogModel[] {
  return snap().models;
}

export function getModelById(id: string): CatalogModel | undefined {
  const s = snap();
  const d = of(s);
  if (!d.index) {
    d.index = new Map(s.models.map((m) => [m.id, m]));
  }
  return d.index.get(id);
}

/** Models that can actually be called through at least one provider. */
export function routableModels(): CatalogModel[] {
  const s = snap();
  const d = of(s);
  return (d.routable ??= freezeInDev(
    s.models.filter((m) => m.routes.length > 0 && isSelectable(m)),
  ));
}

// --- Hub rails ------------------------------------------------------------

/** Free, openly-served models (open weights on an operator key). */
export function freeModels(): CatalogModel[] {
  const s = snap();
  const d = of(s);
  return (d.free ??= freezeInDev(
    s.models.filter((m) => modelAccess(m) === "free" && isSelectable(m)),
  ));
}

/** Closed/paid models reachable with the user's own OpenRouter key. */
export function byokModels(): CatalogModel[] {
  const s = snap();
  const d = of(s);
  return (d.byok ??= freezeInDev(
    s.models.filter((m) => modelAccess(m) === "byok" && isSelectable(m)),
  ));
}

/** Hand-curated "hot right now" set for the Trending rail. */
export function trendingModels(): CatalogModel[] {
  const s = snap();
  const d = of(s);
  return (d.trending ??= freezeInDev(
    s.models.filter((m) => m.trending && isSelectable(m)),
  ));
}

function addedTime(m: CatalogModel): number {
  return Date.parse(m.addedAt ?? m.releaseDate);
}

/**
 * Recently-added models for the "New & Notable" rail. Uses `addedAt` when set,
 * otherwise falls back to `releaseDate`. Self-expires as time passes.
 *
 * Cached per `(days, calendar day)` because the result is both argument- and
 * time-dependent, and the Hub calls it on every render.
 */
export function newModels(days = 60): CatalogModel[] {
  const s = snap();
  const d = of(s);
  const epochDay = Math.floor(Date.now() / 86_400_000);
  const key = `${days}:${epochDay}`;
  const cache = (d.fresh ??= new Map());
  const hit = cache.get(key);
  if (hit) return hit;

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const list = freezeInDev(
    s.models
      .filter((m) => {
        if (!isSelectable(m)) return false;
        const when = addedTime(m);
        return !Number.isNaN(when) && when >= cutoff;
      })
      .sort((a, b) => addedTime(b) - addedTime(a)),
  );
  cache.set(key, list);
  return list;
}

/** Whether a model is fresh enough to earn a "New" badge. */
export function isNewModel(m: CatalogModel, days = 14): boolean {
  if (!isSelectable(m)) return false;
  const when = addedTime(m);
  return !Number.isNaN(when) && when >= Date.now() - days * 24 * 60 * 60 * 1000;
}

/**
 * Whether the model can return images.
 *
 * Absent `outputModalities` means text, deliberately: every snapshot written
 * before image output existed omits the field, and reading that as "unknown"
 * would make every old entry ambiguous.
 */
export function producesImages(m: CatalogModel | undefined | null): boolean {
  return !!m?.outputModalities?.includes("image");
}

/** Distinct brand/family owners (Anthropic, Meta, …). */
export function brandProviders(): string[] {
  const s = snap();
  const d = of(s);
  return (d.brands ??= freezeInDev(
    Array.from(new Set(s.models.map((m) => m.provider))).sort(),
  ));
}

/**
 * Routable models grouped by brand, brands sorted, models sorted within each.
 * Replaces the import-time grouping the model switcher used to build, which
 * could not see a synced snapshot.
 */
export function groupedByProvider(): [string, CatalogModel[]][] {
  const s = snap();
  const d = of(s);
  if (d.byProvider) return d.byProvider;

  const map = new Map<string, CatalogModel[]>();
  for (const m of routableModels()) {
    const bucket = map.get(m.provider);
    if (bucket) bucket.push(m);
    else map.set(m.provider, [m]);
  }
  const grouped = Array.from(map.entries())
    .map(([brand, list]) => {
      list.sort((a, b) => a.name.localeCompare(b.name));
      return [brand, freezeInDev(list)] as [string, CatalogModel[]];
    })
    .sort((a, b) => a[0].localeCompare(b[0]));

  return (d.byProvider = freezeInDev(grouped));
}

/**
 * How many catalog models each route provider can serve. The Router page used to
 * recompute this with a nested scan (providers × models) on every render.
 */
export function modelCountByRouteProvider(): Map<ProviderId, number> {
  const s = snap();
  const d = of(s);
  if (d.routeCounts) return d.routeCounts;

  const counts = new Map<ProviderId, number>();
  for (const p of PROVIDER_LIST) counts.set(p.id, 0);
  for (const m of s.models) {
    // A model may list the same provider twice (e.g. a `:free` route beside the
    // paid one) — count the model once per provider, not once per route.
    const seen = new Set<ProviderId>();
    for (const r of m.routes) {
      if (seen.has(r.provider)) continue;
      seen.add(r.provider);
      counts.set(r.provider, (counts.get(r.provider) ?? 0) + 1);
    }
  }
  return (d.routeCounts = counts);
}

export function getBenchmark(model: CatalogModel, key: string): number | undefined {
  return model.benchmarks.find((s) => s.key === key)?.score;
}

/** Blended $/Mtok assuming a 3:1 input:output ratio — a quick comparison metric. */
export function blendedPrice(model: CatalogModel): number {
  const { inputPerM, outputPerM } = model.pricing;
  return (inputPerM * 3 + outputPerM) / 4;
}

const INTELLIGENCE_KEYS = ["mmlu", "gpqa", "humaneval", "math"] as const;

// Keyed on the model object, so a snapshot swap that reuses an unchanged entry
// keeps its cached score and a changed entry (a new object) misses naturally.
// The leaderboard calls this O(n log n) times per sort and once more per row.
const intelligenceCache = new WeakMap<CatalogModel, number>();

/**
 * A coarse "intelligence index" (0–100) from available benchmarks for sorting.
 *
 * Curated benchmark scores are tried first so the hand-audited ranking of the
 * baseline catalog does not churn when synced data arrives. Artificial Analysis'
 * intelligence index (published by OpenRouter for a majority of models) is the
 * next-best signal and is already on a 0–100 scale; normalized Arena Elo is the
 * last resort.
 */
export function intelligenceIndex(model: CatalogModel): number {
  const hit = intelligenceCache.get(model);
  if (hit !== undefined) return hit;

  const vals = INTELLIGENCE_KEYS.map((k) => getBenchmark(model, k)).filter(
    (v): v is number => v !== undefined,
  );

  let score: number;
  if (vals.length > 0) {
    score = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  } else {
    const aa = getBenchmark(model, "aa-intelligence");
    if (aa !== undefined) {
      score = Math.round(aa);
    } else {
      // fall back to arena elo normalized
      const elo = getBenchmark(model, "arena");
      score = elo ? Math.round(((elo - 1100) / 300) * 100) : 0;
    }
  }

  intelligenceCache.set(model, score);
  return score;
}

/** Headline ecosystem stats for the landing proof strip. */
export function catalogStats(): CatalogStats {
  return snap().stats;
}

export function providersForModel(model: CatalogModel): ProviderId[] {
  const seen = new Set<ProviderId>();
  const out: ProviderId[] = [];
  for (const r of model.routes) {
    if (seen.has(r.provider)) continue;
    seen.add(r.provider);
    out.push(r.provider);
  }
  return out;
}
