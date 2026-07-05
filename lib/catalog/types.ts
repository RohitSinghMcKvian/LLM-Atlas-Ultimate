export type ProviderId = "nvidia" | "openrouter" | "local" | "google" | "groq";
export type License = "open" | "proprietary";
export type ModelStatus = "ga" | "preview" | "upcoming" | "deprecated";
export type Modality = "text" | "vision" | "audio";

/**
 * How an end user pays for a model.
 * - "free": open-weight model served on an operator-funded provider key — no key from the user.
 * - "byok": closed/paid model routed through the user's own OpenRouter key (bring-your-own-key).
 */
export type ModelAccess = "free" | "byok";

export interface BenchmarkScore {
  /** Benchmark key — see lib/catalog/benchmarks.ts */
  key: string;
  /** Score in the benchmark's native unit (% or elo). */
  score: number;
  source: string;
  sourceUrl: string;
  /** ISO date the score was measured / reported. */
  measuredAt: string;
}

export interface ModelPricing {
  /** USD per 1M input tokens. */
  inputPerM: number;
  /** USD per 1M output tokens. */
  outputPerM: number;
  /** USD per 1M cached input tokens, if the provider supports caching. */
  cachedInputPerM?: number;
  effectiveFrom: string;
}

export interface ModelRoute {
  provider: ProviderId;
  /** The provider-specific model id used in the API call. */
  model: string;
}

export interface CatalogModel {
  /** Atlas canonical id. */
  id: string;
  name: string;
  /** Brand / family owner, e.g. "Anthropic", "Meta". */
  provider: string;
  family: string;
  license: License;
  /** Free (operator-funded open model) vs BYOK (user's OpenRouter key for closed/paid). */
  access: ModelAccess;
  /** Hand-curated "hot right now" flag that powers the Trending rail. */
  trending?: boolean;
  status: ModelStatus;
  releaseDate: string;
  /** ISO date the model was added to the Atlas catalog; drives the "New" rail. Falls back to releaseDate. */
  addedAt?: string;
  contextWindow: number;
  maxOutput: number;
  modalities: Modality[];
  capabilities: {
    toolUse: boolean;
    structuredOutput: boolean;
    reasoning: boolean;
    caching: boolean;
  };
  pricing: ModelPricing;
  benchmarks: BenchmarkScore[];
  /** Typical time-to-first-token, ms. */
  latencyMs?: number;
  /** Typical output throughput, tokens/sec. */
  throughputTps?: number;
  /** Atlas community rating, 0–5. */
  rating?: number;
  blurb: string;
  routes: ModelRoute[];
  tags?: string[];
}

export interface BenchmarkDef {
  key: string;
  label: string;
  /** Short description of what it measures. */
  about: string;
  category: "reasoning" | "coding" | "math" | "knowledge" | "agentic" | "vision" | "overall";
  unit: "%" | "elo";
  higherBetter: boolean;
  /** Reasonable axis max for charts. */
  max: number;
}
