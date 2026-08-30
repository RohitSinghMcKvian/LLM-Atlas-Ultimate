"use client";

import * as React from "react";
import { AlertTriangle, GitBranch, Scissors } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { LaneState } from "@/lib/compare/types";
import { cn, formatUSD } from "@/lib/utils";

/**
 * The numbers under a lane's name.
 *
 * Compare reported none of these: it called `streamChat`, the plain-string
 * wrapper, which discards the router's `usage` and `provider` events entirely.
 * So there was no token count, no real cost, and no way to notice that a lane
 * had quietly failed over to a second provider halfway through.
 *
 * Kept to four figures at rest — time to first token, throughput, tokens, cost —
 * because a lane header competing with the answer for attention is worse than no
 * header. Everything else is a badge that only appears when it is true.
 */

function ttft(ms?: number): string {
  if (ms === undefined) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function throughput(lane: LaneState): string {
  const { completionTokens, totalMs, ttftMs } = lane.meters;
  if (!completionTokens || !totalMs) return "—";
  // Generation time, not wall time: including the wait for the first token would
  // report a fast model on a slow queue as a slow model.
  const generating = Math.max(1, totalMs - (ttftMs ?? 0));
  return `${Math.round(completionTokens / (generating / 1000))} t/s`;
}

export function LaneMeters({ lane, className }: { lane: LaneState; className?: string }) {
  const { promptTokens, completionTokens, costUsd, failovers, continuations, truncated } = lane.meters;
  const tokens = (promptTokens ?? 0) + (completionTokens ?? 0);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-2xs tabular-nums text-muted-foreground",
        className,
      )}
    >
      <Figure label="time to first token" value={ttft(lane.meters.ttftMs)} />
      <Dot />
      <Figure label="throughput" value={throughput(lane)} />
      <Dot />
      <Figure label="tokens" value={tokens ? tokens.toLocaleString() : "—"} />
      <Dot />
      <Figure
        label="cost"
        value={
          costUsd === undefined
            ? // Some providers reject `stream_options` and the router retries
              // without it, so usage never arrives. Unknown is not free.
              "—"
            : formatUSD(costUsd, { precise: true })
        }
      />

      {Boolean(failovers) && (
        <Flag icon={GitBranch} tone="muted">
          Fell back to another provider {failovers === 1 ? "once" : `${failovers} times`}
        </Flag>
      )}
      {Boolean(continuations) && (
        <Flag icon={Scissors} tone="muted">
          Answer was resumed {continuations === 1 ? "once" : `${continuations} times`} after the
          provider cut it off
        </Flag>
      )}
      {truncated && (
        <Flag icon={AlertTriangle} tone="warning">
          This answer hit the output limit and is incomplete
        </Flag>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="sr-only">{label}: </span>
      {value}
    </span>
  );
}

function Dot() {
  return (
    <span aria-hidden className="text-border-strong">
      ·
    </span>
  );
}

function Flag({
  icon: Icon,
  tone,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: "muted" | "warning";
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* An icon alone would rest the meaning on hue; every flag carries a
            shape and a description as well. */}
        <span
          className={cn(
            "inline-flex cursor-help items-center",
            tone === "warning" ? "text-amber" : "text-muted-foreground/70",
          )}
        >
          <Icon className="size-3" />
          <span className="sr-only">{children}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-56">{children}</TooltipContent>
    </Tooltip>
  );
}
