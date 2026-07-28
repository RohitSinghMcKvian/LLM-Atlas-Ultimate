import type { BenchmarkDef } from "./types";

/**
 * Benchmark definitions. Atlas treats these as aggregated public signals;
 * every score on a model carries its own source + measured date (transparency
 * over authority — see Project Documentation §9.3).
 */
export const BENCHMARKS: BenchmarkDef[] = [
  {
    key: "mmlu",
    label: "MMLU",
    about: "Broad multitask knowledge across 57 subjects.",
    category: "knowledge",
    unit: "%",
    higherBetter: true,
    max: 100,
  },
  {
    key: "gpqa",
    label: "GPQA Diamond",
    about: "Graduate-level science questions resistant to web search.",
    category: "reasoning",
    unit: "%",
    higherBetter: true,
    max: 100,
  },
  {
    key: "humaneval",
    label: "HumanEval",
    about: "Functional correctness of generated Python code.",
    category: "coding",
    unit: "%",
    higherBetter: true,
    max: 100,
  },
  {
    key: "swebench",
    label: "SWE-bench Verified",
    about: "Resolving real GitHub issues in large codebases.",
    category: "agentic",
    unit: "%",
    higherBetter: true,
    max: 100,
  },
  {
    key: "math",
    label: "MATH",
    about: "Competition-level mathematics problem solving.",
    category: "math",
    unit: "%",
    higherBetter: true,
    max: 100,
  },
  {
    key: "aime",
    label: "AIME 2024",
    about: "Hard olympiad math — a strong reasoning signal.",
    category: "math",
    unit: "%",
    higherBetter: true,
    max: 100,
  },
  {
    key: "mmmu",
    label: "MMMU",
    about: "Multimodal college-level understanding (vision).",
    category: "vision",
    unit: "%",
    higherBetter: true,
    max: 100,
  },
  {
    key: "arena",
    label: "Arena Elo",
    about: "Human-preference Elo from blind pairwise battles.",
    category: "overall",
    unit: "elo",
    higherBetter: true,
    max: 1500,
  },

  // --- Synced from the provider catalog -----------------------------------
  //
  // OpenRouter publishes Artificial Analysis' composite indices alongside its
  // model list, which is the only benchmark signal either provider exposes. It
  // covers roughly half the synced catalog and is what stops newly-added models
  // from ranking at zero on the leaderboard.
  //
  // `design-arena` is deliberately separate from `arena` above: Design Arena Elo
  // and LMSYS Arena Elo are different populations on different scales, so folding
  // them into one column would corrupt both it and the intelligence-index
  // fallback that reads it.
  {
    key: "aa-intelligence",
    label: "AA Intelligence",
    about: "Artificial Analysis composite intelligence index across its eval suite.",
    category: "overall",
    unit: "%",
    higherBetter: true,
    max: 100,
  },
  {
    key: "aa-coding",
    label: "AA Coding",
    about: "Artificial Analysis composite coding index.",
    category: "coding",
    unit: "%",
    higherBetter: true,
    max: 100,
  },
  {
    key: "aa-agentic",
    label: "AA Agentic",
    about: "Artificial Analysis composite agentic / tool-use index.",
    category: "agentic",
    unit: "%",
    higherBetter: true,
    max: 100,
  },
  {
    key: "design-arena",
    label: "Design Arena Elo",
    about: "Human-preference Elo for UI and data-visualization generation.",
    category: "overall",
    unit: "elo",
    higherBetter: true,
    max: 1500,
  },
];

export const BENCHMARK_MAP: Record<string, BenchmarkDef> = Object.fromEntries(
  BENCHMARKS.map((b) => [b.key, b]),
);

export function benchmarkLabel(key: string): string {
  return BENCHMARK_MAP[key]?.label ?? key;
}
