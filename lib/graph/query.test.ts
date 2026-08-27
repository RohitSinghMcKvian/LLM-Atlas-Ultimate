import { describe, expect, it } from "vitest";
import { indexGraph, type GraphDelta, type GraphNode } from "./types";
import { degree, expand, hubPenalty, neighbors, other, paths, rank, subgraph, nodesOfKind } from "./query";

function n(id: string, kind: GraphNode["kind"] = "model"): GraphNode {
  return { id, kind, label: id, summary: id, text: id, props: {} };
}

/**
 * A miniature catalog: two brands, four models, one shared benchmark hub.
 *
 *   brand:a ←made_by— model:a1, model:a2 —scored_on→ bench:x ←— model:b1, model:b2 —made_by→ brand:b
 */
const mini: GraphDelta = {
  nodes: [
    n("brand:a", "brand"),
    n("brand:b", "brand"),
    n("bench:x", "benchmark"),
    n("model:a1"),
    n("model:a2"),
    n("model:b1"),
    n("model:b2"),
  ],
  edges: [
    { from: "model:a1", to: "brand:a", kind: "made_by", weight: 0.55 },
    { from: "model:a2", to: "brand:a", kind: "made_by", weight: 0.55 },
    { from: "model:b1", to: "brand:b", kind: "made_by", weight: 0.55 },
    { from: "model:b2", to: "brand:b", kind: "made_by", weight: 0.55 },
    { from: "model:a1", to: "bench:x", kind: "scored_on", weight: 0.95, props: { score: 90 } },
    { from: "model:a2", to: "bench:x", kind: "scored_on", weight: 0.95, props: { score: 70 } },
    { from: "model:b1", to: "bench:x", kind: "scored_on", weight: 0.95, props: { score: 80 } },
    { from: "model:b2", to: "bench:x", kind: "scored_on", weight: 0.95, props: { score: 60 } },
  ],
};
const g = indexGraph(mini);

describe("neighbors / other / degree", () => {
  it("filters by kind and direction", () => {
    expect(neighbors(g, "model:a1", { kinds: ["made_by"] })).toHaveLength(1);
    expect(neighbors(g, "bench:x", { direction: "out" })).toHaveLength(0);
    expect(neighbors(g, "bench:x", { direction: "in" })).toHaveLength(4);
    expect(neighbors(g, "bench:x")).toHaveLength(4);
  });

  it("other() returns the far end whichever way the edge points", () => {
    const e = neighbors(g, "bench:x")[0];
    expect(other(e, "bench:x")).toMatch(/^model:/);
    expect(other(e, e.from)).toBe("bench:x");
  });

  it("degree counts both directions", () => {
    expect(degree(g, "bench:x")).toBe(4);
    expect(degree(g, "model:a1")).toBe(2);
  });
});

describe("expand", () => {
  it("records hop distance from the nearest seed", () => {
    const { depth } = expand(g, ["model:a1"], { hops: 2, hubDegree: 99 });
    expect(depth.get("model:a1")).toBe(0);
    expect(depth.get("bench:x")).toBe(1);
    expect(depth.get("brand:a")).toBe(1);
    expect(depth.get("model:b1")).toBe(2);
  });

  it("refuses to bridge through a hub, but still admits it", () => {
    // bench:x has degree 4; with the cap at 3 it is reachable but not traversable.
    const { depth } = expand(g, ["model:a1"], { hops: 3, hubDegree: 3 });
    expect(depth.has("bench:x")).toBe(true);
    expect(depth.has("model:b1")).toBe(false);
  });

  it("a seed is always expanded, even when it is itself a hub", () => {
    const { depth } = expand(g, ["bench:x"], { hops: 1, hubDegree: 1 });
    expect(depth.size).toBe(5);
  });

  it("stops at the node budget and says so", () => {
    const { depth, truncated } = expand(g, ["model:a1"], { hops: 3, maxNodes: 3, hubDegree: 99 });
    expect(depth.size).toBeLessThanOrEqual(3);
    expect(truncated).toBe(true);
  });

  it("returns only edges whose endpoints were both admitted", () => {
    const { depth, edges } = expand(g, ["model:a1"], { hops: 1, hubDegree: 99 });
    for (const e of edges) {
      expect(depth.has(e.from)).toBe(true);
      expect(depth.has(e.to)).toBe(true);
    }
  });

  it("ignores seeds that are not in the graph", () => {
    const { depth } = expand(g, ["model:ghost", "model:a1"], { hops: 0 });
    expect([...depth.keys()]).toEqual(["model:a1"]);
  });

  it("is deterministic across repeated runs", () => {
    const a = [...expand(g, ["model:a1"], { hops: 2, maxNodes: 4, hubDegree: 99 }).depth.keys()];
    const b = [...expand(g, ["model:a1"], { hops: 2, maxNodes: 4, hubDegree: 99 }).depth.keys()];
    expect(a).toEqual(b);
  });
});

describe("rank", () => {
  it("puts the seed first and its own brand above the far brand", () => {
    const scores = rank(g, ["model:a1"]);
    const ordered = [...scores.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id);
    expect(ordered[0]).toBe("model:a1");
    expect(ordered.indexOf("brand:a")).toBeLessThan(ordered.indexOf("brand:b"));
  });

  it("keeps the seed above the hub every model shares", () => {
    // The regression this pins: at PageRank's conventional restart of 0.15 and
    // with no hub penalty, bench:x scored 0.285 against the seed's 0.263 — the
    // benchmark outranked the model the question named.
    const scores = rank(g, ["model:a1"]);
    expect(scores.get("model:a1")!).toBeGreaterThan(scores.get("bench:x")!);
  });

  it("hubPenalty falls off with degree but never reaches zero", () => {
    expect(hubPenalty(0)).toBeGreaterThan(hubPenalty(4));
    expect(hubPenalty(4)).toBeGreaterThan(hubPenalty(400));
    expect(hubPenalty(400)).toBeGreaterThan(0);
  });

  it("respects `within` so it can be run over an expansion", () => {
    const { depth } = expand(g, ["model:a1"], { hops: 1, hubDegree: 99 });
    const scores = rank(g, ["model:a1"], { within: depth.keys() });
    for (const id of scores.keys()) expect(depth.has(id)).toBe(true);
  });

  it("returns nothing when no seed is live", () => {
    expect(rank(g, ["model:ghost"]).size).toBe(0);
    expect(rank(g, []).size).toBe(0);
  });

  it("is deterministic", () => {
    const a = JSON.stringify([...rank(g, ["model:a1"]).entries()].sort());
    const b = JSON.stringify([...rank(g, ["model:a1"]).entries()].sort());
    expect(a).toBe(b);
  });

  it("conserves mass — nothing leaks or is minted", () => {
    const total = [...rank(g, ["model:a1"]).values()].reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 6);
  });
});

describe("paths", () => {
  it("finds the shared-benchmark route between two rival models", () => {
    const found = paths(g, "model:a1", "model:b1", 2);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]).toHaveLength(2);
    expect(found[0][0].to).toBe("bench:x");
  });

  it("returns nothing beyond the hop budget, and nothing for a self-path", () => {
    expect(paths(g, "brand:a", "brand:b", 1)).toEqual([]);
    expect(paths(g, "model:a1", "model:a1", 3)).toEqual([]);
    expect(paths(g, "model:a1", "model:ghost", 3)).toEqual([]);
  });
});

describe("subgraph / nodesOfKind", () => {
  it("keeps only edges with both endpoints inside", () => {
    const sub = subgraph(g, ["model:a1", "bench:x"]);
    expect(sub.nodes.size).toBe(2);
    expect(sub.edgeCount).toBe(1);
    expect(sub.out.get("model:a1")).toHaveLength(1);
  });

  it("ignores ids the graph does not have", () => {
    expect(subgraph(g, ["nope"]).nodes.size).toBe(0);
  });

  it("lists a kind in stable order", () => {
    expect(nodesOfKind(g, "brand").map((x) => x.id)).toEqual(["brand:a", "brand:b"]);
  });
});
