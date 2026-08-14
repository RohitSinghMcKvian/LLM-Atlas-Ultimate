import type { CatalogModel, ProviderId } from "../types";

/**
 * A model as reconstructed from provider APIs, before the curated overlay is
 * applied. Every `CatalogModel` field a provider can actually tell us is filled
 * in; everything a provider cannot know (`trending`, `rating`, `latencyMs`,
 * `throughputTps`, curated benchmark scores) is left to the overlay.
 */
export interface ModelDraft {
  /** The id this draft would claim if no curated entry matches it. */
  atlasId: string;
  /** Lossy key used to match against the overlay and across providers. */
  matchKey: string;
  /** Which provider lists supplied this draft. Drives the `sources` guard. */
  sourceProviders: ProviderId[];
  model: Omit<CatalogModel, "id">;
  /**
   * Provider ids that resolve to this draft's base model — variant suffixes and
   * cross-provider spellings. Registered as snapshot aliases.
   */
  aliasIds: string[];
}

/** Upstream shape of `GET {openrouter}/v1/models`. Only the fields we read. */
export interface OpenRouterModel {
  id: string;
  canonical_slug?: string | null;
  hugging_face_id?: string | null;
  name?: string | null;
  created?: number | null;
  description?: string | null;
  context_length?: number | null;
  architecture?: {
    modality?: string | null;
    input_modalities?: string[] | null;
    output_modalities?: string[] | null;
    tokenizer?: string | null;
  } | null;
  pricing?: {
    prompt?: string | null;
    completion?: string | null;
    input_cache_read?: string | null;
    input_cache_write?: string | null;
    /**
     * Per-token price for the tokens a generated image is made of. Quoted in
     * the same unit as `prompt`/`completion`, NOT per image — `image` (without
     * the suffix) is the separate per-input-image vision price.
     */
    image_output?: string | null;
  } | null;
  top_provider?: {
    context_length?: number | null;
    max_completion_tokens?: number | null;
    is_moderated?: boolean | null;
  } | null;
  supported_parameters?: string[] | null;
  expiration_date?: string | null;
  reasoning?: {
    mandatory?: boolean | null;
    default_enabled?: boolean | null;
    supported_efforts?: string[] | null;
  } | null;
  benchmarks?: {
    artificial_analysis?: {
      intelligence_index?: number | null;
      coding_index?: number | null;
      agentic_index?: number | null;
    } | null;
    design_arena?: { arena?: string; category?: string; elo?: number; win_rate?: number }[] | null;
  } | null;
}

/** Upstream shape of `GET {nvidia}/v1/models`. This really is all of it. */
export interface NvidiaModel {
  id: string;
  object?: string;
  created?: number | null;
  owned_by?: string | null;
}
