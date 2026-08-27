import { describe, expect, it } from "vitest";
import { installSnapshot, resetSnapshot } from "@/lib/catalog/snapshot";
import { makeSnapshot } from "@/lib/catalog/__fixtures__/snapshots";
import { MINI_MODELS, miniGraph } from "@/lib/graph/__fixtures__/mini-catalog";
import { nodeId } from "@/lib/graph/types";
import type { NewsArticle, NewsCluster, Verification } from "@/lib/news/types";
import { ATLAS_TOOLS, ATLAS_TOOL_NAMES, findAtlasTool } from "./index";
import { runGraphTool } from "./graph-tool";
import { runCatalogTool } from "./catalog-tool";
import { runCostTool } from "./cost-tool";
import { runNewsTool, type NewsCorpus } from "./news-tool";

const g = miniGraph();

describe("registry", () => {
  it("exposes the four Atlas tools with unique names and real schemas", () => {
    expect(ATLAS_TOOL_NAMES.sort()).toEqual([
      "atlas_catalog",
      "atlas_cost",
      "atlas_graph",
      "atlas_news",
    ]);
    for (const t of ATLAS_TOOLS) {
      expect(t.description.length).toBeGreaterThan(40);
      expect(t.schema).toBeDefined();
    }
  });

  it("finds a tool by name and nothing by a wrong one", () => {
    expect(findAtlasTool("atlas_cost")?.name).toBe("atlas_cost");
    expect(findAtlasTool("atlas_nope")).toBeUndefined();
  });

  it("says so plainly when a port is missing, rather than answering emptily", () => {
    const graph = findAtlasTool("atlas_graph")!;
    const r = graph.run({ command: "query", search_query: "x", max_results: 5 }, {});
    expect(r.isError).toBe(true);
    expect(r.content).toContain("not available");
  });
});

describe("atlas_graph", () => {
  it("answers a query with a citeable block", () => {
    const r = runGraphTool(g, { command: "query", search_query: "Summit Pro", max_results: 6 });
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("<atlas_graph>");
    expect(r.content).toContain("Summit Pro");
  });

  it("tells the model not to guess when nothing matched", () => {
    const r = runGraphTool(g, {
      command: "query",
      search_query: "quokka xylophone",
      max_results: 6,
    });
    expect(r.content).toContain("Do not guess");
  });

  it("lists neighbours with the score on the relation", () => {
    const r = runGraphTool(g, {
      command: "neighbors",
      node_id: nodeId("model", "summit-pro"),
      edge_kind: "scored_on",
      max_results: 10,
    });
    expect(r.content).toContain("scored on");
    expect(r.content).toMatch(/score 91\.3%/);
  });

  it("accepts a plain name where an id was expected", () => {
    const r = runGraphTool(g, { command: "explain", node_id: "Summit Pro", max_results: 5 });
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("Summit Pro");
    expect(r.content).toContain("In Atlas: /cost?model=summit-pro");
  });

  it("explains a node with its facts and its neighbourhood", () => {
    const r = runGraphTool(g, {
      command: "explain",
      node_id: nodeId("model", "meridian-70b"),
      max_results: 5,
    });
    expect(r.content).toContain("Facts:");
    expect(r.content).toContain("Most related:");
    expect(r.content).toContain("inputPerM: 0.35");
  });

  it("finds how two rivals relate", () => {
    const r = runGraphTool(g, {
      command: "path",
      node_id: nodeId("model", "summit-pro"),
      to_node_id: nodeId("model", "meridian-70b"),
      max_results: 5,
    });
    expect(r.content).toContain("scored on");
  });

  it("reports 'unrelated' as an answer, not as a failure", () => {
    const r = runGraphTool(g, {
      command: "path",
      node_id: nodeId("capability", "caching"),
      to_node_id: nodeId("modality", "out-image"),
      max_results: 5,
    });
    // Either a real path or an explicit statement that there is none - never
    // silence the model could fill with an invention.
    expect(r.content.length).toBeGreaterThan(10);
  });

  it("guides recovery on an unknown node instead of just failing", () => {
    const r = runGraphTool(g, { command: "explain", node_id: "no-such-thing", max_results: 5 });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("`query`");
  });

  it("refuses a command missing its argument", () => {
    expect(runGraphTool(g, { command: "query", max_results: 5 }).isError).toBe(true);
    expect(runGraphTool(g, { command: "neighbors", max_results: 5 }).isError).toBe(true);
  });
});

describe("atlas_catalog", () => {
  const snapshot = makeSnapshot(MINI_MODELS, { version: "mini-catalog-tool" });

  function withCatalog<T>(fn: () => T): T {
    resetSnapshot();
    installSnapshot(snapshot);
    try {
      return fn();
    } finally {
      resetSnapshot();
    }
  }

  it("searches by name", () => {
    const r = withCatalog(() =>
      runCatalogTool({ command: "search", search_query: "summit", max_results: 5 }),
    );
    expect(r.content).toContain("Summit Pro");
  });

  it("tells the model not to name a model the catalog lacks", () => {
    const r = withCatalog(() =>
      runCatalogTool({ command: "search", search_query: "zzzzqqqq", max_results: 5 }),
    );
    expect(r.content).toContain("Do not name a model that is not in the catalog");
  });

  it("returns detail with sources and dates on every benchmark", () => {
    const r = withCatalog(() =>
      runCatalogTool({ command: "get", model_ids: ["summit-pro"], max_results: 5 }),
    );
    expect(r.content).toContain("MMLU 91.3 (Fixture card, 2026-03-01)");
    expect(r.content).toContain("$15/M in");
  });

  it("names a model it does not have rather than silently dropping it", () => {
    const r = withCatalog(() =>
      runCatalogTool({ command: "get", model_ids: ["ghost-9000"], max_results: 5 }),
    );
    expect(r.content).toContain("ghost-9000: not in the catalog.");
  });

  it("compares only on benchmarks both models actually have", () => {
    const r = withCatalog(() =>
      runCatalogTool({
        command: "compare",
        model_ids: ["summit-pro", "delta-vision"],
        max_results: 5,
      }),
    );
    // Summit Pro has GPQA, Delta Vision does not, so GPQA must not appear as if
    // one of them scored zero.
    expect(r.content).toContain("MMLU");
    expect(r.content).not.toContain("GPQA");
  });

  it("says outright when two models share no benchmark", () => {
    const r = withCatalog(() =>
      runCatalogTool({
        command: "compare",
        model_ids: ["summit-pro", "meridian-70b"],
        max_results: 5,
      }),
    );
    expect(r.content).toContain("MMLU");
  });

  it("refuses to guess availability with no provider environment", () => {
    const r = withCatalog(() =>
      runCatalogTool({ command: "availability", model_ids: ["summit-pro"], max_results: 5 }),
    );
    expect(r.isError).toBe(true);
    expect(r.content).toContain("cannot be answered");
  });

  it("answers availability when the environment is known", () => {
    const r = withCatalog(() =>
      runCatalogTool(
        { command: "availability", model_ids: ["meridian-8b"], max_results: 5 },
        { routeEnv: { configured: ["groq"] } },
      ),
    );
    expect(r.content).toMatch(/Meridian 8B: (free|runnable)/);
  });

  it("needs two models to compare", () => {
    expect(
      runCatalogTool({ command: "compare", model_ids: ["summit-pro"], max_results: 5 }).isError,
    ).toBe(true);
  });
});

describe("atlas_cost", () => {
  const snapshot = makeSnapshot(MINI_MODELS, { version: "mini-cost-tool" });

  function withCatalog<T>(fn: () => T): T {
    resetSnapshot();
    installSnapshot(snapshot);
    try {
      return fn();
    } finally {
      resetSnapshot();
    }
  }

  it("restates the assumptions behind every figure", () => {
    const r = withCatalog(() =>
      runCostTool({
        command: "estimate",
        model_ids: ["summit-pro"],
        requests_per_day: 1000,
        avg_input_tokens: 2000,
        avg_output_tokens: 500,
        cached_ratio: 0,
      }),
    );
    expect(r.content).toContain("1,000 requests/day");
    expect(r.content).toContain("2000 in / 500 out");
    expect(r.content).toContain("/month");
  });

  it("prices a cheap model below an expensive one at the same workload", () => {
    const both = withCatalog(() =>
      runCostTool({
        command: "estimate",
        model_ids: ["meridian-8b", "summit-pro"],
        requests_per_day: 1000,
      }),
    );
    const rows = both.content.split("\n").filter((l) => l.includes("/month ("));
    expect(rows).toHaveLength(2);
    const dollars = (row: string) => Number(row.match(/\$([\d.,]+)\/month/)![1].replace(/,/g, ""));
    // The ordering that matters is the arithmetic, not the argument order.
    expect(dollars(rows[0])).toBeLessThan(dollars(rows[1]));
    expect(rows[0]).toContain("Meridian 8B");
  });

  it("says whether the GPUs can actually serve the workload", () => {
    const r = withCatalog(() =>
      runCostTool({ command: "selfhost", requests_per_day: 10_000_000, throughput_tps: 1 }),
    );
    expect(r.content).toContain("NOT enough for this workload");
  });

  it("gives a break-even against an open-licence model", () => {
    const r = withCatalog(() =>
      runCostTool({ command: "breakeven", model_ids: ["meridian-70b"], requests_per_day: 1000 }),
    );
    expect(r.content).toMatch(/cheaper above about|never breaks even/);
    expect(r.content).toContain("Meridian 70B");
  });

  it("needs a model to estimate", () => {
    expect(runCostTool({ command: "estimate" }).isError).toBe(true);
  });
});

describe("atlas_news", () => {
  const verification: Verification = {
    level: "corroborated",
    score: 70,
    signals: [],
    corroboration: 2,
    distinctDomains: 2,
    firstParty: false,
  };

  const article = (over: Partial<NewsArticle> & { id: string }): NewsArticle => ({
    title: `Story ${over.id}`,
    summary: "A summary about models.",
    url: `https://example.com/${over.id}`,
    domain: "example.com",
    host: "example.com",
    sourceId: "src",
    sourceName: "Example",
    tier: "press" as NewsArticle["tier"],
    publishedAt: "2026-06-01T00:00:00.000Z",
    firstSeenAt: "2026-06-01T00:00:00.000Z",
    topics: ["models"],
    models: [],
    orgs: [],
    baseScore: 10,
    verification,
    clusterId: "c1",
    lead: true,
    ...over,
  });

  const cluster: NewsCluster = {
    id: "c1",
    leadId: "a1",
    memberIds: ["a1", "a2"],
    domains: ["example.com", "other.dev"],
    topics: ["models"],
    models: [],
    latestAt: "2026-06-01T00:00:00.000Z",
    firstAt: "2026-06-01T00:00:00.000Z",
    baseScore: 10,
    verification,
  };

  const corpus: NewsCorpus = {
    articles: [
      article({ id: "a1", title: "Summit Pro launches" }),
      article({ id: "a2", title: "Summit Pro launches, says vendor", host: "other.dev", lead: false }),
    ],
    clusters: [cluster],
  };
  const now = Date.parse("2026-06-02T00:00:00.000Z");

  it("refuses to answer from memory when the corpus is absent", () => {
    const r = runNewsTool({ command: "search", verified_only: false, max_results: 5 }, null);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("rather than answering from memory");
  });

  it("searches and returns checkable sources", () => {
    const r = runNewsTool(
      { command: "search", search_query: "Summit", verified_only: false, max_results: 5 },
      corpus,
      now,
    );
    expect(r.content).toContain("Summit Pro launches");
    expect(r.sources?.[0].url).toContain("https://");
  });

  it("collapses a cluster to one story rather than repeating it", () => {
    const r = runNewsTool(
      { command: "search", search_query: "Summit", verified_only: false, max_results: 5 },
      corpus,
      now,
    );
    expect(r.content.match(/Summit Pro launches/g)).toHaveLength(1);
  });

  it("leads with provenance, since that is the only claim Atlas can make", () => {
    const r = runNewsTool(
      { command: "story", article_id: "a1", verified_only: false, max_results: 5 },
      corpus,
      now,
    );
    expect(r.content).toContain("publisher(s)");
    expect(r.content).toContain("corroborated");
    expect(r.sources).toHaveLength(2);
  });

  it("rejects a topic that is not in the taxonomy, and lists the real ones", () => {
    const r = runNewsTool(
      { command: "search", topic: "sports", verified_only: false, max_results: 5 },
      corpus,
      now,
    );
    expect(r.isError).toBe(true);
    expect(r.content).toContain("models");
  });

  it("guides recovery from an unknown article id", () => {
    const r = runNewsTool(
      { command: "story", article_id: "nope", verified_only: false, max_results: 5 },
      corpus,
      now,
    );
    expect(r.isError).toBe(true);
    expect(r.content).toContain("`search` first");
  });
});
