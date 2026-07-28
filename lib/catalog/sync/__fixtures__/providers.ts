import type { NvidiaModel, OpenRouterModel } from "../types";

// Hand-written fixtures, not a dump of the live 175 KB payload.
//
// Each entry exists to pin one derivation rule, and the comment says which. A
// captured dump would be larger, would rot, and would not tell a reader why any
// particular field is there.

export const OPENROUTER_SAMPLE: OpenRouterModel[] = [
  // Frontier closed model: proprietary (no hugging_face_id), reasoning via the
  // `reasoning` block, caching via cache pricing, full AA benchmark set, and a
  // `top_provider` context that differs from the advertised one.
  {
    id: "anthropic/claude-opus-5",
    canonical_slug: "anthropic/claude-opus-5-20260601",
    hugging_face_id: null,
    name: "Anthropic: Claude Opus 5",
    created: 1_780_000_000,
    description:
      "The most capable [Opus](/anthropic) model to date. Excels at long-horizon agentic coding and research synthesis. Learn more in Anthropic's docs.",
    context_length: 1_000_000,
    architecture: {
      modality: "text+image+file->text",
      input_modalities: ["text", "image", "file"],
      output_modalities: ["text"],
      tokenizer: "Claude",
    },
    pricing: {
      prompt: "0.000005",
      completion: "0.000025",
      input_cache_read: "0.0000005",
      input_cache_write: "0.00000625",
    },
    top_provider: { context_length: 900_000, max_completion_tokens: 64_000, is_moderated: true },
    supported_parameters: ["max_tokens", "reasoning", "reasoning_effort", "tools", "tool_choice", "structured_outputs", "stop"],
    reasoning: { mandatory: false, default_enabled: true, supported_efforts: ["low", "medium", "high"] },
    benchmarks: {
      artificial_analysis: { intelligence_index: 60.7, coding_index: 78, agentic_index: 55.3 },
      design_arena: [
        { arena: "models", category: "dataviz", elo: 1335, win_rate: 61.3 },
        { arena: "models", category: "webdev", elo: 1390, win_rate: 66.0 },
      ],
    },
  },

  // Open-weight model (hugging_face_id set) whose id matches a curated entry —
  // exercises the "curated id wins" rule.
  {
    id: "deepseek/deepseek-v4-pro",
    canonical_slug: "deepseek/deepseek-v4-pro",
    hugging_face_id: "deepseek-ai/DeepSeek-V4-Pro",
    name: "DeepSeek: DeepSeek V4 Pro",
    created: 1_775_000_000,
    description: "Flagship reasoning model with open weights.",
    context_length: 163_840,
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    pricing: { prompt: "0.0000004", completion: "0.0000016" },
    top_provider: { context_length: 163_840, max_completion_tokens: 32_768 },
    supported_parameters: ["max_tokens", "include_reasoning", "tools", "response_format"],
    benchmarks: { artificial_analysis: { intelligence_index: 58.2, coding_index: 71 } },
  },

  // The `:free` variant of the model above. Must NOT become its own catalog
  // entry — it folds into a route and forces access:"free".
  {
    id: "deepseek/deepseek-v4-pro:free",
    canonical_slug: "deepseek/deepseek-v4-pro",
    hugging_face_id: "deepseek-ai/DeepSeek-V4-Pro",
    name: "DeepSeek: DeepSeek V4 Pro (free)",
    created: 1_775_000_000,
    description: "Free tier of DeepSeek V4 Pro.",
    context_length: 163_840,
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    pricing: { prompt: "0", completion: "0" },
    top_provider: { context_length: 163_840, max_completion_tokens: 32_768 },
    supported_parameters: ["max_tokens"],
  },

  // Genuinely zero-priced model — free without a `:free` sibling.
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    canonical_slug: "meta-llama/llama-3.3-70b-instruct",
    hugging_face_id: "meta-llama/Llama-3.3-70B-Instruct",
    name: "Meta: Llama 3.3 70B Instruct",
    created: 1_733_000_000,
    description: "Open-weight instruction-tuned Llama.",
    context_length: 131_072,
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    pricing: { prompt: "0", completion: "0" },
    top_provider: { context_length: 131_072, max_completion_tokens: 16_384 },
    supported_parameters: ["max_tokens", "tools", "top_k", "seed"],
  },

  // `expiration_date` in the near future ⇒ deprecated.
  {
    id: "poolside/laguna-m.1",
    canonical_slug: "poolside/laguna-m.1",
    hugging_face_id: null,
    name: "Poolside: Laguna M.1",
    created: 1_770_000_000,
    description: "Being retired.",
    context_length: 32_768,
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    pricing: { prompt: "0.000002", completion: "0.000008" },
    top_provider: { context_length: 32_768, max_completion_tokens: 8_192 },
    supported_parameters: ["max_tokens"],
    expiration_date: "2026-07-28",
  },

  // Far-future sentinel expiry ⇒ NOT deprecated.
  {
    id: "z-ai/glm-5-turbo",
    canonical_slug: "z-ai/glm-5-turbo",
    hugging_face_id: "zai-org/GLM-5-Turbo",
    name: "Z.AI: GLM 5 Turbo",
    created: 1_782_000_000,
    description: "Fast GLM variant.",
    context_length: 131_072,
    architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
    pricing: { prompt: "0.0000006", completion: "0.0000022" },
    top_provider: { context_length: 131_072, max_completion_tokens: 32_768 },
    supported_parameters: ["max_tokens", "tools"],
    expiration_date: "2098-12-31",
  },

  // `-preview` in the id ⇒ preview status. Also has no `top_provider`, so
  // maxOutput must fall back.
  {
    id: "google/gemini-4-flash-preview",
    canonical_slug: "google/gemini-4-flash-preview",
    hugging_face_id: null,
    name: "Google: Gemini 4 Flash Preview",
    created: 1_784_000_000,
    description: "Preview build.",
    context_length: 1_048_576,
    architecture: { input_modalities: ["text", "image", "audio"], output_modalities: ["text"] },
    pricing: { prompt: "0.0000001", completion: "0.0000004" },
    top_provider: null,
    supported_parameters: ["max_tokens", "tools", "response_format"],
  },

  // Non-chat: must be filtered out entirely.
  {
    id: "openai/text-embedding-3-large",
    canonical_slug: "openai/text-embedding-3-large",
    name: "OpenAI: Text Embedding 3 Large",
    created: 1_706_000_000,
    description: "Embedding model.",
    context_length: 8_191,
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    pricing: { prompt: "0.00000013", completion: "0" },
    supported_parameters: [],
  },

  // Image-output model: must be filtered out (no text output).
  {
    id: "google/imagen-4",
    canonical_slug: "google/imagen-4",
    name: "Google: Imagen 4",
    created: 1_780_000_000,
    description: "Image generation.",
    context_length: 4_096,
    architecture: { input_modalities: ["text"], output_modalities: ["image"] },
    pricing: { prompt: "0.00001", completion: "0" },
    supported_parameters: [],
  },

  // Unmapped vendor namespace ⇒ brand is title-cased from the namespace. Junk
  // pricing strings must coerce to 0, not NaN.
  {
    id: "some-newvendor/experimental-8b",
    canonical_slug: "some-newvendor/experimental-8b",
    hugging_face_id: "some-newvendor/Experimental-8B",
    name: "Experimental 8B",
    created: 1_783_000_000,
    description: "",
    context_length: 32_768,
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    pricing: { prompt: null, completion: undefined },
    top_provider: { context_length: 32_768, max_completion_tokens: 4_096 },
    supported_parameters: null,
  },
];

export const NVIDIA_SAMPLE: NvidiaModel[] = [
  // Cross-matches the OpenRouter Llama entry ⇒ appends a route, no duplicate.
  { id: "meta/llama-3.3-70b-instruct", object: "model", created: 735_790_403, owned_by: "meta" },

  // NVIDIA-only, reasoning hint in the id, derived context from the family table.
  {
    id: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    object: "model",
    created: 735_790_403,
    owned_by: "nvidia",
  },

  // NVIDIA-only vision model (`-vl-` hint).
  { id: "qwen/qwen2.5-vl-7b-instruct", object: "model", created: 735_790_403, owned_by: "qwen" },

  // NVIDIA-only, unknown family ⇒ default context window.
  { id: "databricks/dbrx-instruct", object: "model", created: 735_790_403, owned_by: "databricks" },

  // Every one of these must be excluded as non-chat.
  { id: "baai/bge-m3", object: "model", created: 735_790_403, owned_by: "baai" },
  { id: "nvidia/nv-embedqa-e5-v5", object: "model", created: 735_790_403, owned_by: "nvidia" },
  { id: "nvidia/embed-qa-4", object: "model", created: 735_790_403, owned_by: "nvidia" },
  { id: "nvidia/llama-3.2-nv-embedqa-1b-v1", object: "model", created: 735_790_403, owned_by: "nvidia" },
  { id: "nvidia/nemoretriever-parse", object: "model", created: 735_790_403, owned_by: "nvidia" },
  { id: "nvidia/nemotron-3-embed-1b", object: "model", created: 735_790_403, owned_by: "nvidia" },
  { id: "snowflake/arctic-embed-l", object: "model", created: 735_790_403, owned_by: "snowflake" },
  { id: "meta/llama-guard-4-12b", object: "model", created: 735_790_403, owned_by: "meta" },
  { id: "nvidia/llama-3.1-nemoguard-8b-content-safety", object: "model", created: 735_790_403, owned_by: "nvidia" },
  { id: "nvidia/llama-3.1-nemoguard-8b-topic-control", object: "model", created: 735_790_403, owned_by: "nvidia" },
  { id: "nvidia/llama-3.1-nemotron-safety-guard-8b-v3", object: "model", created: 735_790_403, owned_by: "nvidia" },
  { id: "nvidia/nvclip", object: "model", created: 735_790_403, owned_by: "nvidia" },
  { id: "nvidia/riva-translate-4b-instruct", object: "model", created: 735_790_403, owned_by: "nvidia" },
  { id: "nvidia/nemotron-3.5-content-safety", object: "model", created: 735_790_403, owned_by: "nvidia" },
  { id: "nvidia/nv-rerankqa-mistral-4b-v3", object: "model", created: 735_790_403, owned_by: "nvidia" },
];
