import { describe, expect, it } from "vitest";
import { BANDS, bandFor, layout, mulberry32, seedFrom, type LayoutInput } from "./layout";
import type { GraphEdge } from "./types";

function chain(n: number): LayoutInput {
  const nodes = Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    score: 1 - i / n,
    depth: Math.min(2, i),
  }));
  const edges: GraphEdge[] = Array.from({ length: Math.max(0, n - 1) }, (_, i) => ({
    from: `n${i}`,
    to: `n${i + 1}`,
    kind: "made_by" as const,
    weight: 0.6,
  }));
  return { nodes, edges, seed: "fixed" };
}

describe("mulberry32 / seedFrom", () => {
  it("is reproducible from a seed", () => {
    const a = mulberry32(seedFrom("x"));
    const b = mulberry32(seedFrom("x"));
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("different seeds diverge", () => {
    expect(mulberry32(seedFrom("x"))()).not.toBe(mulberry32(seedFrom("y"))());
  });

  it("stays in [0, 1)", () => {
    const r = mulberry32(seedFrom("range"));
    for (let i = 0; i < 200; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("bandFor", () => {
  it("puts the strongest node on the summit and the weakest at the bottom", () => {
    expect(bandFor(1, 1)).toBe(BANDS - 1);
    expect(bandFor(0, 1)).toBe(0);
  });

  it("is relative to this retrieval, not an absolute scale", () => {
    // Two walks whose masses differ by 100x but whose shape is identical must
    // draw the same relief - PageRank mass is not comparable across walks.
    expect(bandFor(0.5, 1)).toBe(bandFor(0.005, 0.01));
  });

  it("spreads a long tail instead of collapsing it into one band", () => {
    const bands = [1, 0.5, 0.25, 0.12, 0.06, 0.01].map((s) => bandFor(s, 1));
    expect(new Set(bands).size).toBeGreaterThanOrEqual(4);
  });

  it("never falls outside the ramp", () => {
    for (const [s, t] of [
      [5, 1],
      [-1, 1],
      [1, 0],
      [0, 0],
    ]) {
      const b = bandFor(s, t);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(BANDS - 1);
    }
  });
});

describe("layout", () => {
  it("places every node exactly once", () => {
    const placed = layout(chain(12));
    expect(placed).toHaveLength(12);
    expect(new Set(placed.map((p) => p.id)).size).toBe(12);
  });

  it("keeps everything inside the frame", () => {
    const placed = layout({ ...chain(30), width: 400, height: 300 });
    for (const p of placed) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(400);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(300);
    }
  });

  it("is deterministic - the same input draws the same map", () => {
    expect(layout(chain(20))).toEqual(layout(chain(20)));
  });

  it("depends on the seed, so a caller can reshuffle deliberately", () => {
    const a = layout({ ...chain(20), seed: "a" });
    const b = layout({ ...chain(20), seed: "b" });
    expect(a).not.toEqual(b);
  });

  it("rounds coordinates, so server and client agree", () => {
    for (const p of layout(chain(15))) {
      expect(p.x).toBe(Math.round(p.x * 100) / 100);
      expect(p.y).toBe(Math.round(p.y * 100) / 100);
    }
  });

  it("separates connected nodes instead of stacking them", () => {
    const placed = layout(chain(10));
    const seen = new Set(placed.map((p) => `${p.x},${p.y}`));
    expect(seen.size).toBe(placed.length);
  });

  it("holds a tightly-weighted pair closer than a loosely-weighted one", () => {
    const nodes = [
      { id: "a", score: 1, depth: 0 },
      { id: "b", score: 1, depth: 1 },
      { id: "c", score: 1, depth: 1 },
    ];
    const dist = (w: number) => {
      const [a, , c] = layout({
        nodes,
        edges: [
          { from: "a", to: "b", kind: "scored_on", weight: 0.95 },
          { from: "a", to: "c", kind: "tagged", weight: w },
        ],
        seed: "pair",
      });
      return Math.hypot(a.x - c.x, a.y - c.y);
    };
    expect(dist(0.95)).toBeLessThan(dist(0.05));
  });

  it("handles the degenerate inputs without throwing", () => {
    expect(layout({ nodes: [], edges: [] })).toEqual([]);
    const one = layout({ nodes: [{ id: "solo", score: 0, depth: 0 }], edges: [] });
    expect(one).toHaveLength(1);
    expect(Number.isFinite(one[0].x)).toBe(true);
    expect(one[0].band).toBe(0);
  });

  it("ignores edges pointing outside the node set", () => {
    const placed = layout({
      nodes: [{ id: "a", score: 1, depth: 0 }],
      edges: [{ from: "a", to: "missing", kind: "made_by", weight: 1 }],
    });
    expect(placed).toHaveLength(1);
    expect(Number.isFinite(placed[0].x)).toBe(true);
  });

  it("stays within its time budget at the Map's node cap", () => {
    const started = Date.now();
    layout(chain(120));
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
