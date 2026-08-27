"use client";

import * as React from "react";
import {
  AlertTriangle,
  CircleDot,
  Coins,
  Flag,
  Link2,
  ListChecks,
  ShieldQuestion,
  Users,
  Waypoints,
  Wrench,
} from "lucide-react";
import type { OrchestraEventKind, OrchestraRun } from "@/lib/orchestra/trace";
import { cn } from "@/lib/utils";

/**
 * The trace, as a record.
 *
 * Deliberately plain: hairline rules, monospace timestamps, tabular numerals,
 * no animation. The Map is where this surface spends its boldness, and a log
 * that also moves is two things competing for the same attention.
 *
 * It renders `run.events` directly. The events already carry their own one-line
 * text - written where the event was raised, by the code that knew what
 * happened - so a formatter here would be a second, worse description of the
 * same thing.
 */

const ICONS: Record<OrchestraEventKind, React.ComponentType<{ className?: string }>> = {
  run_start: Flag,
  plan: ListChecks,
  step_start: CircleDot,
  step_end: CircleDot,
  agent_start: Users,
  agent_end: Users,
  tool_call: Wrench,
  tool_result: Wrench,
  graph_hit: Waypoints,
  source: Link2,
  spend: Coins,
  approval: ShieldQuestion,
  error: AlertTriangle,
  run_end: Flag,
};

export function RunLog({ run, className }: { run: OrchestraRun | null; className?: string }) {
  const scrollRef = React.useRef<HTMLOListElement>(null);
  const count = run?.events.length ?? 0;

  // Follow the tail while it grows, the way a terminal does.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  if (!run || count === 0) {
    return (
      <div
        className={cn(
          "flex min-h-[160px] flex-col items-center justify-center rounded-2xl border border-border bg-surface/40 p-6 text-center",
          className,
        )}
      >
        <p className="text-sm text-foreground">Nothing to report yet</p>
        <p className="mt-1 max-w-[34ch] text-2xs text-muted-foreground">
          Every step, tool call and cost is recorded here, and kept after the run ends.
        </p>
      </div>
    );
  }

  const start = run.startedAt;

  return (
    <ol
      ref={scrollRef}
      className={cn(
        "max-h-[52vh] overflow-y-auto rounded-2xl border border-border bg-code/60",
        className,
      )}
    >
      {run.events.map((e) => {
        const Icon = ICONS[e.kind] ?? CircleDot;
        const failed = e.kind === "error";
        return (
          <li
            key={e.seq}
            className={cn(
              "flex items-start gap-2 border-b border-border/60 px-2.5 py-1.5 last:border-b-0",
              failed && "bg-danger/5",
            )}
          >
            <span className="w-[52px] shrink-0 pt-0.5 text-right font-mono text-2xs tabular-nums text-muted-foreground">
              {elapsed(e.ts - start)}
            </span>
            <Icon
              className={cn("mt-0.5 size-3 shrink-0", failed ? "text-danger" : "text-muted-foreground")}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className={cn("text-2xs", failed ? "text-danger" : "text-foreground")}>
                {e.text}
              </span>
              {e.role && (
                <span className="ml-1.5 font-mono text-2xs uppercase tracking-legend text-muted-foreground">
                  {e.role}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** `m:ss.t` from the run's own start, not wall-clock: the offset is the story. */
function elapsed(ms: number): string {
  const total = Math.max(0, ms);
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const tenths = Math.floor((total % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}
