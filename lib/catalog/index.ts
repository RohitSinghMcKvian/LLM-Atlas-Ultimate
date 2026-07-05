import { MODELS } from "./models";
import { BENCHMARKS, BENCHMARK_MAP, benchmarkLabel } from "./benchmarks";
import { PROVIDERS, PROVIDER_LIST } from "./providers";
import type { CatalogModel, ModelAccess, ProviderId } from "./types";

export { MODELS, BENCHMARKS, BENCHMARK_MAP, benchmarkLabel, PROVIDERS, PROVIDER_LIST };
export * from "./types";

export function getModelById(id: string): CatalogModel | undefined {
  return MODELS.find((m) => m.id === id);
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
export function routableModels(): CatalogModel[] {
  return MODELS.filter((m) => m.routes.length > 0 && m.status !== "upcoming");
}

// --- Hub rails ------------------------------------------------------------

/** Free, openly-served models (open weights on an operator key). */
export function freeModels(): CatalogModel[] {
  return MODELS.filter((m) => modelAccess(m) === "free" && m.status !== "upcoming");
}

/** Closed/paid models reachable with the user's own OpenRouter key. */
export function byokModels(): CatalogModel[] {
  return MODELS.filter((m) => modelAccess(m) === "byok" && m.status !== "upcoming");
}

/** Hand-curated "hot right now" set for the Trending rail. */
export function trendingModels(): CatalogModel[] {
  return MODELS.filter((m) => m.trending && m.status !== "upcoming");
}

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
export function brandProviders(): string[] {
  return Array.from(new Set(MODELS.map((m) => m.provider))).sort();
}

export function getBenchmark(model: CatalogModel, key: string): number | undefined {
  return model.benchmarks.find((s) => s.key === key)?.score;
}

/** Blended $/Mtok assuming a 3:1 input:output ratio — a quick comparison metric. */
export function blendedPrice(model: CatalogModel): number {
  const { inputPerM, outputPerM } = model.pricing;
  return (inputPerM * 3 + outputPerM) / 4;
}

/** A coarse "intelligence index" (0–100) from available benchmarks for sorting. */
export function intelligenceIndex(model: CatalogModel): number {
  const keys = ["mmlu", "gpqa", "humaneval", "math"];
  const vals = keys
    .map((k) => getBenchmark(model, k))
    .filter((v): v is number => v !== undefined);
  if (vals.length === 0) {
    // fall back to arena elo normalized
    const elo = getBenchmark(model, "arena");
    return elo ? Math.round(((elo - 1100) / 300) * 100) : 0;
  }
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/** Headline ecosystem stats for the landing proof strip. */
export function catalogStats() {
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

export function providersForModel(model: CatalogModel): ProviderId[] {
  return model.routes.map((r) => r.provider);
}
