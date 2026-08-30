"use client";

import * as React from "react";
import {
  AlertCircle,
  Check,
  KeyRound,
  Maximize2,
  Minimize2,
  RotateCw,
  Square,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/markdown";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BAND_LABEL, BAND_RGB, blindLabel } from "@/lib/compare/bands";
import type { LaneState } from "@/lib/compare/types";
import { getModelById } from "@/lib/catalog";
import { cn } from "@/lib/utils";
import { LaneMeters } from "./lane-meters";

/**
 * One model's answer.
 *
 * Replaces a fixed 300px column in a horizontal scroller that carried a name, a
 * status dot and nothing else. The differences that matter:
 *
 *   * The lane's elevation band is its identity — a rule across the top, and the
 *     same colour it will have in every other view of this run.
 *   * A lane that cannot run says why, in place, instead of being dropped.
 *   * Stop and retry are per lane. There was one `AbortController` for the whole
 *     run before, so stopping one model stopped all of them.
 */

export interface LaneCardProps {
  lane: LaneState;
  /** Hide the model's identity until the user has voted. */
  blind?: boolean;
  focused?: boolean;
  onFocus?: (id: string | null) => void;
  onStop?: (id: string) => void;
  onRetry?: (id: string) => void;
  onConnectKey?: () => void;
  /** Shared scroll position, when lanes are locked together. */
  scrollRef?: (id: string, el: HTMLDivElement | null) => void;
  onScroll?: (id: string, top: number) => void;
  className?: string;
}

export function LaneCard({
  lane,
  blind = false,
  focused = false,
  onFocus,
  onStop,
  onRetry,
  onConnectKey,
  scrollRef,
  onScroll,
  className,
}: LaneCardProps) {
  const model = getModelById(lane.modelId);
  const name = blind ? blindLabel(lane.band) : (model?.name ?? lane.modelId);
  const streaming = lane.status === "streaming";
  const bodyRef = React.useRef<HTMLDivElement | null>(null);

  return (
    <article
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface/50 shadow-glow",
        focused && "border-border-strong",
        className,
      )}
      aria-label={`${name} answer`}
    >
      {/* The band. Two pixels of the one thing that identifies this lane
          everywhere else in the run. */}
      <span
        aria-hidden
        className="h-0.5 w-full shrink-0"
        style={{ backgroundColor: BAND_RGB[lane.band] }}
      />

      <header className="flex items-start justify-between gap-2 border-b border-border p-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium">{name}</span>
            {!blind && lane.provider && (
              <Badge variant="outline" className="shrink-0 text-2xs font-normal">
                {lane.provider}
              </Badge>
            )}
            <span className="sr-only">{BAND_LABEL[lane.band]} band</span>
          </div>
          <LaneMeters lane={lane} className="mt-1" />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <LaneStatus lane={lane} />
          {streaming && onStop && (
            <IconAction label="Stop this lane" onClick={() => onStop(lane.id)}>
              <Square className="size-3.5" />
            </IconAction>
          )}
          {lane.status === "error" && !lane.blocked && onRetry && (
            <IconAction label="Retry this lane" onClick={() => onRetry(lane.id)}>
              <RotateCw className="size-3.5" />
            </IconAction>
          )}
          {onFocus && (
            <IconAction
              label={focused ? "Show all lanes" : "Focus this lane"}
              onClick={() => onFocus(focused ? null : lane.id)}
            >
              {focused ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </IconAction>
          )}
        </div>
      </header>

      <div
        ref={(el) => {
          bodyRef.current = el;
          scrollRef?.(lane.id, el);
        }}
        onScroll={(e) => onScroll?.(lane.id, e.currentTarget.scrollTop)}
        className="min-h-[9rem] flex-1 overflow-y-auto p-4 text-body"
      >
        {lane.status === "error" ? (
          <LaneError lane={lane} onConnectKey={onConnectKey} onRetry={onRetry} />
        ) : lane.text ? (
          <>
            <Markdown>{lane.text}</Markdown>
            {streaming && (
              <span
                aria-hidden
                className="ml-0.5 inline-block h-3.5 w-1.5 animate-caret-blink bg-action align-text-bottom"
              />
            )}
          </>
        ) : (
          <Waiting status={lane.status} />
        )}
      </div>
    </article>
  );
}

function LaneStatus({ lane }: { lane: LaneState }) {
  if (lane.status === "done") {
    return (
      <span className="text-success" title="Finished">
        <Check className="size-4" />
        <span className="sr-only">Finished</span>
      </span>
    );
  }
  if (lane.status === "error") {
    return (
      <span className="text-danger" title="Failed">
        <AlertCircle className="size-4" />
        <span className="sr-only">Failed</span>
      </span>
    );
  }
  if (lane.status === "streaming") {
    return (
      <span className="flex items-center gap-1 text-2xs text-action">
        <span aria-hidden className="size-1.5 animate-pulse-dot rounded-full bg-action" />
        live
      </span>
    );
  }
  if (lane.status === "stopped") {
    return <span className="text-2xs text-muted-foreground">stopped</span>;
  }
  return <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/40" />;
}

/**
 * A lane that could not run.
 *
 * Names the cause and offers the fix. `key_required` is by far the most common
 * and has an exact remedy, so it gets a button rather than a sentence telling
 * the user to go and find one.
 */
function LaneError({
  lane,
  onConnectKey,
  onRetry,
}: {
  lane: LaneState;
  onConnectKey?: () => void;
  onRetry?: (id: string) => void;
}) {
  const needsKey = lane.errorCode === "key_required" || lane.errorCode === "no_credit";
  return (
    <div className="flex flex-col items-start gap-3 text-sm">
      <p className="flex items-start gap-2 text-danger">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        <span>{lane.error}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {needsKey && onConnectKey && (
          <button
            onClick={onConnectKey}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-2.5 py-1 text-xs transition-colors hover:border-action hover:text-foreground"
          >
            <KeyRound className="size-3.5" /> Connect a key
          </button>
        )}
        {!lane.blocked && onRetry && (
          <button
            onClick={() => onRetry(lane.id)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-2.5 py-1 text-xs transition-colors hover:border-action hover:text-foreground"
          >
            <RotateCw className="size-3.5" /> Retry
          </button>
        )}
      </div>
    </div>
  );
}

function Waiting({ status }: { status: LaneState["status"] }) {
  if (status === "stopped") {
    return <p className="text-sm text-muted-foreground">Stopped before this model answered.</p>;
  }
  return (
    <div className="flex items-center gap-1" aria-label="Waiting for the first token">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          className="size-1.5 animate-pulse-dot rounded-full bg-muted-foreground/60"
          style={{ animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </div>
  );
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          aria-label={label}
          className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
