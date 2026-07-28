// Provider namespace → brand, plus the heuristics used to reconstruct metadata
// for models only NVIDIA lists.
//
// NVIDIA NIM's `/v1/models` returns `{ id, object, created, owned_by }` and
// nothing else — no context window, no pricing, no capabilities. For the ~64
// models NVIDIA serves that OpenRouter does not, everything below the id has to
// be inferred. Entries derived this way are tagged `metaConfidence: "derived"`
// so the UI can say so rather than presenting a guess as a measurement.

/**
 * Brand names as the catalog displays them. Keyed by the provider namespace
 * (OpenRouter `id` prefix) or NVIDIA `owned_by`. Values match the curated
 * `provider` strings in `models.ts` so synced and curated entries group together.
 */
export const BRAND_BY_NAMESPACE: Record<string, string> = {
  "01-ai": "01.AI",
  abacusai: "Abacus.AI",
  adept: "Adept",
  ai21: "AI21",
  ai21labs: "AI21",
  "aion-labs": "Aion Labs",
  aisingapore: "AI Singapore",
  allenai: "Allen AI",
  amazon: "Amazon",
  "anthracite-org": "Anthracite",
  anthropic: "Anthropic",
  "arcee-ai": "Arcee AI",
  baai: "BAAI",
  baidu: "Baidu",
  bigcode: "BigCode",
  bytedance: "ByteDance",
  "bytedance-seed": "ByteDance",
  cognitivecomputations: "Cognitive Computations",
  cohere: "Cohere",
  databricks: "Databricks",
  deepcogito: "Deep Cogito",
  deepseek: "DeepSeek",
  "deepseek-ai": "DeepSeek",
  google: "Google",
  gryphe: "Gryphe",
  ibm: "IBM",
  "ibm-granite": "IBM",
  inception: "Inception",
  inclusionai: "InclusionAI",
  inflection: "Inflection",
  kwaipilot: "Kuaishou",
  mancer: "Mancer",
  meituan: "Meituan",
  meta: "Meta",
  "meta-llama": "Meta",
  microsoft: "Microsoft",
  minimax: "MiniMax",
  minimaxai: "MiniMax",
  mistralai: "Mistral",
  moonshotai: "Moonshot AI",
  morph: "Morph",
  "nex-agi": "Nex AGI",
  nousresearch: "Nous Research",
  "nv-mistralai": "NVIDIA",
  nvidia: "NVIDIA",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  perceptron: "Perceptron",
  perplexity: "Perplexity",
  poolside: "Poolside",
  qwen: "Alibaba",
  rekaai: "Reka",
  relace: "Relace",
  sakana: "Sakana AI",
  sao10k: "Sao10K",
  sarvamai: "Sarvam AI",
  snowflake: "Snowflake",
  stepfun: "StepFun",
  "stepfun-ai": "StepFun",
  tencent: "Tencent",
  thedrummer: "TheDrummer",
  thinkingmachines: "Thinking Machines",
  undi95: "Undi95",
  upstage: "Upstage",
  writer: "Writer",
  "x-ai": "xAI",
  xiaomi: "Xiaomi",
  "z-ai": "Zhipu AI",
  zyphra: "Zyphra",
};

/** Words that should keep a fixed casing when a name is reconstructed from an id. */
const ACRONYMS: Record<string, string> = {
  ai: "AI",
  asr: "ASR",
  fp8: "FP8",
  gpt: "GPT",
  llm: "LLM",
  moe: "MoE",
  nim: "NIM",
  ocr: "OCR",
  oss: "OSS",
  qwq: "QwQ",
  r1: "R1",
  rl: "RL",
  tts: "TTS",
  v1: "V1",
  v2: "V2",
  v3: "V3",
  vl: "VL",
  vlm: "VLM",
};

/**
 * The namespace part of a provider model id. Strips OpenRouter's `~` prefix,
 * which marks a floating "latest" pointer rather than a different vendor.
 */
export function namespaceOf(providerId: string): string {
  const slash = providerId.indexOf("/");
  const ns = slash === -1 ? "" : providerId.slice(0, slash);
  return ns.replace(/^~/, "").toLowerCase();
}

/** Title-case an unknown namespace so an unmapped vendor still reads correctly. */
export function titleizeNamespace(ns: string): string {
  if (!ns) return "Unknown";
  return ns
    .split(/[-_.]/)
    .filter(Boolean)
    .map((w) => ACRONYMS[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function brandFor(providerId: string, ownedBy?: string): string {
  const ns = namespaceOf(providerId);
  if (ns && BRAND_BY_NAMESPACE[ns]) return BRAND_BY_NAMESPACE[ns];

  const owner = ownedBy?.toLowerCase();
  if (owner && BRAND_BY_NAMESPACE[owner]) return BRAND_BY_NAMESPACE[owner];

  return titleizeNamespace(ns || owner || "");
}

/**
 * Reconstruct a display name from a bare model id.
 * `"llama-3.3-nemotron-super-49b-v1.5"` → `"Llama 3.3 Nemotron Super 49B V1.5"`.
 */
export function titleizeModelId(providerId: string): string {
  const slash = providerId.lastIndexOf("/");
  const bare = (slash === -1 ? providerId : providerId.slice(slash + 1)).split(":")[0];

  return bare
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (ACRONYMS[lower]) return ACRONYMS[lower];
      // Parameter counts and versions: 49b → 49B, 8x22b → 8x22B, 3.3 → 3.3
      if (/^\d+(\.\d+)?[a-z]$/.test(lower)) return lower.toUpperCase();
      if (/^\d+x\d+[a-z]$/.test(lower)) return lower.replace(/[a-z]$/, (c) => c.toUpperCase());
      if (/^v?\d/.test(lower)) return lower.charAt(0).toUpperCase() + lower.slice(1);
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/**
 * Context windows for the model families NVIDIA serves, keyed by a substring of
 * the model id, longest match first. Published figures from each model's own
 * release notes — the only honest source available when the provider API omits
 * the field entirely.
 */
export const CONTEXT_BY_FAMILY: [pattern: string, contextWindow: number][] = [
  ["deepseek-r1", 163_840],
  ["deepseek-v3", 163_840],
  ["deepseek-coder", 16_384],
  ["llama-4", 1_048_576],
  ["llama-3.3", 131_072],
  ["llama-3.2", 131_072],
  ["llama-3.1", 131_072],
  ["llama3-", 8_192],
  ["nemotron-3", 131_072],
  ["nemotron", 131_072],
  ["gemma-3", 131_072],
  ["gemma-2", 8_192],
  ["gemma", 8_192],
  ["gemini", 1_048_576],
  ["qwen3", 32_768],
  ["qwen2.5", 32_768],
  ["qwen-2.5", 32_768],
  ["qwq", 32_768],
  ["mistral-large", 131_072],
  ["mistral-nemo", 131_072],
  ["mistral-small", 131_072],
  ["mixtral", 65_536],
  ["mistral", 32_768],
  ["codestral", 32_768],
  ["phi-4", 16_384],
  ["phi-3", 131_072],
  ["granite", 131_072],
  ["kimi", 131_072],
  ["glm", 131_072],
  ["minimax", 1_000_000],
  ["gpt-oss", 131_072],
  ["jamba", 262_144],
  ["command", 131_072],
  ["dbrx", 32_768],
  ["yi-", 32_768],
  ["starcoder", 16_384],
  ["palmyra", 131_072],
  ["seed-oss", 524_288],
  ["step-3", 65_536],
];

const DEFAULT_CONTEXT = 32_768;

export function contextWindowFor(providerId: string): number {
  const id = providerId.toLowerCase();
  let best = DEFAULT_CONTEXT;
  let bestLength = 0;
  for (const [pattern, ctx] of CONTEXT_BY_FAMILY) {
    if (id.includes(pattern) && pattern.length > bestLength) {
      best = ctx;
      bestLength = pattern.length;
    }
  }
  return best;
}

/** Ids whose weights are known to be reasoning/chain-of-thought models. */
const REASONING_HINT = /(^|[-/])(r1|qwq|magistral)|reasoning|thinking|nemotron-.*-(reason|think)/i;

/** Ids that accept image input. */
const VISION_HINT = /(^|[-/])(vl|vlm|llava|pixtral|fuyu)|vision|maverick|scout|multimodal|-vl-/i;

export function reasoningHint(providerId: string): boolean {
  return REASONING_HINT.test(providerId);
}

export function visionHint(providerId: string): boolean {
  return VISION_HINT.test(providerId);
}
