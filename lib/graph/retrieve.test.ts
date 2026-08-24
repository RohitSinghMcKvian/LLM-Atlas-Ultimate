import { describe, expect, it } from "vitest";
import { emptyGraph, nodeId } from "./types";
import {
  DEFAULT_MAX_CITED,
  MENTION_SIMILARITY_SLOTS,
  formatGraphContext,
  hrefFor,
  mentionSeeds,
  nodeIndex,
  retrieveGraph,
  similaritySeeds,
} from "./retrieve";
import { miniGraph } from "./__fixtures__/mini-catalog";

const g = miniGraph();

describe("nodeIndex", () => {
  it("is memoised per graph object", () => {
    expect(nodeIndex(g)).toBe(nodeIndex(g));
  });

  it("vectors line up with ids", () => {
    const idx = nodeIndex(g);
    expect(idx.ids.length).toBe(g.nodes.size);
    expect(idx.vectors.length).toBe(idx.ids.length);
  });

  it("orders labels longest first, deterministically", () => {
    const labels = nodeIndex(g).labels.map((l) => l.label);
    for (let i = 1; i < labels.length; i++) {
      expect(labels[i - 1].length).toBeGreaterThanOrEqual(labels[i].length);
    }
  });
});

describe("mentionSeeds", () => {
  it("finds a model named outright", () => {
    expect(mentionSeeds(g, "how good is Summit Pro at coding?", 10)).toContain(
      nodeId("model", "summit-pro"),
    );
  });

  it("survives punctuation the question spells differently", () => {
    expect(mentionSeeds(g, "tell me about meridian-70b", 10)).toContain(
      nodeId("model", "meridian-70b"),
    );
  });

  it("prefers the specific model over the family that shares its name", () => {
    const seeds = mentionSeeds(g, "Meridian 70B pricing", 10);
    expect(seeds[0]).toBe(nodeId("model", "meridian-70b"));
    // The family node is not also seeded off the same span.
    expect(seeds).not.toContain(nodeId("family", "Cartograph-Meridian"));
  });

  it("still matches two different entities in one question", () => {
    const seeds = mentionSeeds(g, "compare Summit Pro and Delta Reason", 10);
    expect(seeds).toContain(nodeId("model", "summit-pro"));
    expect(seeds).toContain(nodeId("model", "delta-reason"));
  });

  it("finds nothing in a question that names nothing", () => {
    expect(mentionSeeds(g, "what is the weather like", 10)).toEqual([]);
  });

  it("respects the limit", () => {
    expect(mentionSeeds(g, "Summit Pro Delta Reason Meridian 8B", 1)).toHaveLength(1);
    expect(mentionSeeds(g, "Summit Pro", 0)).toEqual([]);
  });
});

describe("similaritySeeds", () => {
  it("reaches a model the question described but never named", () => {
    const seeds = similaritySeeds(g, "an open weights model with a huge context window", 8, 0.02);
    expect(seeds.length).toBeGreaterThan(0);
  });

  it("returns nothing below the score floor", () => {
    expect(similaritySeeds(g, "zzzz qqqq", 8, 0.9)).toEqual([]);
  });

  it("is deterministic on ties", () => {
    const a = similaritySeeds(g, "open model", 5, 0).map((s) => s.id);
    const b = similaritySeeds(g, "open model", 5, 0).map((s) => s.id);
    expect(a).toEqual(b);
  });
});

describe("retrieveGraph", () => {
  it("returns null rather than an empty block when nothing is reached", () => {
    expect(retrieveGraph(emptyGraph(), "anything")).toBeNull();
    expect(retrieveGraph(g, "   ")).toBeNull();
    expect(retrieveGraph(g, "xylophone quokka", { minSeedScore: 0.99 })).toBeNull();
  });

  it("puts a named model first, ahead of anything merely similar", () => {
    const ctx = retrieveGraph(g, "is Summit Pro worth the price?")!;
    expect(ctx.cited[0].node.id).toBe(nodeId("model", "summit-pro"));
    expect(ctx.cited[0].via).toBe("mention");
  });

  it("reaches rival models through the benchmark they share", () => {
    const ctx = retrieveGraph(g, "which models beat Meridian 70B on MMLU?", { hubDegree: 99 })!;
    const ids = ctx.scope.nodes.map((n) => n.node.id);
    expect(ids).toContain(nodeId("benchmark", "mmlu"));
    expect(ids).toContain(nodeId("model", "summit-pro"));
  });

  it("carries the score on the relation, so a comparison is answerable", () => {
    const ctx = retrieveGraph(g, "Meridian 70B MMLU score", { hubDegree: 99 })!;
    expect(ctx.text).toMatch(/scored on \[\d+\] - score 84\.1%/);
  });

  it("cites fewer nodes than it maps", () => {
    const ctx = retrieveGraph(g, "compare Summit Pro and Meridian 70B", {
      hubDegree: 99,
      maxCited: 5,
    })!;
    expect(ctx.cited).toHaveLength(5);
    expect(ctx.scope.nodes.length).toBeGreaterThan(5);
    expect(ctx.sources).toHaveLength(5);
  });

  it("sources align one-to-one with cited nodes", () => {
    const ctx = retrieveGraph(g, "Summit Pro")!;
    ctx.cited.forEach((r, i) => {
      expect(ctx.sources[i].snippet).toBe(r.node.summary);
    });
  });

  it("defaults to a sane citation budget", () => {
    const ctx = retrieveGraph(g, "open models", { hubDegree: 99 })!;
    expect(ctx.cited.length).toBeLessThanOrEqual(DEFAULT_MAX_CITED);
  });

  it("ranks by how well a seed matched, not by how dense its neighbourhood is", () => {
    // The regression: with uniform seed mass, `modality:vision` matched this
    // question at 0.51 and was still ranked out of the citation list by three
    // brand nodes that matched at 0.15, because brands sit among more edges.
    const ctx = retrieveGraph(g, "Which models can accept images as input?", {
      maxCited: 12,
      hubDegree: 99,
    })!;
    const cited = ctx.cited.map((r) => r.node.id);
    expect(cited).toContain(nodeId("modality", "vision"));
    expect(cited.indexOf(nodeId("modality", "vision"))).toBeLessThan(
      cited.indexOf(nodeId("brand", "Alpine")),
    );
  });

  it("admits few similarity seeds once the question named something", () => {
    const ctx = retrieveGraph(g, "Which provider serves Delta Reason?")!;
    const bySimilarity = ctx.seeds.filter(
      (id) => ctx.scope.nodes.find((n) => n.node.id === id)?.via === "similarity",
    );
    expect(bySimilarity.length).toBeLessThanOrEqual(MENTION_SIMILARITY_SLOTS);
  });

  it("drops similarity seeds far below the best one", () => {
    const ctx = retrieveGraph(g, "Which models can accept images as input?", { seedRatio: 0.9 })!;
    expect(ctx.seeds).toEqual([nodeId("modality", "vision")]);
  });

  it("is deterministic", () => {
    const a = retrieveGraph(g, "cheapest open model with tool use")!;
    const b = retrieveGraph(g, "cheapest open model with tool use")!;
    expect(a.cited.map((n) => n.node.id)).toEqual(b.cited.map((n) => n.node.id));
    expect(a.text).toBe(b.text);
  });
});

describe("formatGraphContext", () => {
  it("numbers from startIndex so graph nodes can follow web sources", () => {
    const ctx = retrieveGraph(g, "Summit Pro", { startIndex: 6, maxCited: 2 })!;
    expect(ctx.text).toContain("[6] Model");
    expect(ctx.text).toContain("[7] ");
    expect(ctx.text).not.toContain("[1] ");
  });

  it("only prints relations whose both ends were cited", () => {
    const ctx = retrieveGraph(g, "Summit Pro", { maxCited: 1 })!;
    expect(ctx.text).not.toContain("Relations:");
  });

  it("closes the block even when the budget cuts it short", () => {
    const ctx = retrieveGraph(g, "open models with tool use", { hubDegree: 99, maxChars: 300 })!;
    expect(ctx.text.length).toBeLessThanOrEqual(300);
    expect(ctx.text.endsWith("</atlas_graph>")).toBe(true);
    expect(ctx.text).toContain("(truncated)");
  });

  it("renders an empty node list without inventing content", () => {
    const text = formatGraphContext([], []);
    expect(text).toContain("<atlas_graph>");
    expect(text).toContain("</atlas_graph>");
    expect(text).not.toContain("Relations:");
  });
});

describe("hrefFor", () => {
  it("points a model at a route that really accepts a model id", () => {
    const model = g.nodes.get(nodeId("model", "summit-pro"))!;
    expect(hrefFor(model)).toBe("/cost?model=summit-pro");
  });

  it("sends an article to its own publisher, not to a stub", () => {
    expect(
      hrefFor({
        id: "article:a",
        kind: "article",
        label: "t",
        summary: "s",
        text: "t",
        props: { url: "https://acme.dev/post" },
      }),
    ).toBe("https://acme.dev/post");
  });

  it("falls back to the page where the fact lives", () => {
    expect(hrefFor(g.nodes.get(nodeId("benchmark", "mmlu"))!)).toBe("/leaderboard");
    expect(hrefFor(g.nodes.get(nodeId("provider", "openrouter"))!)).toBe("/router");
  });
});
