"use client";

import * as React from "react";
import { Download, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BAND_RGB } from "@/lib/compare/bands";
import { rankByScore } from "@/lib/compare/judge";
import { getModelById } from "@/lib/catalog";
import type { CompareRun } from "@/lib/compare/types";
import { cn, formatUSD } from "@/lib/utils";

/**
 * How each answer scored, and what it cost to get there.
 *
 * Grouped horizontal bars with the value always visible — the accessible form for
 * comparing a handful of entities across a handful of criteria, and readable
 * without hovering. A radar chart looks more impressive and is worse: it needs a
 * legend, it hides precise values, and it is unreadable past three series.
 *
 * The judge is named next to the scores. A score whose author is anonymous is a
 * number nobody can argue with, which is the opposite of what a comparison tool
 * should produce.
 */

export function Scorecard({ run }: { run: CompareRun }) {
  const criteria = run.brief?.rubric.criteria ?? [];
  const scores = run.scores ?? [];
  const analysis = run.analysis;

  const nameOf = React.useCallback(
    (laneId: string) => {
      const lane = run.lanes.find((l) => l.id === laneId);
      return getModelById(lane?.modelId ?? laneId)?.name ?? laneId;
    },
    [run.lanes],
  );
  const bandOf = React.useCallback(
    (laneId: string) => run.lanes.find((l) => l.id === laneId)?.band ?? 0,
    [run.lanes],
  );

  const exportCsv = React.useCallback(() => {
    const header = ["model", "total", ...criteria.map((c) => c.name), "cost_usd", "ms", "tokens"];
    const rows = rankByScore(scores).map((s) => {
      const m = analysis?.lanes[s.laneId]?.metrics;
      return [
        nameOf(s.laneId),
        s.total,
        ...criteria.map((c) => s.scores[c.id] ?? ""),
        m?.costUsd ?? "",
        m?.totalMs ?? "",
        (m?.promptTokens ?? 0) + (m?.completionTokens ?? 0),
      ];
    });
    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `compare-${run.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [analysis, criteria, nameOf, run.id, scores]);

  if (scores.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        {run.stages.analyse.note ?? "No scores yet."}
      </p>
    );
  }

  const ranked = rankByScore(scores);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-2xs uppercase tracking-legend text-muted-foreground/70">Scores</span>
        {run.stages.analyse.modelId && (
          <span className="flex items-center gap-1 text-2xs text-muted-foreground">
            <Info className="size-3" />
            judged by {getModelById(run.stages.analyse.modelId)?.name ?? run.stages.analyse.modelId}
          </span>
        )}
        <button
          onClick={exportCsv}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2/60 px-2.5 py-1 text-2xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
        >
          <Download className="size-3.5" /> CSV
        </button>
      </header>

      {/* Overall, largest first. */}
      <ol className="space-y-2">
        {ranked.map((score) => {
          const metrics = analysis?.lanes[score.laneId]?.metrics;
          return (
            <li key={score.laneId} className="rounded-xl border border-border bg-surface/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-[3px]"
                  style={{ backgroundColor: BAND_RGB[bandOf(score.laneId)] }}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {nameOf(score.laneId)}
                </span>
                <span className="font-mono text-sm tabular-nums">{score.total.toFixed(1)}</span>
                <span className="font-mono text-2xs tabular-nums text-muted-foreground">
                  {metrics?.costUnknown ? "—" : formatUSD(metrics?.costUsd ?? 0, { precise: true })}
                  {metrics?.totalMs ? ` · ${(metrics.totalMs / 1000).toFixed(1)}s` : ""}
                </span>
              </div>

              <Bar value={score.total} max={10} band={bandOf(score.laneId)} className="mt-2" />

              {criteria.length > 0 && (
                <dl className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
                  {criteria.map((c) => (
                    <div key={c.id} className="flex items-center gap-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <dt className="w-28 shrink-0 cursor-help truncate text-2xs text-muted-foreground">
                            {c.name}
                          </dt>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-56">
                          {c.description} · {(c.weight * 100).toFixed(0)}% of the total
                        </TooltipContent>
                      </Tooltip>
                      <dd className="flex min-w-0 flex-1 items-center gap-2">
                        <Bar
                          value={score.scores[c.id] ?? 0}
                          max={10}
                          band={bandOf(score.laneId)}
                          className="flex-1"
                          subtle
                        />
                        <span className="w-6 shrink-0 text-right font-mono text-2xs tabular-nums text-muted-foreground">
                          {(score.scores[c.id] ?? 0).toFixed(0)}
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              {score.justification && (
                <p className="mt-2 text-2xs text-muted-foreground">{score.justification}</p>
              )}

              {score.unsupported.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {score.unsupported.map((claim) => (
                    <li key={claim} className="flex gap-1.5 text-2xs text-amber">
                      <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-amber" />
                      Unsupported: {claim}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Bar({
  value,
  max,
  band,
  className,
  subtle,
}: {
  value: number;
  max: number;
  band: 0 | 1 | 2 | 3 | 4 | 5;
  className?: string;
  subtle?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className={cn("h-1.5 overflow-hidden rounded-full bg-surface-3", subtle && "h-1", className)}
      role="img"
      aria-label={`${value.toFixed(1)} out of ${max}`}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${pct}%`, backgroundColor: BAND_RGB[band], opacity: subtle ? 0.6 : 1 }}
      />
    </div>
  );
}
