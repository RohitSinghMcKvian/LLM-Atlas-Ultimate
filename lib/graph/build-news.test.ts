import { describe, expect, it } from "vitest";
import type { NewsArticle, NewsCluster, Verification } from "@/lib/news/types";
import { buildNewsGraph, DEFAULT_ARTICLE_LIMIT } from "./build-news";
import { indexGraph, nodeId } from "./types";
import { neighbors } from "./query";

const verification: Verification = {
  level: "corroborated",
  score: 70,
  signals: [],
  corroboration: 2,
  distinctDomains: 2,
  firstParty: false,
};

function article(over: Partial<NewsArticle> & { id: string }): NewsArticle {
  return {
    title: `Story ${over.id}`,
    summary: "A summary.",
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
  };
}

function cluster(over: Partial<NewsCluster> & { id: string }): NewsCluster {
  return {
    leadId: "a1",
    memberIds: ["a1"],
    domains: ["example.com"],
    topics: ["models"],
    models: [],
    latestAt: "2026-06-01T00:00:00.000Z",
    firstAt: "2026-06-01T00:00:00.000Z",
    baseScore: 10,
    verification,
    ...over,
  };
}

describe("buildNewsGraph", () => {
  it("turns the sync's already-resolved model links into edges", () => {
    const delta = buildNewsGraph({
      articles: [article({ id: "a1", models: ["acme-large"] })],
      clusters: [cluster({ id: "c1" })],
    });
    const about = delta.edges.filter((e) => e.kind === "about");
    expect(about).toHaveLength(1);
    expect(about[0]).toMatchObject({ from: nodeId("article", "a1"), to: nodeId("model", "acme-large") });
  });

  it("weights the model link above every other news edge", () => {
    const delta = buildNewsGraph({
      articles: [article({ id: "a1", models: ["m"], topics: ["models", "agents"] })],
      clusters: [cluster({ id: "c1" })],
    });
    const about = delta.edges.find((e) => e.kind === "about")!;
    for (const e of delta.edges.filter((x) => x.kind !== "about")) {
      expect(about.weight).toBeGreaterThan(e.weight);
    }
  });

  it("folds a named org into the catalog's brand node instead of minting a twin", () => {
    const delta = buildNewsGraph({
      articles: [article({ id: "a1", orgs: ["Anthropic", "Some Startup"] })],
      clusters: [cluster({ id: "c1" })],
      knownBrands: ["Anthropic"],
    });
    expect(delta.nodes.some((n) => n.id === nodeId("org", "Anthropic"))).toBe(false);
    expect(delta.edges.some((e) => e.to === nodeId("brand", "Anthropic"))).toBe(true);
    // The one the catalog does not know still becomes an org.
    expect(delta.nodes.some((n) => n.id === nodeId("org", "Some Startup"))).toBe(true);
  });

  it("matches a brand whose casing or punctuation differs", () => {
    const delta = buildNewsGraph({
      articles: [article({ id: "a1", orgs: ["mistral ai"] })],
      clusters: [cluster({ id: "c1" })],
      knownBrands: ["Mistral AI"],
    });
    expect(delta.nodes.some((n) => n.kind === "org")).toBe(false);
  });

  it("puts the publisher and date in the summary, since the model cites it", () => {
    const delta = buildNewsGraph({
      articles: [article({ id: "a1", host: "acme.dev", publishedAt: "2026-05-04T09:00:00.000Z" })],
      clusters: [cluster({ id: "c1" })],
    });
    const n = delta.nodes.find((x) => x.kind === "article")!;
    expect(n.summary).toContain("acme.dev");
    expect(n.summary).toContain("2026-05-04");
  });

  it("admits the newest articles first and drops the tail", () => {
    const articles = Array.from({ length: 5 }, (_, i) =>
      article({ id: `a${i}`, publishedAt: `2026-06-0${i + 1}T00:00:00.000Z`, clusterId: "c1" }),
    );
    const delta = buildNewsGraph({ articles, clusters: [cluster({ id: "c1" })], limit: 2 });
    const ids = delta.nodes.filter((n) => n.kind === "article").map((n) => n.id);
    expect(ids.sort()).toEqual([nodeId("article", "a3"), nodeId("article", "a4")]);
  });

  it("never links a cluster to an article the limit excluded", () => {
    const articles = Array.from({ length: 4 }, (_, i) =>
      article({ id: `a${i}`, publishedAt: `2026-06-0${i + 1}T00:00:00.000Z` }),
    );
    const delta = buildNewsGraph({
      articles,
      clusters: [cluster({ id: "c1", memberIds: ["a0", "a1", "a2", "a3"] })],
      limit: 2,
    });
    const built = new Set(delta.nodes.map((n) => n.id));
    for (const e of delta.edges) expect(built.has(e.from)).toBe(true);
  });

  it("joins two articles about the same model through that model", () => {
    const g = indexGraph(
      buildNewsGraph({
        articles: [
          article({ id: "a1", models: ["m"], clusterId: "c1" }),
          article({ id: "a2", models: ["m"], clusterId: "c2" }),
        ],
        clusters: [cluster({ id: "c1" }), cluster({ id: "c2", leadId: "a2", memberIds: ["a2"] })],
        // The model node itself comes from the catalog builder; without it the
        // edges are correctly dropped rather than inventing a factless node.
      }),
    );
    expect(g.nodes.has(nodeId("model", "m"))).toBe(false);
    const withModel = indexGraph({
      nodes: [
        ...buildNewsGraph({
          articles: [
            article({ id: "a1", models: ["m"], clusterId: "c1" }),
            article({ id: "a2", models: ["m"], clusterId: "c2" }),
          ],
          clusters: [cluster({ id: "c1" }), cluster({ id: "c2", leadId: "a2", memberIds: ["a2"] })],
        }).nodes,
        { id: nodeId("model", "m"), kind: "model", label: "M", summary: "M", text: "M", props: {} },
      ],
      edges: buildNewsGraph({
        articles: [
          article({ id: "a1", models: ["m"], clusterId: "c1" }),
          article({ id: "a2", models: ["m"], clusterId: "c2" }),
        ],
        clusters: [cluster({ id: "c1" }), cluster({ id: "c2", leadId: "a2", memberIds: ["a2"] })],
      }).edges,
    });
    expect(neighbors(withModel, nodeId("model", "m"), { direction: "in" })).toHaveLength(2);
  });

  it("has a sane default limit", () => {
    expect(DEFAULT_ARTICLE_LIMIT).toBeGreaterThan(100);
  });

  it("is deterministic", () => {
    const input = {
      articles: [article({ id: "a1", models: ["m"], orgs: ["X"] })],
      clusters: [cluster({ id: "c1" })],
    };
    expect(JSON.stringify(buildNewsGraph(input))).toBe(JSON.stringify(buildNewsGraph(input)));
  });
});
