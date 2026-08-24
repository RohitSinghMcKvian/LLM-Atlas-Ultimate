import { describe, expect, it } from "vitest";
import { makeModel } from "@/lib/catalog/__fixtures__/snapshots";
import { BENCHMARKS } from "@/lib/catalog/benchmarks";
import { PROVIDER_LIST } from "@/lib/catalog/providers";
import { allModels } from "@/lib/catalog";
import { buildCatalogGraph, blendedRate, priceBandFor } from "./build-catalog";
import { indexGraph, nodeId } from "./types";
import { neighbors, other } from "./query";

const providers = PROVIDER_LIST;

describe("price bands", () => {
  it("weights input 3:1 against output, matching blendedPrice()", () => {
    expect(blendedRate({ inputPerM: 4, outputPerM: 8, effectiveFrom: "" })).toBe(5);
  });

  it("buckets at the documented thresholds", () => {
    expect(priceBandFor({ inputPerM: 0.1, outputPerM: 0.2, effectiveFrom: "" }).id).toBe("budget");
    expect(priceBandFor({ inputPerM: 3, outputPerM: 9, effectiveFrom: "" }).id).toBe("mid-priced");
    expect(priceBandFor({ inputPerM: 30, outputPerM: 60, effectiveFrom: "" }).id).toBe("premium");
  });

  it("a free model is budget, not a separate hole", () => {
    expect(priceBandFor({ inputPerM: 0, outputPerM: 0, effectiveFrom: "" }).id).toBe("budget");
  });
});

describe("buildCatalogGraph", () => {
  const models = [
    makeModel({
      id: "acme-large",
      name: "Acme Large",
      provider: "Acme",
      family: "Acme 2",
      license: "open",
      pricing: { inputPerM: 0.3, outputPerM: 0.6, effectiveFrom: "2026-01-01" },
      capabilities: { toolUse: true, structuredOutput: true, reasoning: false, caching: false },
      modalities: ["text", "vision"],
      outputModalities: ["text", "image"],
      tags: ["flagship"],
      benchmarks: [
        {
          key: "mmlu",
          score: 88.2,
          source: "Acme card",
          sourceUrl: "https://example.com",
          measuredAt: "2026-02-01",
        },
      ],
      routes: [
        { provider: "openrouter", model: "acme/large" },
        { provider: "groq", model: "acme-large" },
      ],
    }),
    makeModel({
      id: "acme-small",
      name: "Acme Small",
      provider: "Acme",
      family: "Acme 2",
      pricing: { inputPerM: 0.05, outputPerM: 0.1, effectiveFrom: "2026-01-01" },
      benchmarks: [
        {
          key: "mmlu",
          score: 71,
          source: "Acme card",
          sourceUrl: "https://example.com",
          measuredAt: "2026-02-01",
        },
      ],
    }),
  ];

  const g = indexGraph(buildCatalogGraph({ models, benchmarks: BENCHMARKS, providers }));

  it("mints one brand node for two models of the same brand", () => {
    const brand = g.nodes.get(nodeId("brand", "Acme"));
    expect(brand).toBeDefined();
    expect(g.in.get(brand!.id)!.filter((e) => e.kind === "made_by")).toHaveLength(3); // 2 models + 1 family
  });

  it("links a model to every route provider", () => {
    const routes = neighbors(g, nodeId("model", "acme-large"), {
      kinds: ["routed_via"],
      direction: "out",
    });
    expect(routes.map((e) => e.to).sort()).toEqual([
      nodeId("provider", "groq"),
      nodeId("provider", "openrouter"),
    ]);
    expect(routes[0].props?.providerModel).toBeDefined();
  });

  it("carries the score on the benchmark edge, not just in prose", () => {
    const [edge] = neighbors(g, nodeId("model", "acme-large"), {
      kinds: ["scored_on"],
      direction: "out",
    });
    expect(edge.to).toBe(nodeId("benchmark", "mmlu"));
    expect(edge.props).toMatchObject({ score: 88.2, source: "Acme card", measuredAt: "2026-02-01" });
  });

  it("makes 'which models are scored on MMLU' one hop", () => {
    const scored = neighbors(g, nodeId("benchmark", "mmlu"), {
      kinds: ["scored_on"],
      direction: "in",
    }).map((e) => other(e, nodeId("benchmark", "mmlu")));
    expect(scored.sort()).toEqual([nodeId("model", "acme-large"), nodeId("model", "acme-small")]);
  });

  it("separates input modalities from output modalities", () => {
    const accepts = neighbors(g, nodeId("model", "acme-large"), { kinds: ["accepts"], direction: "out" });
    const emits = neighbors(g, nodeId("model", "acme-large"), { kinds: ["emits"], direction: "out" });
    expect(accepts.map((e) => e.to)).toContain(nodeId("modality", "vision"));
    expect(emits.map((e) => e.to)).toContain(nodeId("modality", "out-image"));
    // A model that takes images must not read as one that makes them.
    expect(accepts.map((e) => e.to)).not.toContain(nodeId("modality", "out-image"));
  });

  it("weights a tag far below a benchmark, so hubs do not dominate", () => {
    const tag = neighbors(g, nodeId("model", "acme-large"), { kinds: ["tagged"], direction: "out" });
    const bench = neighbors(g, nodeId("model", "acme-large"), { kinds: ["scored_on"], direction: "out" });
    expect(Math.max(...tag.map((e) => e.weight))).toBeLessThan(bench[0].weight / 2);
  });

  it("puts aliases in the embeddable text so a question can land on any of them", () => {
    const n = g.nodes.get(nodeId("model", "acme-large"))!;
    for (const alias of ["Acme Large", "acme-large", "Acme", "open"]) {
      expect(n.text).toContain(alias);
    }
  });

  it("summaries stand alone — the model may cite one without the subgraph", () => {
    const n = g.nodes.get(nodeId("model", "acme-large"))!;
    expect(n.summary).toContain("Acme Large");
    expect(n.summary).toContain("Acme");
    expect(n.summary).toMatch(/\$0\.3\/M in/);
  });

  it("builds the real shipped catalog without a dangling edge", () => {
    const real = buildCatalogGraph({ models: allModels(), benchmarks: BENCHMARKS, providers });
    const ids = new Set(real.nodes.map((n) => n.id));
    const dangling = real.edges.filter((e) => !ids.has(e.from) || !ids.has(e.to));
    expect(dangling).toEqual([]);
    expect(real.nodes.length).toBeGreaterThan(50);
  });

  it("is deterministic — the same snapshot builds the identical graph", () => {
    const a = buildCatalogGraph({ models, benchmarks: BENCHMARKS, providers });
    const b = buildCatalogGraph({ models, benchmarks: BENCHMARKS, providers });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
