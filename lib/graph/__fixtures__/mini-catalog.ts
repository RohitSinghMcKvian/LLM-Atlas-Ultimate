import { makeModel } from "@/lib/catalog/__fixtures__/snapshots";
import { BENCHMARKS } from "@/lib/catalog/benchmarks";
import { PROVIDER_LIST } from "@/lib/catalog/providers";
import type { CatalogModel } from "@/lib/catalog/types";
import { buildCatalogGraph } from "../build-catalog";
import { indexGraph, type AtlasGraph } from "../types";

/**
 * A small catalog with known right answers.
 *
 * Deliberately not the shipped snapshot: the point of the relational fixture is
 * to assert *which* nodes a question must reach, and that is only checkable
 * against a catalog whose facts are fixed here rather than resynced nightly.
 * Shapes and value ranges mirror the real thing - three brands, two families
 * each, open and proprietary licences, all three price bands, and benchmark
 * scores that produce an unambiguous ordering.
 */

function score(key: string, value: number) {
  return {
    key,
    score: value,
    source: "Fixture card",
    sourceUrl: "https://example.com/card",
    measuredAt: "2026-03-01",
  };
}

export const MINI_MODELS: CatalogModel[] = [
  makeModel({
    id: "meridian-70b",
    name: "Meridian 70B",
    provider: "Cartograph",
    family: "Meridian",
    license: "open",
    contextWindow: 131_072,
    pricing: { inputPerM: 0.35, outputPerM: 0.7, effectiveFrom: "2026-01-01" },
    capabilities: { toolUse: true, structuredOutput: true, reasoning: false, caching: false },
    benchmarks: [score("mmlu", 84.1), score("humaneval", 76.2)],
    routes: [{ provider: "openrouter", model: "cartograph/meridian-70b" }],
    tags: ["general"],
  }),
  makeModel({
    id: "meridian-8b",
    name: "Meridian 8B",
    provider: "Cartograph",
    family: "Meridian",
    license: "open",
    contextWindow: 131_072,
    pricing: { inputPerM: 0.05, outputPerM: 0.08, effectiveFrom: "2026-01-01" },
    capabilities: { toolUse: true, structuredOutput: false, reasoning: false, caching: false },
    benchmarks: [score("mmlu", 68.4), score("humaneval", 55.0)],
    routes: [{ provider: "groq", model: "cartograph/meridian-8b" }],
    tags: ["general", "fast"],
  }),
  makeModel({
    id: "summit-pro",
    name: "Summit Pro",
    provider: "Alpine",
    family: "Summit",
    license: "proprietary",
    contextWindow: 200_000,
    pricing: { inputPerM: 15, outputPerM: 75, effectiveFrom: "2026-01-01" },
    capabilities: { toolUse: true, structuredOutput: true, reasoning: true, caching: true },
    modalities: ["text", "vision"],
    benchmarks: [score("mmlu", 91.3), score("gpqa", 72.5), score("humaneval", 92.0)],
    routes: [{ provider: "openrouter", model: "alpine/summit-pro" }],
    tags: ["frontier"],
  }),
  makeModel({
    id: "summit-mini",
    name: "Summit Mini",
    provider: "Alpine",
    family: "Summit",
    license: "proprietary",
    contextWindow: 200_000,
    pricing: { inputPerM: 0.8, outputPerM: 4, effectiveFrom: "2026-01-01" },
    capabilities: { toolUse: true, structuredOutput: true, reasoning: false, caching: true },
    benchmarks: [score("mmlu", 79.0), score("humaneval", 81.4)],
    routes: [{ provider: "openrouter", model: "alpine/summit-mini" }],
    tags: ["fast"],
  }),
  makeModel({
    id: "delta-vision",
    name: "Delta Vision",
    provider: "Riverbed",
    family: "Delta",
    license: "open",
    contextWindow: 32_768,
    pricing: { inputPerM: 0.2, outputPerM: 0.4, effectiveFrom: "2026-01-01" },
    modalities: ["text", "vision"],
    outputModalities: ["text", "image"],
    capabilities: { toolUse: false, structuredOutput: false, reasoning: false, caching: false },
    benchmarks: [score("mmlu", 61.2)],
    routes: [{ provider: "nvidia", model: "riverbed/delta-vision" }],
    tags: ["multimodal"],
  }),
  makeModel({
    id: "delta-reason",
    name: "Delta Reason",
    provider: "Riverbed",
    family: "Delta",
    license: "open",
    contextWindow: 65_536,
    pricing: { inputPerM: 2.5, outputPerM: 10, effectiveFrom: "2026-01-01" },
    capabilities: { toolUse: true, structuredOutput: true, reasoning: true, caching: false },
    benchmarks: [score("mmlu", 86.7), score("gpqa", 68.1)],
    routes: [
      { provider: "nvidia", model: "riverbed/delta-reason" },
      { provider: "openrouter", model: "riverbed/delta-reason" },
    ],
    tags: ["reasoning"],
  }),
];

export function miniGraph(): AtlasGraph {
  return indexGraph(
    buildCatalogGraph({ models: MINI_MODELS, benchmarks: BENCHMARKS, providers: PROVIDER_LIST }),
  );
}
