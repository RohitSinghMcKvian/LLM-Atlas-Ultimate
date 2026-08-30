"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { STAGES, type CompareRun, type Stage, type StageStatus } from "@/lib/compare/types";
import { EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The run spine — a survey traverse across the five stages.
 *
 * A comparison is now a sequence of bounded stages rather than one opaque wait,
 * and the spine is what makes that legible: five stations on a line, the live
 * one filled, one line of plain status underneath. It replaces a spinner that
 * could only ever say "something is happening".
 *
 * The shape is the module's own: a levelling traverse across a survey, which is
 * where the elevation ramp beneath the lanes comes from too.
 */

const LABEL: Record<Stage, string> = {
  brief: "Brief",
  evidence: "Evidence",
  lanes: "Answers",
  analyse: "Analysis",
  synthesis: "Synthesis",
};

function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The station currently doing work, or the last one that did. */
function activeStage(run: CompareRun): Stage {
  const running = STAGES.find((s) => run.stages[s].status === "running");
  if (running) return running;
  const failed = STAGES.find((s) => run.stages[s].status === "error");
  if (failed) return failed;
  for (let i = STAGES.length - 1; i >= 0; i--) {
    const s = STAGES[i];
    if (run.stages[s].status === "done") return s;
  }
  return "brief";
}

function statusNote(run: CompareRun, stage: Stage): string {
  const state = run.stages[stage];
  if (state.note) return state.note;
  if (state.status === "error") return state.error ?? "This stage failed.";
  if (stage === "lanes") {
    const total = run.lanes.filter((l) => !l.blocked).length;
    const done = run.lanes.filter((l) => l.status === "done").length;
    if (state.status === "running") return `${done} of ${total} answered`;
    if (state.status === "done") return `${total} model${total === 1 ? "" : "s"} answered`;
  }
  if (state.status === "skipped") return "Not needed for this task";
  if (state.status === "running") return "Working";
  return "";
}

export function RunSpine({
  run,
  running,
  onStop,
}: {
  run: CompareRun;
  running: boolean;
  onStop: () => void;
}) {
  const reduced = useReducedMotion();
  const active = activeStage(run);
  const [now, setNow] = React.useState(() => Date.now());

  // A clock, not an animation: it is the only honest answer to "is this stuck",
  // so it keeps ticking even under reduced motion.
  React.useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const startedAt = run.stages[STAGES[0]].startedAt ?? run.createdAt;

  return (
    <div className="rounded-2xl border border-border bg-surface/50 px-4 py-3 shadow-glow sm:px-5">
      <div className="flex items-center gap-4">
        <ol className="flex min-w-0 flex-1 items-center gap-1.5" aria-label="Run progress">
          {STAGES.map((stage, i) => {
            const status = run.stages[stage].status;
            return (
              <li key={stage} className="flex min-w-0 flex-1 items-center gap-1.5">
                <Station
                  label={LABEL[stage]}
                  status={status}
                  current={stage === active}
                  reduced={Boolean(reduced)}
                />
                {i < STAGES.length - 1 && (
                  <span
                    aria-hidden
                    className={cn(
                      "h-px flex-1 transition-colors duration-500",
                      status === "done" || status === "skipped" ? "bg-border-strong" : "bg-border",
                    )}
                  />
                )}
              </li>
            );
          })}
        </ol>

        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden font-mono text-2xs tabular-nums text-muted-foreground sm:inline">
            {elapsed((running ? now : run.updatedAt) - startedAt)}
          </span>
          {running && (
            <Button variant="danger" size="sm" onClick={onStop}>
              <Square className="size-4" /> Stop
            </Button>
          )}
        </div>
      </div>

      <p className="mt-2 truncate text-2xs text-muted-foreground">
        <span className="font-medium text-foreground">{LABEL[active]}</span>
        {statusNote(run, active) && <> · {statusNote(run, active)}</>}
      </p>
    </div>
  );
}

function Station({
  label,
  status,
  current,
  reduced,
}: {
  label: string;
  status: StageStatus;
  current: boolean;
  reduced: boolean;
}) {
  const live = status === "running";
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={label}>
      <span
        aria-hidden
        className={cn(
          "relative grid size-2.5 shrink-0 place-items-center rounded-full border transition-colors",
          status === "done" && "border-action bg-action",
          status === "skipped" && "border-border-strong bg-border-strong",
          status === "error" && "border-danger bg-danger",
          status === "pending" && "border-border-strong bg-transparent",
          live && "border-action bg-action",
        )}
      >
        {live && !reduced && (
          <motion.span
            className="absolute inset-0 rounded-full bg-action"
            initial={{ opacity: 0.5, scale: 1 }}
            animate={{ opacity: 0, scale: 2.6 }}
            transition={{ duration: 1.6, repeat: Infinity, ease: EASE }}
          />
        )}
      </span>
      <span
        className={cn(
          "hidden truncate text-2xs transition-colors md:inline",
          current ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <span className="sr-only">
        {label}: {status}
      </span>
    </span>
  );
}
