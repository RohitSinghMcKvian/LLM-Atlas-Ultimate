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
];

export const BENCHMARK_MAP: Record<string, BenchmarkDef> = Object.fromEntries(
  BENCHMARKS.map((b) => [b.key, b]),
);

export function benchmarkLabel(key: string): string {
  return BENCHMARK_MAP[key]?.label ?? key;
}
