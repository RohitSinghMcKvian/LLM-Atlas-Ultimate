import { clamp } from "@/lib/utils";

/**
 * Framework-free math for the constellation particle field.
 *
 * Lives in `lib/` (rather than beside the component) so it runs under the
 * node-environment vitest config — the canvas shell itself is exercised through
 * the app, but the geometry that decides how the field *feels* is pure and
 * worth pinning down with tests.
 */

export type RGB = readonly [number, number, number];

export interface FieldPoint {
  x: number;
  y: number;
}

/** Viewport class. Phones get a sparser field so the mesh stays legible. */
export type FieldTier = "compact" | "full";

// The floor matters more than the ceiling: below roughly this many nodes the
// mesh stops linking up and reads as scattered dust rather than a network.
const MIN_NODES = 28;
const MAX_NODES = 110;

/** `compact` below the Tailwind `sm` breakpoint. */
export function tierFor(width: number): FieldTier {
  return width < 640 ? "compact" : "full";
}

/**
 * Node count for a canvas of `w`×`h` CSS pixels.
 *
 * The full-tier divisor is deliberately denser than a plain area/22000 — the
 * mesh reads as a *network* rather than scattered dust — but the clamp keeps
 * the edge pass bounded no matter how large the viewport gets.
 */
export function nodeCount(
  w: number,
  h: number,
  density = 1,
  tier: FieldTier = "full",
): number {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return MIN_NODES;
  }
  const divisor = tier === "compact" ? 26000 : 18000;
  const raw = Math.round(((w * h) / divisor) * density);
  return clamp(raw, MIN_NODES, MAX_NODES);
}

/** Distance under which two nodes are wired together. */
export function linkDistance(w: number): number {
  if (!Number.isFinite(w) || w <= 0) return 110;
  return clamp(w / 7.5, 110, 190);
}

/**
 * The pointer's influence on a single node.
 *
 * `dx`/`dy` point *from the node toward the pointer*. The returned vector uses
 * the same convention: positive pulls the node toward the pointer, negative
 * pushes it away.
 *
 * Inside `rInner` the node is repelled, which carves a visible void under the
 * cursor; between `rInner` and `rOuter` it is drawn inward, which packs a
 * brighter halo around the rim of that void. Both terms vanish at `rInner`, so
 * the field is continuous across the sign flip and never snaps.
 */
export function cursorForce(
  dx: number,
  dy: number,
  rInner: number,
  rOuter: number,
): { fx: number; fy: number } {
  const dist = Math.hypot(dx, dy);
  if (dist <= 0 || dist >= rOuter || rInner <= 0 || rOuter <= rInner) {
    return { fx: 0, fy: 0 };
  }

  const ux = dx / dist;
  const uy = dy / dist;

  let magnitude: number;
  if (dist < rInner) {
    // Linear falloff. A squared curve reads as a dent rather than a void —
    // the push has to stay strong most of the way out to `rInner`.
    magnitude = -(1 - dist / rInner);
  } else {
    const t = (dist - rInner) / (rOuter - rInner);
    // Peaks mid-band so the halo sits off the rim of the void, not on it.
    magnitude = Math.sin(Math.PI * t) * 0.45;
  }

  return { fx: ux * magnitude, fy: uy * magnitude };
}

/** An axis-aligned region of the field, in canvas CSS pixels. */
export interface FieldRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A whole rectangle's influence on a node — the panel equivalent of
 * `cursorForce`, and deliberately built on it so both obey the same falloff.
 *
 * Outside the rect, the delta runs to the nearest point on it, so the void and
 * halo wrap the shape instead of radiating from a centre: nodes bunch into a
 * ridge along the edge rather than forming a circle that ignores the geometry.
 *
 * Inside the rect, the nearest point *is* the node, which would read as zero
 * force and leave the interior full. So an interior node is given a unit delta
 * pointing at the far side of its nearest edge; `cursorForce`'s repel term then
 * pushes it out the short way at almost full strength. Aiming at the rect's
 * centre instead would fail on a tall panel, where the centre can sit further
 * away than `rOuter` and produce no force at all.
 *
 * `attract` replaces the whole profile with a plain inward pull — the one-shot
 * "converge" gesture. It is not the repel field negated: negating would keep the
 * halo band's sign flip and push the mid-range nodes *away* at the exact moment
 * everything is supposed to be gathering in.
 */
export function rectForce(
  px: number,
  py: number,
  rect: FieldRect,
  rInner: number,
  rOuter: number,
  attract = false,
): { fx: number; fy: number } {
  if (rect.w <= 0 || rect.h <= 0) return { fx: 0, fy: 0 };

  const left = rect.x;
  const right = rect.x + rect.w;
  const top = rect.y;
  const bottom = rect.y + rect.h;

  const inside = px >= left && px <= right && py >= top && py <= bottom;

  if (attract) {
    // Already gathered — nothing left to pull.
    if (inside) return { fx: 0, fy: 0 };
    const ax = clamp(px, left, right) - px;
    const ay = clamp(py, top, bottom) - py;
    const dist = Math.hypot(ax, ay);
    if (dist <= 0 || dist >= rOuter) return { fx: 0, fy: 0 };
    const magnitude = (1 - dist / rOuter) * 0.6;
    return { fx: (ax / dist) * magnitude, fy: (ay / dist) * magnitude };
  }

  let dx: number;
  let dy: number;

  if (inside) {
    const dl = px - left;
    const dr = right - px;
    const dt = py - top;
    const db = bottom - py;
    const nearest = Math.min(dl, dr, dt, db);
    // Unit vector pointing *into* the rect, away from the closest edge.
    if (nearest === dl) [dx, dy] = [1, 0];
    else if (nearest === dr) [dx, dy] = [-1, 0];
    else if (nearest === dt) [dx, dy] = [0, 1];
    else [dx, dy] = [0, -1];
  } else {
    dx = clamp(px, left, right) - px;
    dy = clamp(py, top, bottom) - py;
  }

  return cursorForce(dx, dy, rInner, rOuter);
}

/** Bucketed points, keyed by cell. Rebuilt once per frame. */
export interface FieldGrid {
  cell: number;
  buckets: Map<number, number[]>;
}

// Cell coordinates are packed into a single number. Safe while |cx|,|cy| stay
// under KEY_OFFSET, i.e. any canvas smaller than ~16k cells on a side.
const KEY_OFFSET = 1 << 14;
const KEY_STRIDE = 1 << 15;

function cellKey(cx: number, cy: number): number {
  return (cx + KEY_OFFSET) * KEY_STRIDE + (cy + KEY_OFFSET);
}

/** Spatial hash so the edge pass is O(n) in practice instead of O(n²). */
export function buildGrid(points: readonly FieldPoint[], cell: number): FieldGrid {
  const size = Math.max(1, cell);
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const key = cellKey(Math.floor(p.x / size), Math.floor(p.y / size));
    const bucket = buckets.get(key);
    if (bucket) bucket.push(i);
    else buckets.set(key, [i]);
  }
  return { cell: size, buckets };
}

// Half of the 8-neighbourhood. Walking only these, plus the same-cell entries
// that come after `index`, visits every near pair exactly once.
const FORWARD_CELLS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/**
 * Candidate partners for `points[index]`, written into `out` (reused across
 * calls to keep the render loop allocation-free). Every pair closer than
 * `grid.cell` is yielded exactly once across a full sweep of `index`.
 */
export function forwardNeighbors(
  grid: FieldGrid,
  points: readonly FieldPoint[],
  index: number,
  out: number[] = [],
): number[] {
  out.length = 0;
  const p = points[index];
  if (!p) return out;

  const cx = Math.floor(p.x / grid.cell);
  const cy = Math.floor(p.y / grid.cell);

  const own = grid.buckets.get(cellKey(cx, cy));
  if (own) {
    for (const j of own) {
      if (j > index) out.push(j);
    }
  }

  for (const [ox, oy] of FORWARD_CELLS) {
    const bucket = grid.buckets.get(cellKey(cx + ox, cy + oy));
    if (!bucket) continue;
    for (const j of bucket) out.push(j);
  }

  return out;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Channel-wise blend of two RGB triplets. */
export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  const k = clamp(t, 0, 1);
  return [
    Math.round(lerp(a[0], b[0], k)),
    Math.round(lerp(a[1], b[1], k)),
    Math.round(lerp(a[2], b[2], k)),
  ];
}

/** Canvas-ready colour string. */
export function rgba(c: RGB, alpha: number): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${clamp(alpha, 0, 1)})`;
}
