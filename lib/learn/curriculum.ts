export interface Lesson {
  id: string;
  title: string;
  minutes: number;
}

export interface Track {
  id: string;
  title: string;
  blurb: string;
  lessons: Lesson[];
}

export const TRACKS: Track[] = [
  {
    id: "foundations",
    title: "Foundations",
    blurb: "Tokens, embeddings, attention, sampling, context windows.",
    lessons: [
      { id: "what-is-a-token", title: "What is a token?", minutes: 6 },
      { id: "embeddings", title: "Embeddings & vector space", minutes: 8 },
      { id: "attention", title: "Attention, intuitively", minutes: 10 },
      { id: "sampling", title: "Sampling: temperature & top-p", minutes: 7 },
      { id: "context-windows", title: "Context windows", minutes: 6 },
    ],
  },
  {
    id: "prompting",
    title: "Prompting",
    blurb: "Zero/few-shot, structured outputs, system design, evals.",
    lessons: [
      { id: "zero-few-shot", title: "Zero- & few-shot", minutes: 8 },
      { id: "structured-outputs", title: "Structured outputs", minutes: 9 },
      { id: "system-prompts", title: "Designing system prompts", minutes: 7 },
    ],
  },
  {
    id: "retrieval",
    title: "Retrieval & Memory",
    blurb: "Embeddings, vector search, RAG, chunking, re-ranking.",
    lessons: [
      { id: "rag-basics", title: "RAG patterns", minutes: 10 },
      { id: "chunking", title: "Chunking & re-ranking", minutes: 8 },
    ],
  },
  {
    id: "tools",
    title: "Tool Use & Function Calling",
    blurb: "Schemas, tool routing, MCP, structured tool results.",
    lessons: [
      { id: "function-calling", title: "Function calling", minutes: 9 },
      { id: "mcp", title: "MCP, end to end", minutes: 11 },
    ],
  },
  {
    id: "agents",
    title: "Agents",
    blurb: "The agent loop, planning, reflection, sub-agents.",
    lessons: [
      { id: "agent-loop", title: "The agent loop", minutes: 10 },
      { id: "sub-agents", title: "Sub-agents & orchestration", minutes: 12 },
    ],
  },
  {
    id: "context-engineering",
    title: "Context Engineering",
    blurb: "Compaction, long-context strategies, memory pipelines.",
    lessons: [{ id: "compaction", title: "Context compaction", minutes: 11 }],
  },
  {
    id: "eval-safety",
    title: "Evaluation & Safety",
    blurb: "Benchmarks, evals, red-teaming, guardrails.",
    lessons: [{ id: "evals", title: "Writing good evals", minutes: 9 }],
  },
  {
    id: "production",
    title: "Production",
    blurb: "Cost, latency, routing, observability, deployment.",
    lessons: [{ id: "routing", title: "Cost-aware routing", minutes: 8 }],
  },
  {
    id: "capstone",
    title: "Capstone",
    blurb: "Build & deploy a real agent in Atlas Code.",
    lessons: [{ id: "capstone", title: "Ship a multi-agent system", minutes: 40 }],
  },
];

export const TOTAL_LESSONS = TRACKS.reduce((n, t) => n + t.lessons.length, 0);

export type Block =
  | { type: "p"; text: string }
  | { type: "h"; text: string }
  | { type: "callout"; title: string; text: string }
  | { type: "code"; lang: string; code: string }
  | { type: "live"; prompt: string; note: string }
  | {
      type: "quiz";
      question: string;
      options: string[];
      answer: number;
      explain: string;
    };

/** The fully-authored active lesson. */
export const ACTIVE_LESSON = {
  trackId: "foundations",
  lessonId: "what-is-a-token",
  title: "What is a token?",
  minutes: 6,
  blocks: [
    {
      type: "p",
      text: "Language models don't read characters or words directly — they read **tokens**. A token is a chunk of text, often a word-piece, that the model treats as a single unit. Understanding tokens is the key to understanding cost, context limits, and latency.",
    },
    {
      type: "h",
      text: "Why tokens, not words?",
    },
    {
      type: "p",
      text: "Tokenizers split text into common sub-word pieces so the model can represent any string — including code, emoji, and rare words — with a fixed vocabulary. Common words are usually one token; rarer words split into several. As a rough rule of thumb, **1 token ≈ 4 characters ≈ ¾ of a word** in English.",
    },
    {
      type: "code",
      lang: "text",
      code: `"tokenization" → ["token", "ization"]   (2 tokens)
"Atlas"        → ["Atlas"]                (1 token)
"🛰️"           → ["�", "�", ...]           (several tokens)`,
    },
    {
      type: "callout",
      title: "Why it matters",
      text: "Pricing is per token, context windows are measured in tokens, and output speed is tokens/sec. Every number in Atlas Cost and the Leaderboard is grounded in tokens.",
    },
    {
      type: "live",
      prompt:
        "Break the sentence 'Atlas maps the LLM universe' into likely tokens, and estimate the total token count. Explain your reasoning briefly.",
      note: "Runs live on your selected model via Atlas Router.",
    },
    {
      type: "h",
      text: "Check your understanding",
    },
    {
      type: "quiz",
      question: "Roughly how many tokens is 1,000 English words?",
      options: ["~250 tokens", "~750 tokens", "~1,300 tokens", "~4,000 tokens"],
      answer: 2,
      explain:
        "About 1 token ≈ ¾ word, so 1,000 words ≈ 1,300 tokens. The exact number depends on the tokenizer.",
    },
  ] as Block[],
};
