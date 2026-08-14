export type ProviderId = "nvidia" | "openrouter" | "local" | "google" | "groq";
export type License = "open" | "proprietary";
export type ModelStatus = "ga" | "preview" | "upcoming" | "deprecated";
/**
 * What a model can be *given*. `vision` means it accepts images, not that it
 * makes them — see {@link OutputModality} for the other direction.
 */
export type Modality = "text" | "vision" | "audio";

/** What a model can *produce*. */
export type OutputModality = "text" | "image";

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
  /**
   * USD per 1M *image-output* tokens, for models that draw (§P13).
   *
   * A separate rate rather than a per-image price: OpenRouter's
   * `pricing.image_output` is quoted per token in the same unit as
   * `prompt`/`completion`, and a generated image costs a fixed number of them
   * (Gemini 2.5 Flash Image: 1290 tokens at $30/M = $0.039 an image). Pricing
   * those tokens at `outputPerM` under-reports by 10–20×.
   */
  imageOutputPerM?: number;
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
  /**
   * @deprecated Legacy hand-audited tier. Never written by the sync and never
   * read by application code — call `modelAccess()` from `lib/catalog/stats.ts`,
   * or `modelAvailability()` from `lib/catalog/availability.ts` when you need to
   * know whether the current user can actually run the model.
   *
   * It is kept only as an input on the curated overlay in `models.ts`. The field
   * went stale as soon as the daily sync began attaching live OpenRouter routes:
   * 38 entries still claimed `"free"` while their only live route was a metered
   * endpoint that answers 402 on a zero-credit key. Access is now derived from
   * `routes`, so there is exactly one thing that can be wrong.
   */
  access?: ModelAccess;
  /** Hand-curated "hot right now" flag that powers the Trending rail. */
  trending?: boolean;
  status: ModelStatus;
  releaseDate: string;
  /** ISO date the model was added to the Atlas catalog; drives the "New" rail. Falls back to releaseDate. */
  addedAt?: string;
  contextWindow: number;
  maxOutput: number;
  modalities: Modality[];
  /**
   * What the model emits. Absent means text only, which is what every entry
   * meant before image output existed — so an old snapshot keeps its meaning
   * rather than being read as "unknown".
   */
  outputModalities?: OutputModality[];
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
  /**
   * How much of this entry's metadata is attested by the provider.
   *
   * `"verified"` — the numbers came from a provider API or were hand-audited.
   * `"derived"`  — reconstructed from the model id because the provider list
   *                supplied nothing but the id (NVIDIA NIM returns only
   *                `{ id, object, created, owned_by }`). Surfaced in the UI
   *                rather than hidden: a heuristic context window must not be
   *                presented as a measurement.
   */
  metaConfidence?: "verified" | "derived";
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
