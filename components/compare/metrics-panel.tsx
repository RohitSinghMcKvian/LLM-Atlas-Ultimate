"use client";

import * as React from "react";
import { BAND_RGB } from "@/lib/compare/bands";
import { getModelById } from "@/lib/catalog";
import type { CompareRun } from "@/lib/compare/types";
import { cn, formatUSD } from "@/lib/utils";

/**
 * Everything the deterministic pass measured.
 *
 * Free, so it is here on every depth including Quick, where the judge never ran
 * and this is the only quantitative view of the run.
 *
 * The similarity heatmap is the panel worth the space: it answers "did asking
 * three models buy me anything" with a number rather than an impression. Two
 * answers that converge mean the result is stable; one that diverges is either
 * the insight or the mistake, and either way it is where to read first.
 */

export function MetricsPanel({ run }: { run: CompareRun }) {
  const analysis = run.analysis;
  if (!analysis) {
    return (
      <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Nothing measured yet.
      </p>
    );
  }

  const nameOf = (laneId: string) => {
    const lane = run.lanes.find((l) => l.id === laneId);
    return getModelById(lane?.modelId ?? laneId)?.name ?? laneId;
  };
  const bandOf = (laneId: string) => run.lanes.find((l) => l.id === laneId)?.band ?? 0;
  const ids = Object.keys(analysis.similarity.matrix);

  return (
    <div className="space-y-6">
      {ids.length > 1 && (
        <section>
          <Heading>
            Overlap
            <Note>
              {analysis.similarity.clusters.length === 1
                ? "Every answer covered the same ground."
                : analysis.similarity.outlier
                  ? `${nameOf(analysis.similarity.outlier)} took a different line.`
                  : `${analysis.similarity.clusters.length} distinct lines of argument.`}{" "}
              Mean similarity {analysis.similarity.consensus.toFixed(2)}.
            </Note>
          </Heading>
          <div className="overflow-x-auto">
            <table className="text-2xs">
              <tbody>
                {ids.map((rowId) => (
                  <tr key={rowId}>
                    <th
                      scope="row"
                      className="whitespace-nowrap py-1 pr-3 text-right font-normal text-muted-foreground"
                    >
                      {nameOf(rowId)}
                    </th>
                    {ids.map((colId) => {
                      const v = analysis.similarity.matrix[rowId]?.[colId] ?? 0;
                      const self = rowId === colId;
                      return (
                        <td key={colId} className="p-0.5">
                          <div
                            title={`${nameOf(rowId)} vs ${nameOf(colId)}: ${v.toFixed(2)}`}
                            className={cn(
                              "grid h-8 w-14 place-items-center rounded font-mono tabular-nums",
                              self && "opacity-30",
                            )}
                            style={{
                              // Opacity carries the value; the hue carries the
                              // row's identity, so the grid still reads as a set
                              // of lanes rather than an anonymous matrix.
                              backgroundColor: BAND_RGB[bandOf(rowId)],
                              opacity: self ? 0.15 : 0.12 + v * 0.6,
                            }}
                          >
                            <span className="text-foreground">{v.toFixed(2)}</span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <td />
                  {ids.map((colId) => (
                    <td key={colId} className="max-w-14 truncate px-1 pt-1 text-center text-muted-foreground">
                      {nameOf(colId)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <Heading>Per model</Heading>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-2xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <Th align="left">Model</Th>
                <Th>Words</Th>
                <Th>Grade</Th>
                <Th title="Negative means hedged, positive means committed">Commitment</Th>
                <Th title="Distinct sources cited">Cited</Th>
                <Th>TTFT</Th>
                <Th>Speed</Th>
                <Th>Cost</Th>
              </tr>
            </thead>
            <tbody>
              {run.lanes.map((lane) => {
                const a = analysis.lanes[lane.id];
                if (!a) return null;
                return (
                  <tr key={lane.id} className="border-b border-border/60 last:border-0">
                    <td className="py-1.5 pr-3">
                      <span className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="size-2 shrink-0 rounded-[3px]"
                          style={{ backgroundColor: BAND_RGB[lane.band] }}
                        />
                        <span className="truncate">{nameOf(lane.id)}</span>
                      </span>
                    </td>
                    <Td>{a.text.length.words || "—"}</Td>
                    <Td>{a.text.length.words ? a.text.length.gradeLevel.toFixed(1) : "—"}</Td>
                    <Td
                      className={cn(
                        a.text.hedging.commitment < -0.3 && "text-muted-foreground",
                        a.text.hedging.commitment > 0.3 && "text-foreground",
                      )}
                    >
                      {a.text.length.words ? a.text.hedging.commitment.toFixed(2) : "—"}
                    </Td>
                    <Td className={cn(a.citations.fabricated.length > 0 && "text-amber")}>
                      {a.citations.cited.length || "—"}
                      {a.citations.fabricated.length > 0 && (
                        <span title={`Invented ${a.citations.fabricated.map((n) => `[${n}]`).join(", ")}`}>
                          {" "}
                          +{a.citations.fabricated.length}!
                        </span>
                      )}
                    </Td>
                    <Td>{a.metrics.ttftMs ? `${(a.metrics.ttftMs / 1000).toFixed(1)}s` : "—"}</Td>
                    <Td>{a.metrics.throughput ? `${a.metrics.throughput} t/s` : "—"}</Td>
                    <Td>
                      {a.metrics.costUnknown ? "—" : formatUSD(a.metrics.costUsd, { precise: true })}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {analysis.frontier.length > 1 && (
        <section>
          <Heading>
            Value
            <Note>
              A model is dominated when another scored at least as well for no more money.
            </Note>
          </Heading>
          <ul className="space-y-1.5">
            {[...analysis.frontier]
              .sort((a, b) => b.score - a.score)
              .map((p) => (
                <li
                  key={p.laneId}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-2xs",
                    p.efficient
                      ? "border-border bg-surface/50"
                      : "border-dashed border-border text-muted-foreground",
                  )}
                >
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-[3px]"
                    style={{ backgroundColor: BAND_RGB[bandOf(p.laneId)] }}
                  />
                  <span className="min-w-0 flex-1 truncate">{nameOf(p.laneId)}</span>
                  <span className="font-mono tabular-nums">{p.score.toFixed(1)}</span>
                  <span className="font-mono tabular-nums">
                    {formatUSD(p.costUsd, { precise: true })}
                  </span>
                  <span className="w-20 shrink-0 text-right">
                    {p.efficient ? "best available" : "dominated"}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 flex flex-wrap items-baseline gap-x-2 text-2xs uppercase tracking-legend text-muted-foreground/70">
      {children}
    </h3>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <span className="normal-case tracking-normal text-muted-foreground">{children}</span>;
}

function Th({
  children,
  align = "right",
  title,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  title?: string;
}) {
  return (
    <th
      title={title}
      scope="col"
      className={cn("py-1.5 font-normal", align === "left" ? "pr-3 text-left" : "px-2 text-right")}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-2 py-1.5 text-right font-mono tabular-nums", className)}>{children}</td>;
}
