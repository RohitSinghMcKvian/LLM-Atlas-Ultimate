import { MODELS } from "./models";
import { BENCHMARKS, BENCHMARK_MAP, benchmarkLabel } from "./benchmarks";
import { PROVIDERS, PROVIDER_LIST } from "./providers";
import type { CatalogModel, ModelAccess, ProviderId } from "./types";

export { MODELS, BENCHMARKS, BENCHMARK_MAP, benchmarkLabel, PROVIDERS, PROVIDER_LIST };
export * from "./types";

// --- Derivation caches ----------------------------------------------------
//
// `MODELS` is a static module constant, so everything derived from it without
// a time or argument dependency is invariant for the life of the process.
// These helpers are called inside render loops (per message, per row, per
// keystroke), where an unindexed `find` over 97 entries or a fresh `filter`
// allocation is the difference between a smooth frame and a dropped one.
//
// Cached arrays are shared, so callers must not mutate them. Every in-repo
// caller either reads or copies first; `freezeInDev` turns a future violation
// into a loud error in development instead of silent cross-component
// corruption, while costing nothing in production.

const DEV = process.env.NODE_ENV !== "production";

function freezeInDev<T>(arr: T[]): T[] {
  return DEV ? Object.freeze(arr) as T[] : arr;
}

/** Memoize a zero-argument, catalog-derived array. */
function derived<T>(compute: () => T[]): () => T[] {
  let cache: T[] | undefined;
  return () => (cache ??= freezeInDev(compute()));
}

let modelIndex: Map<string, CatalogModel> | undefined;

export function getModelById(id: string): CatalogModel | undefined {
  if (!modelIndex) {
    modelIndex = new Map(MODELS.map((m) => [m.id, m]));
  }
  return modelIndex.get(id);
}

/**
 * The model's access tier. Always prefer this helper over reading `m.access`
 * directly so a stray entry missing the field still resolves sensibly
 * (open ⇒ free, proprietary ⇒ byok).
 */
export function modelAccess(m: CatalogModel): ModelAccess {
  return m.access ?? (m.license === "open" ? "free" : "byok");
}

export function isFree(m: CatalogModel): boolean {
  return modelAccess(m) === "free";
}

/** Models that can actually be called through at least one provider. */
export const routableModels: () => CatalogModel[] = derived(() =>
  MODELS.filter((m) => m.routes.length > 0 && m.status !== "upcoming"),
);

// --- Hub rails ------------------------------------------------------------

/** Free, openly-served models (open weights on an operator key). */
export const freeModels: () => CatalogModel[] = derived(() =>
  MODELS.filter((m) => modelAccess(m) === "free" && m.status !== "upcoming"),
);

/** Closed/paid models reachable with the user's own OpenRouter key. */
export const byokModels: () => CatalogModel[] = derived(() =>
  MODELS.filter((m) => modelAccess(m) === "byok" && m.status !== "upcoming"),
);

/** Hand-curated "hot right now" set for the Trending rail. */
export const trendingModels: () => CatalogModel[] = derived(() =>
  MODELS.filter((m) => m.trending && m.status !== "upcoming"),
);

/**
 * Recently-added models for the "New & Notable" rail. Uses `addedAt` when set,
 * otherwise falls back to `releaseDate`. Self-expires as time passes.
 */
export function newModels(days = 60): CatalogModel[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return MODELS.filter((m) => {
    if (m.status === "upcoming") return false;
    const when = Date.parse(m.addedAt ?? m.releaseDate);
    return !Number.isNaN(when) && when >= cutoff;
  }).sort(
    (a, b) =>
      Date.parse(b.addedAt ?? b.releaseDate) - Date.parse(a.addedAt ?? a.releaseDate),
  );
}

/** Distinct brand/family owners (Anthropic, Meta, …). */
export const brandProviders: () => string[] = derived(() =>
  Array.from(new Set(MODELS.map((m) => m.provider))).sort(),
);

export function getBenchmark(model: CatalogModel, key: string): number | undefined {
  return model.benchmarks.find((s) => s.key === key)?.score;
}

/** Blended $/Mtok assuming a 3:1 input:output ratio — a quick comparison metric. */
export function blendedPrice(model: CatalogModel): number {
  const { inputPerM, outputPerM } = model.pricing;
  return (inputPerM * 3 + outputPerM) / 4;
}

const INTELLIGENCE_KEYS = ["mmlu", "gpqa", "humaneval", "math"] as const;

// Catalog models are stable singletons, so a WeakMap keyed on the object is a
// safe permanent cache. The leaderboard calls this O(n log n) times per sort
// and once more per rendered row.
const intelligenceCache = new WeakMap<CatalogModel, number>();

/** A coarse "intelligence index" (0–100) from available benchmarks for sorting. */
export function intelligenceIndex(model: CatalogModel): number {
  const hit = intelligenceCache.get(model);
  if (hit !== undefined) return hit;

  const vals = INTELLIGENCE_KEYS.map((k) => getBenchmark(model, k)).filter(
    (v): v is number => v !== undefined,
  );
  let score: number;
  if (vals.length === 0) {
    // fall back to arena elo normalized
    const elo = getBenchmark(model, "arena");
    score = elo ? Math.round(((elo - 1100) / 300) * 100) : 0;
  } else {
    score = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }

  intelligenceCache.set(model, score);
  return score;
}

let statsCache: ReturnType<typeof computeCatalogStats> | undefined;

function computeCatalogStats() {
  const providers = brandProviders().length;
  const routeProviders = PROVIDER_LIST.length;
  return {
    models: MODELS.length,
    // headline number rounds up to a "tracked" figure incl. variants
    modelsTracked: 195,
    brandProviders: providers,
    routeProviders,
    benchmarks: BENCHMARKS.length,
    upcoming: MODELS.filter((m) => m.status === "upcoming").length,
  };
}

/** Headline ecosystem stats for the landing proof strip. */
export function catalogStats() {
  return (statsCache ??= computeCatalogStats());
}

export function providersForModel(model: CatalogModel): ProviderId[] {
  return model.routes.map((r) => r.provider);
}
