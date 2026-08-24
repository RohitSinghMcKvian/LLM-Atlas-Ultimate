import { describe, expect, it } from "vitest";
import {
  emptyGraph,
  graphStats,
  indexGraph,
  mergeDeltas,
  nodeId,
  slugKey,
  type GraphDelta,
  type GraphNode,
} from "./types";

function node(id: string, text = "t"): GraphNode {
  return { id, kind: "model", label: id, summary: id, text, props: {} };
}

describe("slugKey / nodeId", () => {
  it("collapses case and punctuation so one brand is one node", () => {
    expect(slugKey("Meta")).toBe("meta");
    expect(slugKey("meta")).toBe("meta");
    expect(slugKey("Mistral AI")).toBe("mistral-ai");
    expect(slugKey("  --Qwen--  ")).toBe("qwen");
    expect(nodeId("brand", "Meta")).toBe("brand:meta");
  });
});

describe("indexGraph", () => {
  it("drops edges pointing at nodes that were never built", () => {
    const delta: GraphDelta = {
      nodes: [node("model:a"), node("model:b")],
      edges: [
        { from: "model:a", to: "model:b", kind: "made_by", weight: 1 },
        { from: "model:a", to: "model:ghost", kind: "made_by", weight: 1 },
      ],
    };
    const g = indexGraph(delta);
    expect(g.edgeCount).toBe(1);
    expect(g.out.get("model:a")).toHaveLength(1);
  });

  it("drops self edges and duplicates", () => {
    const g = indexGraph({
      nodes: [node("a"), node("b")],
      edges: [
        { from: "a", to: "a", kind: "tagged", weight: 1 },
        { from: "a", to: "b", kind: "tagged", weight: 1 },
        { from: "a", to: "b", kind: "tagged", weight: 0.5 },
      ],
    });
    expect(g.edgeCount).toBe(1);
  });

  it("keeps the richer node on an id collision, whichever order they arrive", () => {
    const rich = node("brand:anthropic", "a much longer body of text");
    const thin = node("brand:anthropic", "short");
    expect(indexGraph({ nodes: [rich, thin], edges: [] }).nodes.get("brand:anthropic")!.text).toBe(
      rich.text,
    );
    expect(indexGraph({ nodes: [thin, rich], edges: [] }).nodes.get("brand:anthropic")!.text).toBe(
      rich.text,
    );
  });

  it("sorts adjacency deterministically so a truncated walk truncates the same way", () => {
    const delta: GraphDelta = {
      nodes: [node("a"), node("b"), node("c"), node("d")],
      edges: [
        { from: "a", to: "b", kind: "tagged", weight: 0.1 },
        { from: "a", to: "c", kind: "scored_on", weight: 0.9 },
        { from: "a", to: "d", kind: "made_by", weight: 0.5 },
      ],
    };
    const once = indexGraph(delta).out.get("a")!.map((e) => e.to);
    const twice = indexGraph({ ...delta, edges: [...delta.edges].reverse() }).out
      .get("a")!
      .map((e) => e.to);
    expect(once).toEqual(["c", "d", "b"]);
    expect(twice).toEqual(once);
  });

  it("indexes both directions", () => {
    const g = indexGraph({
      nodes: [node("a"), node("b")],
      edges: [{ from: "a", to: "b", kind: "made_by", weight: 1 }],
    });
    expect(g.out.get("a")).toHaveLength(1);
    expect(g.in.get("b")).toHaveLength(1);
    expect(g.out.get("b")).toBeUndefined();
  });
});

describe("mergeDeltas / graphStats / emptyGraph", () => {
  it("merges and counts by kind", () => {
    const merged = mergeDeltas(
      { nodes: [node("model:a")], edges: [] },
      {
        nodes: [{ ...node("brand:x"), kind: "brand" }],
        edges: [{ from: "model:a", to: "brand:x", kind: "made_by", weight: 1 }],
      },
    );
    const stats = graphStats(indexGraph(merged));
    expect(stats).toEqual({ nodes: 2, edges: 1, byKind: { model: 1, brand: 1 } });
  });

  it("empty graph is inert", () => {
    const stats = graphStats(emptyGraph());
    expect(stats.nodes).toBe(0);
    expect(stats.edges).toBe(0);
  });
});
