import type { NewsTopic } from "./types";

// Topic display metadata and the keyword lexicon that classifies articles into
// it. Both live here so a topic can never exist in the UI without a way to be
// assigned, or vice versa — `TOPIC_LEXICON` is typed as a total record over
// `NewsTopic`, so adding a topic without keywords is a compile error.
//
// Classification is deliberately deterministic (a weighted keyword match, not a
// model call). Two reasons: the sync must produce a complete corpus on a
// deployment with no API keys at all, and a keyword table is inspectable and
// testable in a way an LLM's judgement is not. `lib/news/sync/classify.ts`
// consumes this; the optional LLM pass may only *refine* summaries, never
// rewrite topics.

export type TopicAccent = "cyan" | "violet" | "amber";

export interface TopicDef {
  id: NewsTopic;
  label: string;
  /** Short blurb for the topic chip tooltip and the empty state. */
  blurb: string;
  accent: TopicAccent;
}

/**
 * Display order. Roughly "what changed" → "how it works" → "what it costs" →
 * "who decides", which is how a reader scanning the chip row tends to narrow.
 */
export const NEWS_TOPICS: readonly TopicDef[] = [
  {
    id: "models",
    label: "Models",
    blurb: "Launches, upgrades, deprecations and benchmark claims.",
    accent: "cyan",
  },
  {
    id: "agents",
    label: "Agents",
    blurb: "Tool use, autonomy, computer use and agent frameworks.",
    accent: "violet",
  },
  {
    id: "open-source",
    label: "Open source",
    blurb: "Open-weight releases, permissive licences and community forks.",
    accent: "cyan",
  },
  {
    id: "multimodal",
    label: "Multimodal",
    blurb: "Vision, audio, video and speech across modalities.",
    accent: "violet",
  },
  {
    id: "research",
    label: "Research",
    blurb: "Preprints, papers and results from the labs.",
    accent: "violet",
  },
  {
    id: "tools",
    label: "Tools",
    blurb: "SDKs, IDEs, evaluation harnesses and developer tooling.",
    accent: "cyan",
  },
  {
    id: "infrastructure",
    label: "Infrastructure",
    blurb: "Silicon, serving stacks, data centres and inference throughput.",
    accent: "amber",
  },
  {
    id: "pricing",
    label: "Pricing",
    blurb: "Token prices, tiers, rate limits and cost changes.",
    accent: "amber",
  },
  {
    id: "safety",
    label: "Safety",
    blurb: "Alignment, red-teaming, evaluations and model risk.",
    accent: "amber",
  },
  {
    id: "policy",
    label: "Policy",
    blurb: "Regulation, litigation, standards and government action.",
    accent: "amber",
  },
  {
    id: "funding",
    label: "Funding",
    blurb: "Rounds, valuations, acquisitions and market moves.",
    accent: "amber",
  },
] as const;

export const TOPIC_MAP: ReadonlyMap<NewsTopic, TopicDef> = new Map(
  NEWS_TOPICS.map((t) => [t.id, t]),
);

export function topicLabel(id: NewsTopic): string {
  return TOPIC_MAP.get(id)?.label ?? id;
}

export function topicAccent(id: NewsTopic): TopicAccent {
  return TOPIC_MAP.get(id)?.accent ?? "cyan";
}

/** Every topic id, in display order. Handy for building total records. */
export const TOPIC_IDS: readonly NewsTopic[] = NEWS_TOPICS.map((t) => t.id);

export function isNewsTopic(value: string): value is NewsTopic {
  return TOPIC_MAP.has(value as NewsTopic);
}

// --- The lexicon ------------------------------------------------------------
//
// A term is matched against the lowercased `title + summary`, on word
// boundaries, so "gpt" does not fire on "cryptography". Weights are coarse on
// purpose — three tiers, not a tuned continuum:
//
//   3  unambiguous. The term alone is strong evidence of the topic.
//   2  strong in context but appears elsewhere.
//   1  weak; only decides a tie.
//
// A phrase containing a space is matched as a phrase. Multi-word phrases are
// worth writing out: "open weights" is a far better signal than "open" and
// "weights" scored separately.

export interface LexiconTerm {
  term: string;
  weight: number;
}

const t = (weight: number, ...terms: string[]): LexiconTerm[] =>
  terms.map((term) => ({ term, weight }));

export const TOPIC_LEXICON: Record<NewsTopic, LexiconTerm[]> = {
  models: [
    ...t(3, "new model", "model release", "launches", "unveils", "introducing", "now available",
      "general availability", "model card", "flagship model", "frontier model", "successor to",
      "deprecating", "deprecation", "sunset", "retiring", "context window", "state of the art"),
    ...t(2, "release", "released", "announce", "announced", "launch", "upgrade", "upgraded",
      "benchmark", "benchmarks", "outperforms", "beats", "tops the", "leaderboard", "elo",
      "parameters", "checkpoint", "distilled", "distillation", "mixture of experts", "moe"),
    ...t(1, "version", "preview", "beta", "rollout", "available to"),
  ],
  pricing: [
    ...t(3, "price cut", "price drop", "pricing", "per million tokens", "per 1m tokens",
      "cheaper", "price increase", "free tier", "cost per token", "token price", "billing"),
    ...t(2, "cheaper than", "cost", "costs", "affordable", "rate limit", "rate limits", "quota",
      "subscription", "credits", "usage tier", "discount", "batch api"),
    ...t(1, "price", "plan", "tier", "spend"),
  ],
  agents: [
    ...t(3, "ai agent", "ai agents", "agentic", "agent framework", "tool use", "tool calling",
      "function calling", "computer use", "browser use", "autonomous agent", "multi-agent",
      "mcp", "model context protocol", "agent sdk", "swe-bench", "coding agent"),
    ...t(2, "agents", "orchestration", "workflow automation", "planner", "scaffolding",
      "long-horizon", "autonomy", "task completion", "react loop"),
    ...t(1, "assistant", "copilot", "automation"),
  ],
  "open-source": [
    ...t(3, "open source", "open-source", "open weights", "open-weight", "apache 2.0",
      "mit license", "permissive license", "weights released", "available on hugging face",
      "open model", "openly available"),
    ...t(2, "github", "hugging face", "repository", "community", "fork", "self-host",
      "self-hosted", "local inference", "ollama", "llama.cpp", "gguf", "vllm"),
    ...t(1, "license", "licence", "download the weights"),
  ],
  research: [
    ...t(3, "arxiv", "preprint", "paper", "we introduce", "we present", "neurips",
      "icml", "iclr", "acl", "ablation", "novel architecture", "empirical", "scaling law",
      "scaling laws", "interpretability", "mechanistic"),
    ...t(2, "study", "researchers", "findings", "experiment", "experiments", "results show",
      "evaluation", "dataset", "benchmark suite", "reinforcement learning", "fine-tuning",
      "pretraining", "post-training", "distillation"),
    ...t(1, "analysis", "method", "approach", "technique"),
  ],
  safety: [
    ...t(3, "ai safety", "alignment", "misalignment", "red team", "red-teaming", "jailbreak",
      "jailbreaking", "guardrail", "guardrails", "safety evaluation", "responsible ai",
      "model welfare", "existential risk", "catastrophic risk", "constitutional ai",
      "prompt injection", "safety card", "preparedness framework"),
    ...t(2, "harmful", "misuse", "bias", "toxicity", "hallucination", "hallucinations",
      "deception", "sycophancy", "watermark", "provenance", "content credentials",
      "child safety", "csam", "deepfake", "deepfakes"),
    ...t(1, "risk", "risks", "abuse", "trust and safety"),
  ],
  tools: [
    ...t(3, "sdk", "api update", "developer tools", "ide", "vs code", "extension",
      "cli", "notebook", "playground", "eval harness", "observability", "tracing",
      "prompt engineering", "fine-tuning api", "embeddings api"),
    ...t(2, "integration", "plugin", "library", "framework", "langchain", "llamaindex",
      "typescript", "python package", "developer experience", "documentation", "debugging"),
    ...t(1, "tool", "toolkit", "workflow"),
  ],
  infrastructure: [
    ...t(3, "data center", "data centre", "gpu cluster", "tpu", "h100", "h200", "b200",
      "blackwell", "gb200", "inference stack", "serving", "throughput", "tokens per second",
      "kv cache", "quantization", "quantisation", "supercomputer", "compute cluster",
      "nvlink", "interconnect", "cuda"),
    ...t(2, "gpu", "gpus", "chip", "chips", "silicon", "accelerator", "latency",
      "capacity", "megawatt", "gigawatt", "power", "cooling", "cloud region", "on-prem",
      "wafer", "foundry", "tsmc"),
    ...t(1, "hardware", "infrastructure", "scaling up", "deployment"),
  ],
  policy: [
    ...t(3, "eu ai act", "ai act", "regulation", "regulator", "regulators", "legislation",
      "executive order", "lawsuit", "sued", "copyright claim", "antitrust", "ftc", "doj",
      "export controls", "sanctions", "compliance", "policy framework",
      "safety institute", "government"),
    ...t(2, "court", "judge", "ruling", "settlement", "privacy", "gdpr", "consent decree",
      "licensing deal", "publisher deal", "ban", "banned", "restrictions", "moratorium",
      "standards body", "oversight"),
    ...t(1, "policy", "law", "legal", "rules"),
  ],
  funding: [
    ...t(3, "series a", "series b", "series c", "series d", "series e", "seed round",
      "raises", "raised", "funding round", "valuation", "acquires", "acquisition",
      "acquired by", "ipo", "merger", "investment round", "led the round"),
    ...t(2, "investors", "venture", "vc", "billion valuation", "million round", "stake",
      "partnership deal", "revenue", "arr", "profit", "losses", "burn rate", "layoffs"),
    ...t(1, "funding", "capital", "deal", "invests"),
  ],
  multimodal: [
    ...t(3, "multimodal", "multi-modal", "text-to-image", "text-to-video", "text-to-speech",
      "image generation", "video generation", "speech recognition", "voice mode",
      "vision language", "vision-language", "vlm", "image understanding", "audio model",
      "diffusion model", "world model"),
    ...t(2, "vision", "image", "images", "video", "audio", "speech", "voice", "tts", "asr",
      "ocr", "sora", "midjourney", "stable diffusion", "flux", "avatar", "3d generation"),
    ...t(1, "visual", "picture", "render"),
  ],
};

/**
 * The AI-relevance gate.
 *
 * Feeds marked `requiresAiFilter` are general technology channels — The Verge's
 * AI section still surfaces the occasional phone review, and a personal blog
 * mixes AI posts with everything else. An item from those sources must hit at
 * least one of these terms or it never enters the corpus.
 *
 * First-party lab feeds and arXiv AI categories skip this gate entirely: every
 * item they publish is on-topic by construction, and a keyword list would only
 * create false negatives on genuinely novel terminology.
 */
export const AI_RELEVANCE_TERMS: readonly string[] = [
  "ai", "a.i.", "artificial intelligence", "machine learning", "deep learning",
  "neural network", "neural networks", "llm", "llms", "large language model",
  "large language models", "foundation model", "foundation models", "generative ai",
  "genai", "transformer", "transformers", "chatbot", "chatbots", "gpt", "chatgpt",
  "claude", "gemini", "llama", "mistral", "deepseek", "qwen", "grok", "copilot",
  "openai", "anthropic", "deepmind", "hugging face", "stability ai", "midjourney",
  "perplexity", "cohere", "nvidia", "inference", "fine-tune", "fine-tuning",
  "prompt", "prompting", "embedding", "embeddings", "rag", "retrieval augmented",
  "agentic", "ai agent", "ai agents", "diffusion model", "multimodal", "open weights",
  "model weights", "training run", "gpu cluster", "superintelligence", "agi",
];
