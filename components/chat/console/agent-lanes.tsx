"use client";

import * as React from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { ROLES } from "@/lib/orchestra/roles";
import { spansOf, type OrchestraRun } from "@/lib/orchestra/trace";
import { formatUsd } from "@/lib/chat/cost";
import { ACCENT_RGB, type Accent } from "@/lib/accent";
import { usePrefersReducedMotion } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils";

/**
 * One lane per sub-agent, time running left to right.
 *
 * `RunPanel` shows one turn and `ActivityTimeline` folds one finished turn;
 * neither can answer "which of these is still working, and what has it spent".
 * A fan-out is concurrent, so the only honest shape for it is concurrent too -
 * a list would imply an order that does not exist.
 *
 * All of the projection is `spansOf` in `lib/orchestra/trace.ts`, which is pure
 * and tested. This file decides pixels and nothing else.
 */

/** Roles are tinted from the three exposed bands, never from arbitrary hues. */
const ROLE_ACCENT: Record<string, Accent> = {
  cartographer: "ridge",
  scout: "shelf",
  analyst: "upland",
  builder: "ridge",
  critic: "shelf",
};

export function AgentLanes({ run, className }: { run: OrchestraRun | null; className?: string }) {
  const reduced = usePrefersReducedMotion();
  const spans = React.useMemo(() => (run ? spansOf(run) : []), [run]);

  if (!run || spans.length === 0) {
    return (
      <div
        className={cn(
          "flex min-h-[160px] flex-col items-center justify-center rounded-2xl border border-border bg-surface/40 p-6 text-center",
          className,
        )}
      >
        <p className="text-sm text-foreground">No agents running</p>
        <p className="mt-1 max-w-[34ch] text-2xs text-muted-foreground">
          When a question needs several angles at once, each one gets its own lane here.
        </p>
      </div>
    );
  }

  // A single shared time axis: lanes are only comparable if they share one.
  const start = Math.min(...spans.map((s) => s.startedAt));
  const now = Date.now();
  const end = Math.max(now, ...spans.map((s) => s.endedAt ?? now));
  const span = Math.max(1, end - start);

  return (
    <ul className={cn("space-y-2", className)}>
      {spans.map((s) => {
        const role = s.role ? ROLES[s.role] : undefined;
        const accent = ACCENT_RGB[ROLE_ACCENT[s.role ?? ""] ?? "shelf"];
        const left = ((s.startedAt - start) / span) * 100;
        const width = Math.max(4, (((s.endedAt ?? now) - s.startedAt) / span) * 100);

        return (
          <li
            key={s.agentId}
            className="rounded-xl border border-border bg-surface/60 p-2.5 shadow-glow"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <StatusIcon status={s.status} />
                <span className="truncate text-xs font-medium text-foreground">{s.title}</span>
              </span>
              <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground">
                {s.toolCalls} {s.toolCalls === 1 ? "call" : "calls"} · {formatUsd(s.spentUsd)}
              </span>
            </div>

            <div className="mt-1.5 flex items-center gap-2">
              <span className="w-[68px] shrink-0 font-mono text-2xs uppercase tracking-legend text-muted-foreground">
                {role?.label ?? "Agent"}
              </span>
              <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                <div
                  className={cn(
                    "absolute inset-y-0 rounded-full",
                    // A lane still working carries the shimmer the rest of the
                    // product already uses for "in flight".
                    s.status === "running" && !reduced && "shimmer",
                  )}
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    backgroundColor: s.status === "error" ? "rgb(var(--danger))" : accent,
                    opacity: s.status === "done" ? 0.75 : 1,
                  }}
                />
              </div>
            </div>

            {/*
              A failed lane opens itself. `ActivityTimeline` already established
              the rule - process is available, never imposed, and *never*
              collapsed over a failure - and a swimlane that closes green over an
              error is the same mistake in a new shape.
            */}
            {s.status === "error" && (
              <p className="mt-1.5 text-2xs text-danger">
                {run.events.find((e) => e.agentId === s.agentId && e.kind === "error")?.text ??
                  "This agent failed. Its angle was not covered."}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function StatusIcon({ status }: { status: "running" | "done" | "error" }) {
  if (status === "running") {
    return <Loader2 className="size-3.5 shrink-0 animate-spin text-action" aria-hidden />;
  }
  if (status === "error") {
    return <AlertTriangle className="size-3.5 shrink-0 text-danger" aria-hidden />;
  }
  return <Check className="size-3.5 shrink-0 text-success" aria-hidden />;
}
