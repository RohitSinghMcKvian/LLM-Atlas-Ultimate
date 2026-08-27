"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { bandFor, layout, type Placed } from "@/lib/graph/layout";
import type { GraphContext, RetrievedNode } from "@/lib/graph/retrieve";
import { EASE } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils";

/**
 * The survey map.
 *
 * The retrieved subgraph drawn the way this product draws everything else:
 * `app/globals.css` states the thesis outright - chrome carries exactly one hue
 * and anything plural-coloured is *data*, on the six-band elevation ramp. So a
 * node's band is not decoration, it is the measurement: retrieval score as
 * altitude, strongest evidence on the ridge (`--elev-4`), background context
 * down on the shelf (`--elev-1`).
 *
 * SVG rather than canvas, unlike the hero constellation. The constellation draws
 * hundreds of particles and needs none of them to be clickable; this draws at
 * most 120 and needs every one of them to be focusable, hit-testable and named
 * for a screen reader. All three are free here and would have to be rebuilt on a
 * canvas. Precedent: the ten hand-built diagrams in `components/learn/viz/`.
 *
 * Everything decided in this file is a render detail. The layout is
 * `lib/graph/layout.ts`, which is pure, deterministic and tested - the same
 * split `lib/canvas/field.ts` uses for the constellation.
 */

const WIDTH = 420;
const HEIGHT = 320;

export interface AtlasMapProps {
  context: GraphContext | null;
  /** Node id under the cursor or keyboard focus, lifted so the list can sync. */
  activeId?: string | null;
  onActive?: (id: string | null) => void;
  onOpen?: (node: RetrievedNode) => void;
  className?: string;
}

export function AtlasMap({ context, activeId, onActive, onOpen, className }: AtlasMapProps) {
  const reduced = usePrefersReducedMotion();

  const nodes = context?.scope.nodes ?? [];
  const placed = React.useMemo(() => {
    if (nodes.length === 0) return [];
    return layout({
      nodes: nodes.map((n) => ({ id: n.node.id, score: n.score, depth: n.depth })),
      edges: context?.scope.edges ?? [],
      width: WIDTH,
      height: HEIGHT,
      // Seeded on the question, so the same question always draws the same map
      // and a re-render never reshuffles it.
      seed: context?.query ?? context?.seeds.join("|"),
    });
  }, [nodes, context?.scope.edges, context?.query, context?.seeds]);

  const byId = React.useMemo(() => {
    const m = new Map<string, { node: RetrievedNode; at: Placed }>();
    placed.forEach((p, i) => m.set(p.id, { node: nodes[i], at: p }));
    return m;
  }, [placed, nodes]);

  if (!context || placed.length === 0) return <EmptyMap className={className} />;

  const top = Math.max(...nodes.map((n) => n.score), 0);

  return (
    <div className={cn("relative", className)}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full select-none"
        role="img"
        aria-label={`Survey map of ${placed.length} related facts for "${context.query}"`}
      >
        <defs>
          {/* The graticule, matching `.bg-graticule` - this is a survey sheet. */}
          <pattern id="atlas-map-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path
              d="M 24 0 L 0 0 0 24"
              fill="none"
              stroke="rgb(var(--border))"
              strokeWidth="0.5"
              opacity="0.7"
            />
          </pattern>
        </defs>
        <rect width={WIDTH} height={HEIGHT} fill="url(#atlas-map-grid)" />

        {/* Sight-lines first, so stations sit on top of them. */}
        <g>
          {(context.scope.edges ?? []).map((e, i) => {
            const a = byId.get(e.from);
            const b = byId.get(e.to);
            if (!a || !b) return null;
            const lit = activeId === e.from || activeId === e.to;
            return (
              <motion.line
                key={`${e.from}|${e.kind}|${e.to}`}
                x1={a.at.x}
                y1={a.at.y}
                x2={b.at.x}
                y2={b.at.y}
                stroke={lit ? "rgb(var(--action))" : "rgb(var(--border-strong))"}
                strokeWidth={lit ? 1.2 : 0.6}
                initial={reduced ? false : { pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: lit ? 0.9 : 0.35 }}
                transition={
                  reduced
                    ? { duration: 0 }
                    : { duration: 0.5, delay: Math.min(i * 0.006, 0.4), ease: EASE }
                }
              />
            );
          })}
        </g>

        <g>
          {placed.map((p, i) => {
            const item = nodes[i];
            const active = activeId === p.id;
            const radius = 3 + p.intensity * 4;
            return (
              <g key={p.id}>
                <motion.circle
                  cx={p.x}
                  cy={p.y}
                  r={radius}
                  fill={`rgb(var(--elev-${p.band}))`}
                  initial={reduced ? false : { scale: 0, opacity: 0, y: 6 }}
                  animate={{ scale: 1, opacity: 0.35 + p.intensity * 0.65, y: 0 }}
                  transition={
                    reduced
                      ? { duration: 0 }
                      : { duration: 0.45, delay: Math.min(i * 0.012, 0.5), ease: EASE }
                  }
                  style={{ originX: `${p.x}px`, originY: `${p.y}px` }}
                />
                {active && (
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={radius + 5}
                    fill="none"
                    stroke="rgb(var(--action))"
                    strokeWidth="1.2"
                  />
                )}
                {/* The hit target and the accessible name. A 3px dot is not a
                    control; this is. */}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={11}
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-label={`${item.node.label}. ${item.node.summary}`}
                  className="cursor-pointer outline-none focus-visible:stroke-[rgb(var(--ring))] focus-visible:[stroke-width:2]"
                  onMouseEnter={() => onActive?.(p.id)}
                  onMouseLeave={() => onActive?.(null)}
                  onFocus={() => onActive?.(p.id)}
                  onBlur={() => onActive?.(null)}
                  onClick={() => onOpen?.(item)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen?.(item);
                    }
                  }}
                />
              </g>
            );
          })}
        </g>
      </svg>

      <Legend top={top} />

      {/*
        The same information as a table, off-screen.
        A picture must never be the only way to get the facts, and a survey map
        is exactly the kind of thing that would otherwise be.
      */}
      <table className="sr-only">
        <caption>Facts retrieved for {context.query || "this question"}</caption>
        <thead>
          <tr>
            <th>Name</th>
            <th>What it is</th>
            <th>Relevance band</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => (
            <tr key={n.node.id}>
              <td>{n.node.label}</td>
              <td>{n.node.summary}</td>
              <td>{bandFor(n.score, top)} of 5</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The ramp, named.
 *
 * `components/landing/proof-strip.tsx` already established that this ramp gets a
 * legend rather than a caption, in letterspaced mono. Reusing the treatment
 * means a reader who has seen one recognises the other.
 */
function Legend({ top }: { top: number }) {
  if (top <= 0) return null;
  return (
    <div className="mt-2 flex items-center gap-2 px-1">
      <span className="font-mono text-2xs uppercase tracking-legend text-muted-foreground">
        Context
      </span>
      <span className="h-1.5 flex-1 rounded-full bg-gradient-elevation opacity-80" />
      <span className="font-mono text-2xs uppercase tracking-legend text-muted-foreground">
        Evidence
      </span>
    </div>
  );
}

function EmptyMap({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-border bg-surface/40 p-6 text-center",
        className,
      )}
    >
      <p className="text-sm text-foreground">Nothing surveyed yet</p>
      <p className="mt-1 max-w-[34ch] text-2xs text-muted-foreground">
        Name a model, a benchmark or a price and Atlas will map what it knows and how it connects.
      </p>
    </div>
  );
}
