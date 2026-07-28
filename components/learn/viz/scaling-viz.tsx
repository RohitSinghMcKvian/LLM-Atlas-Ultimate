"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import {
  blendedPrice,
  intelligenceIndex,
  modelAccess,
  routableModels,
  type CatalogModel,
} from "@/lib/catalog";
import { useCatalogSnapshot } from "@/lib/hooks/use-catalog-snapshot";
import { VizFrame, VizToggle } from "./frame";
import { cn } from "@/lib/utils";

/**
 * The cost-capability frontier, drawn from the live catalog.
 *
 * Deliberately not seeded data: the lesson's claim is that most of the catalog
 * is dominated on both axes, and it should be checkable against the same models
 * the rest of Atlas is showing. Price is log-scaled because the catalog spans
 * three orders of magnitude and a linear axis collapses the cheap half into the
 * left margin — where most of the interesting choices live.
 */

const W = 520;
const H = 290;
const PAD = { l: 44, r: 14, t: 14, b: 34 };

interface Point {
  model: CatalogModel;
  price: number;
  quality: number;
  x: number;
  y: number;
  onFrontier: boolean;
}

/** Pareto-optimal set: nothing is both cheaper and better. */
export function frontierOf(
  points: { price: number; quality: number }[],
): boolean[] {
  return points.map((p, i) =>
    points.every(
      (q, j) => i === j || !(q.price <= p.price && q.quality >= p.quality && (q.price < p.price || q.quality > p.quality)),
    ),
  );
}

export function ScalingViz() {
  const snapshot = useCatalogSnapshot();
  const [filter, setFilter] = React.useState<"all" | "free" | "byok">("all");
  const [hover, setHover] = React.useState<string | null>(null);

  const points: Point[] = React.useMemo(() => {
    const models = routableModels()
      .filter((m) => m.status !== "upcoming")
      .filter((m) => (filter === "all" ? true : modelAccess(m) === filter))
      .map((m) => ({
        model: m,
        price: Math.max(blendedPrice(m), 0.01),
        quality: intelligenceIndex(m),
      }))
      .filter((p) => p.quality > 0);

    if (models.length === 0) return [];

    const prices = models.map((m) => Math.log10(m.price));
    const minX = Math.min(...prices);
    const maxX = Math.max(...prices);
    const qualities = models.map((m) => m.quality);
    const minY = Math.min(...qualities) - 3;
    const maxY = Math.max(...qualities) + 3;

    const flags = frontierOf(models);
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;

    return models.map((m, i) => ({
      ...m,
      x: PAD.l + ((Math.log10(m.price) - minX) / spanX) * (W - PAD.l - PAD.r),
      y: H - PAD.b - ((m.quality - minY) / spanY) * (H - PAD.t - PAD.b),
      onFrontier: flags[i],
    }));
    // `snapshot` is the dependency that matters: the selectors read the
    // installed catalog, so a catalog swap must recompute the scatter.
  }, [filter, snapshot]);

  const frontier = React.useMemo(
    () => points.filter((p) => p.onFrontier).sort((a, b) => a.x - b.x),
    [points],
  );

  const active = points.find((p) => p.model.id === hover) ?? frontier[frontier.length - 1];

  if (points.length === 0) {
    return (
      <VizFrame label="Cost–capability frontier">
        <p className="py-6 text-center text-xs text-muted-foreground">
          No routable models in the current catalog snapshot.
        </p>
      </VizFrame>
    );
  }

  return (
    <VizFrame
      label="Cost–capability frontier"
      hint={`${points.length} routable models`}
      controls={
        <VizToggle
          ariaLabel="Access filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "free", label: "Free" },
            { value: "byok", label: "BYOK" },
          ]}
        />
      }
      footer="Quality is Atlas's intelligence index (mean of MMLU, GPQA, HumanEval, MATH). Price is blended at a 3:1 input:output ratio. Both are approximations — use them to shortlist, not to decide."
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full rounded-lg border border-border bg-[rgb(var(--surface-2))]"
        role="img"
        aria-label={`Scatter of ${points.length} models by price and quality; ${frontier.length} on the frontier.`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = PAD.t + f * (H - PAD.t - PAD.b);
          return (
            <line
              key={f}
              x1={PAD.l}
              y1={y}
              x2={W - PAD.r}
              y2={y}
              stroke="rgb(var(--border))"
              strokeDasharray="2 6"
            />
          );
        })}

        {/* The frontier itself. */}
        <polyline
          points={frontier.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="rgb(var(--cyan))"
          strokeWidth={1.5}
          strokeOpacity={0.6}
          strokeDasharray="5 3"
        />

        {points.map((p) => {
          const isActive = active?.model.id === p.model.id;
          return (
            <circle
              key={p.model.id}
              cx={p.x}
              cy={p.y}
              r={isActive ? 6 : p.onFrontier ? 4.5 : 3}
              fill={
                p.onFrontier
                  ? "rgb(var(--cyan))"
                  : "rgb(var(--muted-foreground))"
              }
              fillOpacity={p.onFrontier ? 0.95 : 0.35}
              stroke={isActive ? "rgb(var(--foreground))" : "none"}
              strokeWidth={1.5}
              className="cursor-pointer"
              onMouseEnter={() => setHover(p.model.id)}
              onFocus={() => setHover(p.model.id)}
              tabIndex={0}
              role="button"
              aria-label={`${p.model.name}, quality ${p.quality.toFixed(0)}, $${p.price.toFixed(2)} per million blended`}
            >
              <title>{p.model.name}</title>
            </circle>
          );
        })}

        <text x={PAD.l} y={H - 10} fontSize={9} fill="rgb(var(--muted-foreground))">
          cheaper →
        </text>
        <text
          x={W - PAD.r}
          y={H - 10}
          fontSize={9}
          textAnchor="end"
          fill="rgb(var(--muted-foreground))"
        >
          blended $/M (log)
        </text>
        <text
          x={12}
          y={PAD.t + 8}
          fontSize={9}
          fill="rgb(var(--muted-foreground))"
          transform={`rotate(-90 12 ${PAD.t + 8})`}
        >
          quality →
        </text>
      </svg>

      {active && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-surface-2/50 px-2.5 py-2">
          <span className="text-xs font-semibold">{active.model.name}</span>
          <span
            className={cn(
              "rounded-full border px-1.5 py-0.5 text-[10px]",
              active.onFrontier
                ? "border-cyan/40 bg-cyan/10 text-cyan"
                : "border-border text-muted-foreground",
            )}
          >
            {active.onFrontier ? "on the frontier" : "dominated"}
          </span>
          <span className="font-mono text-2xs text-muted-foreground">
            quality {active.quality.toFixed(0)} · ${active.price.toFixed(2)}/M
          </span>
          <Link
            href={`/leaderboard?model=${active.model.id}`}
            className="ml-auto inline-flex items-center gap-0.5 text-2xs text-cyan hover:underline"
          >
            Leaderboard <ArrowUpRight className="size-3" />
          </Link>
        </div>
      )}
    </VizFrame>
  );
}
