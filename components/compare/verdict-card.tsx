"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Check, Coins, GitCompareArrows, Timer, Trophy } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { BAND_RGB } from "@/lib/compare/bands";
import { getModelById } from "@/lib/catalog";
import type { CompareRun } from "@/lib/compare/types";
import { springSoft } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The answer to "so what".
 *
 * The one orchestrated moment in the module: it rises once, settles, and is the
 * first thing on screen when a run finishes. Everything else in Compare is a
 * view onto the run; this is the run's conclusion.
 *
 * Three awards rather than one winner, because "which model is best" is three
 * different questions. A run where the same lane takes all three is a strong
 * result and looks like one; a run where they split is the more common and more
 * useful finding, and flattening it to a single rank would throw it away.
 */

export function VerdictCard({
  run,
  headlines,
  onOpenScores,
}: {
  run: CompareRun;
  headlines: string[];
  onOpenScores?: () => void;
}) {
  const reduced = useReducedMotion();
  const { synthesis, verdict } = run;
  const hasAwards = Boolean(verdict?.bestOverall || verdict?.bestValue || verdict?.fastestAcceptable);
  if (!synthesis?.answer && !hasAwards) return null;

  const nameOf = (laneId: string) => {
    const lane = run.lanes.find((l) => l.id === laneId);
    return getModelById(lane?.modelId ?? laneId)?.name ?? laneId;
  };
  const bandOf = (laneId: string) => run.lanes.find((l) => l.id === laneId)?.band ?? 0;

  return (
    <motion.section
      initial={reduced ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springSoft}
      className="rounded-2xl border border-action/25 bg-action/[0.07] p-5 shadow-glow"
      aria-label="Verdict"
    >
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <span className="grid size-6 place-items-center rounded-lg bg-action text-action-foreground">
          <GitCompareArrows className="size-3.5" />
        </span>
        <h2 className="font-display text-lg font-semibold tracking-tight">Verdict</h2>
        {run.stages.synthesis.modelId && (
          <span className="text-2xs text-muted-foreground">
            merged by {getModelById(run.stages.synthesis.modelId)?.name ?? run.stages.synthesis.modelId}
          </span>
        )}
      </header>

      {hasAwards && (
        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          <Award
            icon={Trophy}
            label="Best overall"
            laneId={verdict?.bestOverall}
            reason={verdict?.reasons}
            nameOf={nameOf}
            bandOf={bandOf}
            onClick={onOpenScores}
          />
          <Award
            icon={Coins}
            label="Best value"
            laneId={verdict?.bestValue}
            reason={verdict?.reasons}
            nameOf={nameOf}
            bandOf={bandOf}
            onClick={onOpenScores}
          />
          <Award
            icon={Timer}
            label="Fastest"
            laneId={verdict?.fastestAcceptable}
            reason={verdict?.reasons}
            nameOf={nameOf}
            bandOf={bandOf}
            onClick={onOpenScores}
          />
        </div>
      )}

      {synthesis?.answer ? (
        <Markdown>{synthesis.answer}</Markdown>
      ) : (
        <p className="text-sm text-muted-foreground">
          {run.stages.synthesis.status === "error"
            ? run.stages.synthesis.error
            : "The answers were not merged."}
        </p>
      )}

      {(synthesis?.agreements.length || synthesis?.divergences.length) && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {synthesis.agreements.length > 0 && (
            <Points
              tone="success"
              icon={Check}
              title="They agreed on"
              items={synthesis.agreements}
            />
          )}
          {synthesis.divergences.length > 0 && (
            <Points
              tone="amber"
              icon={AlertTriangle}
              title="They disagreed on"
              items={synthesis.divergences}
            />
          )}
        </div>
      )}

      {synthesis?.caveats && synthesis.caveats.length > 0 && (
        <p className="mt-3 text-2xs text-muted-foreground">
          <span className="uppercase tracking-legend">Least reliable</span> ·{" "}
          {synthesis.caveats.join(" · ")}
        </p>
      )}

      {headlines.length > 0 && (
        <ul className="mt-4 space-y-1 border-t border-action/20 pt-3">
          {headlines.map((line) => (
            <li key={line} className="flex gap-2 text-2xs text-muted-foreground">
              <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
              {line}
            </li>
          ))}
        </ul>
      )}
    </motion.section>
  );
}

function Award({
  icon: Icon,
  label,
  laneId,
  reason,
  nameOf,
  bandOf,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  laneId?: string;
  reason?: Record<string, string>;
  nameOf: (id: string) => string;
  bandOf: (id: string) => 0 | 1 | 2 | 3 | 4 | 5;
  onClick?: () => void;
}) {
  if (!laneId) {
    return (
      <div className="rounded-xl border border-dashed border-border px-3 py-2.5">
        <p className="text-2xs uppercase tracking-legend text-muted-foreground/70">{label}</p>
        {/* Saying nothing was awarded is more useful than omitting the slot and
            leaving the reader to wonder whether it was won. */}
        <p className="mt-0.5 text-sm text-muted-foreground">Not awarded</p>
      </div>
    );
  }
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "rounded-xl border border-border bg-surface/60 px-3 py-2.5 text-left transition-colors",
        onClick && "hover:border-border-strong",
      )}
    >
      <p className="flex items-center gap-1.5 text-2xs uppercase tracking-legend text-muted-foreground/70">
        <Icon className="size-3" />
        {label}
      </p>
      <p className="mt-0.5 flex items-center gap-1.5 text-sm font-medium">
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-[3px]"
          style={{ backgroundColor: BAND_RGB[bandOf(laneId)] }}
        />
        <span className="truncate">{nameOf(laneId)}</span>
      </p>
      {reason?.[laneId] && (
        <p className="mt-0.5 line-clamp-2 text-2xs text-muted-foreground">{reason[laneId]}</p>
      )}
    </button>
  );
}

function Points({
  tone,
  icon: Icon,
  title,
  items,
}: {
  tone: "success" | "amber";
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  items: string[];
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3.5",
        tone === "success" ? "border-success/25 bg-success/5" : "border-amber/25 bg-amber/5",
      )}
    >
      <p
        className={cn(
          "mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-legend",
          tone === "success" ? "text-success" : "text-amber",
        )}
      >
        <Icon className="size-3.5" />
        {title}
      </p>
      <ul className="space-y-1.5 text-sm">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span
              aria-hidden
              className={cn(
                "mt-1.5 size-1.5 shrink-0 rounded-full",
                tone === "success" ? "bg-success" : "bg-amber",
              )}
            />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
