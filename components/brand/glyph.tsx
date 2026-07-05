"use client";

import * as React from "react";
import { ACCENT_HEX, type Accent } from "@/lib/modules";
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
 * Bespoke constellation glyph, deterministic per module id — so every module
 * gets an owned mark rather than a stock icon.
 */
export function ModuleGlyph({
  seed,
  accent = "cyan",
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
  const id = React.useId().replace(/:/g, "");
  const color = ACCENT_HEX[accent];

  const { points, edges } = React.useMemo(() => {
    const rng = mulberry32(seedFrom(seed));
    const n = 5 + Math.floor(rng() * 2); // 5–6 nodes
    const pts: { x: number; y: number; r: number }[] = [];
    for (let i = 0; i < n; i++) {
      pts.push({
        x: 14 + rng() * 72,
        y: 14 + rng() * 72,
        r: 1.4 + rng() * 1.8,
      });
    }
    // connect each node to its nearest unconnected neighbor (a tree) + 1 loop
    const eds: [number, number][] = [];
    for (let i = 1; i < pts.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let j = 0; j < i; j++) {
        const d = (pts[i].x - pts[j].x) ** 2 + (pts[i].y - pts[j].y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      eds.push([best, i]);
    }
    eds.push([pts.length - 1, 0]);
    return { points: pts, edges: eds };
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
      <defs>
        <linearGradient id={`mg-${id}`} x1="0" y1="0" x2="100" y2="100">
          <stop offset="0%" stopColor={color} stopOpacity="0.95" />
          <stop offset="100%" stopColor="#7C3AED" stopOpacity="0.7" />
        </linearGradient>
      </defs>
      <g stroke={`url(#mg-${id})`} strokeWidth="1.25" strokeLinecap="round">
        {edges.map(([a, b], i) => (
          <line
            key={i}
            x1={points[a].x}
            y1={points[a].y}
            x2={points[b].x}
            y2={points[b].y}
            opacity={0.55}
          />
        ))}
      </g>
      <g fill={`url(#mg-${id})`}>
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={p.r} />
        ))}
      </g>
    </svg>
  );
}
