import { describe, expect, it } from "vitest";
import {
  buildGrid,
  cursorForce,
  forwardNeighbors,
  linkDistance,
  mixRgb,
  nodeCount,
  rectForce,
  rgba,
  tierFor,
  type FieldPoint,
  type FieldRect,
} from "./field";

describe("tierFor", () => {
  it("splits at the sm breakpoint", () => {
    expect(tierFor(375)).toBe("compact");
    expect(tierFor(639)).toBe("compact");
    expect(tierFor(640)).toBe("full");
    expect(tierFor(1440)).toBe("full");
  });
});

describe("nodeCount", () => {
  it("clamps a phone-sized canvas up to the floor", () => {
    // 375×400 / 26000 ≈ 6 nodes — too sparse to read as a network.
    expect(nodeCount(375, 400, 1, "compact")).toBe(28);
  });

  it("clamps a 4K canvas down to the ceiling", () => {
    expect(nodeCount(3840, 2160, 1, "full")).toBe(110);
  });

  it("is sparser on compact than on full for the same area", () => {
    const area = { w: 1400, h: 900 };
    const compact = nodeCount(area.w, area.h, 1, "compact");
    const full = nodeCount(area.w, area.h, 1, "full");
    expect(compact).toBeLessThan(full);
    // Both should be inside the clamp band, otherwise this asserts nothing.
    expect(compact).toBeGreaterThan(28);
    expect(full).toBeLessThan(110);
  });

  it("scales with density", () => {
    expect(nodeCount(1280, 800, 0.5, "full")).toBeLessThan(
      nodeCount(1280, 800, 1, "full"),
    );
  });

  it("survives a zero-sized or non-finite canvas", () => {
    expect(nodeCount(0, 0)).toBe(28);
    expect(nodeCount(Number.NaN, 800)).toBe(28);
  });
});

describe("linkDistance", () => {
  it("clamps to the legible band", () => {
    expect(linkDistance(320)).toBe(110);
    expect(linkDistance(3840)).toBe(190);
    expect(linkDistance(1050)).toBe(140);
  });
});

describe("cursorForce", () => {
  const rInner = 72;
  const rOuter = 220;

  it("pushes away inside the inner radius", () => {
    const { fx, fy } = cursorForce(30, 0, rInner, rOuter);
    // dx points toward the pointer, so a negative fx means "away from it".
    expect(fx).toBeLessThan(0);
    expect(fy).toBeCloseTo(0);
  });

  it("pulls inward between the radii", () => {
    const { fx } = cursorForce(146, 0, rInner, rOuter);
    expect(fx).toBeGreaterThan(0);
  });

  it("flips sign across the inner radius", () => {
    const inside = cursorForce(rInner - 1, 0, rInner, rOuter).fx;
    const outside = cursorForce(rInner + 1, 0, rInner, rOuter).fx;
    expect(Math.sign(inside)).toBe(-1);
    expect(Math.sign(outside)).toBe(1);
  });

  it("is continuous at the inner radius", () => {
    const inside = cursorForce(rInner - 0.001, 0, rInner, rOuter).fx;
    const outside = cursorForce(rInner + 0.001, 0, rInner, rOuter).fx;
    expect(Math.abs(inside)).toBeLessThan(0.001);
    expect(Math.abs(outside)).toBeLessThan(0.001);
  });

  it("goes quiet beyond the outer radius", () => {
    expect(cursorForce(rOuter, 0, rInner, rOuter)).toEqual({ fx: 0, fy: 0 });
    expect(cursorForce(400, 300, rInner, rOuter)).toEqual({ fx: 0, fy: 0 });
  });

  it("stays finite when the node sits exactly on the pointer", () => {
    const f = cursorForce(0, 0, rInner, rOuter);
    expect(Number.isFinite(f.fx)).toBe(true);
    expect(Number.isFinite(f.fy)).toBe(true);
  });

  it("never exceeds unit magnitude", () => {
    for (let d = 0; d <= rOuter; d += 1) {
      const { fx, fy } = cursorForce(d, 0, rInner, rOuter);
      expect(Math.hypot(fx, fy)).toBeLessThanOrEqual(1);
    }
  });
});

describe("spatial grid", () => {
  // Deterministic fixture — a seeded LCG, so a failure is always reproducible.
  function points(n: number, seed = 42): FieldPoint[] {
    let s = seed;
    const next = () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
    return Array.from({ length: n }, () => ({
      x: next() * 1280,
      y: next() * 800,
    }));
  }

  function key(a: number, b: number) {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
  }

  it("yields every near pair exactly once", () => {
    const cell = 140;
    const pts = points(120);

    const brute = new Set<string>();
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < cell) {
          brute.add(key(i, j));
        }
      }
    }

    const grid = buildGrid(pts, cell);
    const seen: string[] = [];
    const out: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      for (const j of forwardNeighbors(grid, pts, i, out)) {
        if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < cell) {
          seen.push(key(i, j));
        }
      }
    }

    expect(brute.size).toBeGreaterThan(0);
    expect(new Set(seen).size).toBe(seen.length); // no duplicates
    expect(new Set(seen)).toEqual(brute);
  });

  it("handles negative coordinates", () => {
    const pts: FieldPoint[] = [
      { x: -30, y: -20 },
      { x: -25, y: -18 },
      { x: 900, y: 700 },
    ];
    const grid = buildGrid(pts, 120);
    expect(forwardNeighbors(grid, pts, 0)).toContain(1);
    expect(forwardNeighbors(grid, pts, 0)).not.toContain(2);
  });

  it("reuses the output array without leaking entries", () => {
    const pts = points(40);
    const grid = buildGrid(pts, 200);
    const out: number[] = [];
    const first = forwardNeighbors(grid, pts, 0, out).slice();
    forwardNeighbors(grid, pts, 1, out);
    const again = forwardNeighbors(grid, pts, 0, out);
    expect(again).toEqual(first);
  });

  it("returns nothing for an out-of-range index", () => {
    const pts = points(5);
    expect(forwardNeighbors(buildGrid(pts, 100), pts, 99)).toEqual([]);
  });
});

describe("rectForce", () => {
  // A stand-in for the sign-in panel: tall, narrow, hard against the right edge.
  const panel: FieldRect = { x: 600, y: 0, w: 400, h: 800 };
  const INNER = 120;
  const OUTER = 340;

  it("pushes an interior node out the short way", () => {
    // Near the left edge of a 400-wide panel, so left is the shortest exit.
    const { fx, fy } = rectForce(650, 400, panel, INNER, OUTER);
    expect(fx).toBeLessThan(0);
    // A pure horizontal push. `toBeCloseTo` rather than `toBe`, because the
    // unit vector's y component arrives as -0 and `Object.is(-0, 0)` is false.
    expect(fy).toBeCloseTo(0);
  });

  it("pushes out the near edge even when the centre is far away", () => {
    // The case that rules out aiming at the rect's centre: a node close to the
    // right edge of a tall panel is ~400px from that centre, well beyond OUTER,
    // so a centre-based delta would produce no force at all.
    const { fx } = rectForce(980, 780, panel, INNER, OUTER);
    expect(fx).toBeGreaterThan(0);
  });

  it("repels a node just outside the edge", () => {
    const { fx } = rectForce(560, 400, panel, INNER, OUTER);
    expect(fx).toBeLessThan(0);
  });

  it("draws mid-band nodes back toward the edge, forming the ridge", () => {
    const { fx } = rectForce(600 - (INNER + OUTER) / 2, 400, panel, INNER, OUTER);
    expect(fx).toBeGreaterThan(0);
  });

  it("ignores nodes beyond the outer radius", () => {
    expect(rectForce(100, 400, panel, INNER, OUTER)).toEqual({ fx: 0, fy: 0 });
  });

  it("measures to the nearest point, so a corner pulls diagonally", () => {
    const { fx, fy } = rectForce(560, -40, panel, INNER, OUTER);
    expect(fx).toBeLessThan(0);
    expect(fy).toBeLessThan(0);
  });

  it("attract pulls inward across the whole radius, with no sign flip", () => {
    // Negating the repel profile would push mid-band nodes away at exactly the
    // moment everything is meant to be gathering, so `attract` is its own curve.
    for (const distance of [20, 100, 200, 300]) {
      const { fx } = rectForce(600 - distance, 400, panel, INNER, OUTER, true);
      expect(fx).toBeGreaterThan(0);
    }
  });

  it("leaves already-gathered nodes alone while attracting", () => {
    expect(rectForce(700, 400, panel, INNER, OUTER, true)).toEqual({ fx: 0, fy: 0 });
  });

  it("is inert for a degenerate rect", () => {
    const empty: FieldRect = { x: 0, y: 0, w: 0, h: 0 };
    expect(rectForce(10, 10, empty, INNER, OUTER)).toEqual({ fx: 0, fy: 0 });
  });
});

describe("colour helpers", () => {
  it("blends channel-wise and rounds", () => {
    expect(mixRgb([0, 0, 0], [255, 255, 255], 0.5)).toEqual([128, 128, 128]);
    expect(mixRgb([34, 211, 238], [124, 58, 237], 0)).toEqual([34, 211, 238]);
    expect(mixRgb([34, 211, 238], [124, 58, 237], 1)).toEqual([124, 58, 237]);
  });

  it("clamps the blend factor", () => {
    expect(mixRgb([0, 0, 0], [100, 100, 100], 5)).toEqual([100, 100, 100]);
    expect(mixRgb([0, 0, 0], [100, 100, 100], -5)).toEqual([0, 0, 0]);
  });

  it("clamps alpha into a valid canvas colour", () => {
    expect(rgba([34, 211, 238], 0.4)).toBe("rgba(34, 211, 238, 0.4)");
    expect(rgba([34, 211, 238], 2)).toBe("rgba(34, 211, 238, 1)");
    expect(rgba([34, 211, 238], -1)).toBe("rgba(34, 211, 238, 0)");
  });
});
