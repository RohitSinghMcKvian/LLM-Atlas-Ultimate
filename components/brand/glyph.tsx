"use client";

import * as React from "react";
import { ACCENT_RGB, type Accent } from "@/lib/accent";
import { cn } from "@/lib/utils";

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A closed contour ring, as a cubic through four points on a wobbled circle.
 * `smooth` is the Catmull-Rom-ish tension that keeps the loop organic without
 * letting it self-intersect.
 */
/**
 * Coordinates are rounded before they reach the path string.
 *
 * `Math.cos` and `Math.sin` are not required by the spec to be correctly
 * rounded, and Node and the browser's V8 disagree in the last bit or two — so
 * an unrounded path serialises differently on the server and the client, and
 * React reports a hydration mismatch on every glyph. Two decimals is well below
 * a pixel in this 100-unit viewBox and makes the markup deterministic.
 */
const r2 = (n: number) => Math.round(n * 100) / 100;

function ring(cx: number, cy: number, radii: number[], smooth = 0.55) {
  const n = radii.length;
  const pt = (i: number) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = radii[((i % n) + n) % n];
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const;
  };
  let d = "";
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pt(i);
    const [x1, y1] = pt(i + 1);
    const [px, py] = pt(i - 1);
    const [nx, ny] = pt(i + 2);
    const c1x = x0 + ((x1 - px) / 6) * smooth * 2;
    const c1y = y0 + ((y1 - py) / 6) * smooth * 2;
    const c2x = x1 - ((nx - x0) / 6) * smooth * 2;
    const c2y = y1 - ((ny - y0) / 6) * smooth * 2;
    d += i === 0 ? `M ${r2(x0)} ${r2(y0)} ` : "";
    d += `C ${r2(c1x)} ${r2(c1y)}, ${r2(c2x)} ${r2(c2y)}, ${r2(x1)} ${r2(y1)} `;
  }
  return `${d}Z`;
}

/**
 * Bespoke contour signature, deterministic per module id — so every module gets
 * an owned mark rather than a stock icon, and every mark is the same kind of
 * object as the logo: a set of nested contours around a high point.
 *
 * The seed decides how many bands there are, how eccentric each one is, and
 * where the summit sits inside the frame, so no two modules share a landform.
 */
export function ModuleGlyph({
  seed,
  accent = "ridge",
  size = 48,
  className,
  animated = false,
}: {
  seed: string;
  accent?: Accent;
  size?: number;
  className?: string;
  animated?: boolean;
}) {
  const color = ACCENT_RGB[accent];

  const { rings, summit } = React.useMemo(() => {
    const rng = mulberry32(seedFrom(seed));
    const cx = 42 + rng() * 16;
    const cy = 42 + rng() * 16;
    const count = 3 + Math.floor(rng() * 2); // 3–4 bands
    const lobes = 6 + Math.floor(rng() * 3); // 6–8 control points

    // One shared set of per-lobe biases, scaled per band. Sharing them is what
    // makes the bands look like slices of a single hill rather than a stack of
    // unrelated blobs — a contour map's rings are always roughly concentric.
    const bias = Array.from({ length: lobes }, () => 0.78 + rng() * 0.44);

    const out: string[] = [];
    for (let b = 0; b < count; b++) {
      const base = 34 - b * (26 / count);
      out.push(ring(cx, cy, bias.map((k) => base * k)));
    }
    return { rings: out, summit: { cx, cy } };
  }, [seed]);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      className={cn(animated && "animate-float", className)}
      aria-hidden="true"
    >
      {rings.map((d, i) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke={i === rings.length - 1 ? color : "currentColor"}
          strokeWidth={i === rings.length - 1 ? 2 : 1.5}
          strokeOpacity={i === rings.length - 1 ? 1 : r2(0.22 + i * 0.12)}
          strokeLinejoin="round"
        />
      ))}
      <circle cx={r2(summit.cx)} cy={r2(summit.cy)} r={3.2} fill={color} />
    </svg>
  );
}
