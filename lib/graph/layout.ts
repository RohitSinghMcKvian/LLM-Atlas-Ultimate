import type { GraphEdge } from "./types";

/**
 * Where the Map draws each node.
 *
 * Pure and *deterministic*, following `lib/canvas/field.ts` (the constellation's
 * maths layer) and `components/brand/glyph.tsx` (the per-module contour
 * signature): the same retrieval must produce the same map every time. A map
 * that reshuffles between renders cannot be read, and one that reshuffles
 * between server and client hydrates with a mismatch - which is why coordinates
 * are rounded, exactly as `glyph.tsx` rounds its own.
 *
 * Two channels carry two different things, and keeping them separate is the
 * whole design:
 *
 *  - **Position** encodes *relatedness* - a force layout, so nodes that share
 *    edges settle near each other.
 *  - **Elevation band** encodes *retrieval score* - so the strongest evidence
 *    sits on the ridge and background context on the shelf, against the same
 *    six-band ramp (`--elev-0..5`) every chart and the leaderboard already use.
 */

export interface LayoutInput {
  /** Ranked nodes. Order is not used; `score` is. */
  nodes: { id: string; score: number; depth: number }[];
  edges: GraphEdge[];
  width?: number;
  height?: number;
  /** Iterations. Fixed rather than convergence-tested, so the cost is bounded. */
  iterations?: number;
  /** Any string. The same seed and input always give the same map. */
  seed?: string;
}

export interface Placed {
  id: string;
  x: number;
  y: number;
  /** 0..5, indexing the elevation ramp. 5 is the summit. */
  band: number;
  /** 0..1, the node's share of the top score. Drives radius and opacity. */
  intensity: number;
}

export const DEFAULT_WIDTH = 420;
export const DEFAULT_HEIGHT = 320;
export const DEFAULT_ITERATIONS = 220;

/** The ramp has six bands; the top two are reserved for what the question reached. */
export const BANDS = 6;

/** Same generator as `components/brand/glyph.tsx`, for the same reason. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Map a score to an elevation band.
 *
 * Relative to the strongest node in *this* retrieval, not to an absolute scale:
 * PageRank mass is only comparable within one walk, so an absolute threshold
 * would make an unremarkable map look dramatic whenever the top score happened
 * to be low.
 */
export function bandFor(score: number, top: number): number {
  if (top <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, score / top));
  // Perceptual rather than linear: PageRank mass has a long tail, so a linear
  // split puts almost everything in band 0 and the map reads as flat.
  const eased = Math.sqrt(ratio);
  return Math.max(0, Math.min(BANDS - 1, Math.round(eased * (BANDS - 1))));
}

export function layout(input: LayoutInput): Placed[] {
  const width = input.width ?? DEFAULT_WIDTH;
  const height = input.height ?? DEFAULT_HEIGHT;
  const iterations = input.iterations ?? DEFAULT_ITERATIONS;
  const nodes = input.nodes;
  if (nodes.length === 0) return [];

  const rnd = mulberry32(seedFrom(input.seed ?? nodes.map((n) => n.id).join("|")));
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const cx = width / 2;
  const cy = height / 2;

  // Start on a ring ordered by depth, so hop distance is already roughly radial
  // before a single force runs. A purely random start needs far more iterations
  // to reach the same arrangement, and lands somewhere different each time the
  // iteration budget changes.
  const xs = new Array<number>(nodes.length);
  const ys = new Array<number>(nodes.length);
  const maxDepth = Math.max(1, ...nodes.map((n) => n.depth));
  for (let i = 0; i < nodes.length; i++) {
    const ring = (nodes[i].depth + 0.35) / (maxDepth + 1);
    const angle = (i / nodes.length) * Math.PI * 2 + rnd() * 0.6;
    xs[i] = cx + Math.cos(angle) * ring * width * 0.42;
    ys[i] = cy + Math.sin(angle) * ring * height * 0.42;
  }

  const springs = input.edges
    .map((e) => ({ a: index.get(e.from), b: index.get(e.to), w: e.weight }))
    .filter((s): s is { a: number; b: number; w: number } => s.a !== undefined && s.b !== undefined);

  const area = width * height;
  const k = Math.sqrt(area / nodes.length) * 0.62;

  for (let step = 0; step < iterations; step++) {
    // Cooling: large moves early, small corrections late. Without it the layout
    // never settles and the last iteration is as arbitrary as the first.
    const temperature = (1 - step / iterations) ** 1.6;
    const dx = new Array<number>(nodes.length).fill(0);
    const dy = new Array<number>(nodes.length).fill(0);

    // Repulsion. O(n^2), which is fine at the Map's budget of ~120 nodes and
    // buys exact reproducibility that a Barnes-Hut approximation would not.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let ox = xs[i] - xs[j];
        let oy = ys[i] - ys[j];
        let d2 = ox * ox + oy * oy;
        if (d2 < 0.01) {
          // Coincident nodes have no direction to separate along. Nudge them
          // with the seeded generator so the tie breaks the same way every run.
          ox = (rnd() - 0.5) * 0.1;
          oy = (rnd() - 0.5) * 0.1;
          d2 = ox * ox + oy * oy + 0.01;
        }
        const force = (k * k) / d2;
        dx[i] += ox * force;
        dy[i] += oy * force;
        dx[j] -= ox * force;
        dy[j] -= oy * force;
      }
    }

    for (const s of springs) {
      const ox = xs[s.a] - xs[s.b];
      const oy = ys[s.a] - ys[s.b];
      const d = Math.sqrt(ox * ox + oy * oy) || 0.01;
      // Edge weight is a traversal prior, and it doubles here as how tightly
      // two nodes are held together - so a benchmark relation reads as closer
      // than a shared tag, which is exactly what it means.
      const force = ((d * d) / k) * (0.35 + s.w * 0.65);
      dx[s.a] -= (ox / d) * force;
      dy[s.a] -= (oy / d) * force;
      dx[s.b] += (ox / d) * force;
      dy[s.b] += (oy / d) * force;
    }

    for (let i = 0; i < nodes.length; i++) {
      // A gentle pull to centre, so a disconnected node drifts to the edge of
      // the frame instead of out of it.
      dx[i] += (cx - xs[i]) * 0.012;
      dy[i] += (cy - ys[i]) * 0.012;

      const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 1;
      const limit = Math.min(d, k * temperature);
      xs[i] += (dx[i] / d) * limit;
      ys[i] += (dy[i] / d) * limit;
    }
  }

  return fit(nodes, xs, ys, width, height);
}

/**
 * Normalise into the frame with a margin.
 *
 * Fitting after the fact rather than clamping during the simulation: clamping
 * distorts the forces at the boundary, so nodes pile up along the edges and the
 * arrangement stops meaning anything.
 */
function fit(
  nodes: LayoutInput["nodes"],
  xs: number[],
  ys: number[],
  width: number,
  height: number,
): Placed[] {
  const margin = 22;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < nodes.length; i++) {
    minX = Math.min(minX, xs[i]);
    maxX = Math.max(maxX, xs[i]);
    minY = Math.min(minY, ys[i]);
    maxY = Math.max(maxY, ys[i]);
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const top = Math.max(...nodes.map((n) => n.score), 0);

  return nodes.map((n, i) => {
    const x = margin + ((xs[i] - minX) / spanX) * (width - margin * 2);
    const y = margin + ((ys[i] - minY) / spanY) * (height - margin * 2);
    return {
      id: n.id,
      // Two decimals, for the same reason `glyph.tsx` rounds: an unrounded
      // trigonometric result can differ in its last bits between the server
      // render and the client one, and React calls that a hydration mismatch.
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      band: bandFor(n.score, top),
      intensity: top > 0 ? Math.round(Math.min(1, n.score / top) * 1000) / 1000 : 0,
    };
  });
}
