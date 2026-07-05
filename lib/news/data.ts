export type NewsTopic =
  | "models"
  | "pricing"
  | "agents"
  | "open-source"
  | "research"
  | "safety"
  | "tools";

export interface NewsItem {
  id: string;
  title: string;
  /** Neutral, paraphrased 2–3 sentence summary — never verbatim source text. */
  summary: string;
  source: string;
  sourceUrl: string;
  /** Static relative label so render is deterministic (no hydration drift). */
  ago: string;
  topics: NewsTopic[];
  provider?: string;
  /** Related catalog model ids (deep-link to the leaderboard). */
  models?: string[];
  /** Cross-source corroboration count. */
  corroboration?: number;
  /** Distinct "what changed" card. */
  diff?: {
    kind: "new_model" | "price_change" | "deprecation";
    detail: string;
  };
}

export const TOPICS: { id: NewsTopic; label: string }[] = [
  { id: "models", label: "Models" },
  { id: "pricing", label: "Pricing" },
  { id: "agents", label: "Agents" },
  { id: "open-source", label: "Open source" },
  { id: "research", label: "Research" },
  { id: "safety", label: "Safety" },
  { id: "tools", label: "Tools" },
];

export const FOLLOW_PROVIDERS = [
  "Anthropic",
  "OpenAI",
  "Google",
  "Meta",
  "DeepSeek",
  "Mistral",
];

export const NEWS: NewsItem[] = [
  {
    id: "n1",
    title: "DeepSeek R1 lands as an open reasoning model rivaling o1",
    summary:
      "DeepSeek released R1, an open-weight reasoning model with a visible chain-of-thought, reporting o1-class scores on math and coding benchmarks. The weights ship under a permissive license, enabling fully self-hosted reasoning.",
    source: "DeepSeek",
    sourceUrl: "https://deepseek.com",
    ago: "14m",
    topics: ["models", "open-source", "research"],
    provider: "DeepSeek",
    models: ["deepseek-r1"],
    corroboration: 6,
    diff: { kind: "new_model", detail: "deepseek-r1 added to the catalog" },
  },
  {
    id: "n2",
    title: "Gemini 3.1 Pro cuts input pricing again",
    summary:
      "Google adjusted Gemini 3.1 Pro token pricing, lowering input cost and widening its price-performance lead among multimodal models. The change propagates to Atlas Cost estimates automatically.",
    source: "Google DeepMind",
    sourceUrl: "https://deepmind.google",
    ago: "47m",
    topics: ["pricing", "models"],
    provider: "Google",
    models: ["gemini-3-1-pro"],
    corroboration: 4,
    diff: { kind: "price_change", detail: "input −20% on gemini-3-1-pro" },
  },
  {
    id: "n3",
    title: "Anthropic details extended thinking in Claude Opus 4.8",
    summary:
      "Anthropic published guidance on Claude Opus 4.8's hybrid reasoning mode, which lets developers trade latency for deeper deliberation on hard tasks. Agentic coding benchmarks see the largest gains.",
    source: "Anthropic",
    sourceUrl: "https://anthropic.com",
    ago: "1h",
    topics: ["models", "agents", "research"],
    provider: "Anthropic",
    models: ["claude-opus-4-8"],
    corroboration: 5,
  },
  {
    id: "n4",
    title: "MCP adoption accelerates across agent frameworks",
    summary:
      "Several agent toolkits added native Model Context Protocol support this week, standardizing how tools and data sources are exposed to models. The trend reduces per-provider integration glue.",
    source: "Community roundup",
    sourceUrl: "https://modelcontextprotocol.io",
    ago: "2h",
    topics: ["agents", "tools", "open-source"],
    corroboration: 3,
  },
  {
    id: "n5",
    title: "Qwen 2.5 Coder 32B tops open coding evals for its size",
    summary:
      "Alibaba's Qwen 2.5 Coder 32B posted leading HumanEval results among similarly-sized open models, narrowing the gap to far larger systems on code generation.",
    source: "Artificial Analysis",
    sourceUrl: "https://artificialanalysis.ai",
    ago: "3h",
    topics: ["models", "open-source"],
    provider: "Alibaba",
    models: ["qwen-2-5-coder-32b"],
    corroboration: 4,
  },
  {
    id: "n6",
    title: "o4-mini brings cheaper reasoning to production",
    summary:
      "OpenAI's o4-mini offers reasoning performance close to o3 at a fraction of the cost, shifting the cost-vs-capability frontier for STEM-heavy workloads.",
    source: "OpenAI",
    sourceUrl: "https://openai.com",
    ago: "5h",
    topics: ["models", "pricing", "research"],
    provider: "OpenAI",
    models: ["o4-mini"],
    corroboration: 5,
  },
  {
    id: "n7",
    title: "Gemini 1.0 Pro scheduled for deprecation",
    summary:
      "Google announced a sunset timeline for Gemini 1.0 Pro, encouraging migration to the 1.5 and 2.0 families. Atlas flags affected catalog entries on the Upcoming board.",
    source: "Google",
    sourceUrl: "https://ai.google.dev",
    ago: "6h",
    topics: ["models", "pricing"],
    provider: "Google",
    corroboration: 3,
    diff: { kind: "deprecation", detail: "gemini-1.0-pro deprecation announced" },
  },
  {
    id: "n8",
    title: "Llama 3.3 70B narrows the gap to 405B",
    summary:
      "Meta's Llama 3.3 70B delivers quality approaching the 405B model at a fraction of the serving cost, making affordable open self-hosting more attractive for production.",
    source: "Meta",
    sourceUrl: "https://ai.meta.com",
    ago: "8h",
    topics: ["models", "open-source"],
    provider: "Meta",
    models: ["llama-3-3-70b"],
    corroboration: 4,
  },
  {
    id: "n9",
    title: "Survey: agentic verification loops reduce hallucinated edits",
    summary:
      "A new study finds that closed-loop verification — running tests and linters before surfacing changes — materially lowers incorrect code edits from autonomous agents.",
    source: "arXiv",
    sourceUrl: "https://arxiv.org",
    ago: "11h",
    topics: ["agents", "research", "safety"],
    corroboration: 2,
  },
  {
    id: "n10",
    title: "NVIDIA NIM expands open-model catalog",
    summary:
      "NVIDIA added more open models to its NIM API catalog, broadening OpenAI-compatible access to Nemotron and partner weights for self-managed deployments.",
    source: "NVIDIA",
    sourceUrl: "https://build.nvidia.com",
    ago: "14h",
    topics: ["models", "tools", "open-source"],
    provider: "NVIDIA",
    models: ["nemotron-70b"],
    corroboration: 3,
  },
  {
    id: "n11",
    title: "Prompt-injection defenses move toward content isolation",
    summary:
      "Practitioners increasingly treat retrieved tool and web content as data, not instructions, surfacing side-effecting actions for confirmation rather than auto-executing them.",
    source: "Security roundup",
    sourceUrl: "https://owasp.org",
    ago: "1d",
    topics: ["safety", "agents"],
    corroboration: 2,
  },
  {
    id: "n12",
    title: "Mistral Large 2 gains traction for multilingual workloads",
    summary:
      "Mistral Large 2 is seeing increased adoption for European-language and code tasks, with competitive quality and predictable pricing for enterprise deployments.",
    source: "Vellum",
    sourceUrl: "https://www.vellum.ai/llm-leaderboard",
    ago: "1d",
    topics: ["models"],
    provider: "Mistral",
    models: ["mistral-large-2"],
    corroboration: 2,
  },
];
