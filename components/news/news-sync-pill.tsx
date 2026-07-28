"use client";

import * as React from "react";
import { AlertTriangle, Check, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fullTime, humanDuration, relativeTime } from "@/lib/news/format";
import { cn } from "@/lib/utils";

// Sync status, and the manual Refresh control.
//
// The behaviour worth knowing about: inside the server's cooldown window the
// endpoint returns instantly without touching a single publisher, and this
// reports that honestly — "Up to date · next sync in 6 minutes" — instead of
// spinning for a second and pretending it did something. The button is never a
// lie, and the server is never hammered.

export type SyncState =
  | { kind: "idle" }
  | { kind: "syncing" }
  | { kind: "fresh"; nextEligibleAt: string }
  | { kind: "synced"; added: number }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "error"; message: string };

export function NewsSyncPill({
  syncedAt,
  state,
  warnings,
  canRefresh,
  mounted,
  onRefresh,
  className,
}: {
  syncedAt: string;
  state: SyncState;
  warnings: string[];
  canRefresh: boolean;
  mounted?: boolean;
  onRefresh: () => void;
  className?: string;
}) {
  const ageMs = mounted ? Date.now() - Date.parse(syncedAt) : 0;
  const hasWarnings = warnings.length > 0;

  // Green under 90 minutes (one hourly cycle plus slack), amber up to six hours,
  // danger beyond that or when the last run reported problems.
  const health: "ok" | "warn" | "bad" = !mounted
    ? "ok"
    : hasWarnings || ageMs > 6 * 3_600_000
      ? "bad"
      : ageMs > 90 * 60_000
        ? "warn"
        : "ok";

  const dotColour =
    health === "ok" ? "bg-success" : health === "warn" ? "bg-amber" : "bg-danger";

  const syncing = state.kind === "syncing";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs">
            <span className="relative flex size-2">
              {health === "ok" && !syncing && (
                <span
                  className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", dotColour)}
                  aria-hidden="true"
                />
              )}
              <span className={cn("relative inline-flex size-2 rounded-full", dotColour)} />
            </span>
            <span className="text-muted-foreground">
              {syncing ? (
                "Syncing…"
              ) : mounted ? (
                <>
                  Synced{" "}
                  <time dateTime={syncedAt} title={fullTime(syncedAt)}>
                    {relativeTime(syncedAt)}
                  </time>
                </>
              ) : (
                "Live"
              )}
            </span>
            {hasWarnings && (
              <AlertTriangle className="size-3 text-amber" aria-hidden="true" />
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p>Last sweep: {fullTime(syncedAt)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Atlas re-syncs every hour. {hasWarnings ? warnings[0] : "All sources responded."}
          </p>
        </TooltipContent>
      </Tooltip>

      {canRefresh && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              size="sm"
              onClick={onRefresh}
              disabled={syncing}
              aria-label="Sync news now"
            >
              {syncing ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : state.kind === "synced" ? (
                <Check className="text-success" aria-hidden="true" />
              ) : (
                <RefreshCw aria-hidden="true" />
              )}
              <span className="hidden sm:inline">{syncing ? "Syncing" : "Refresh"}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <SyncMessage state={state} />
          </TooltipContent>
        </Tooltip>
      )}

      {/* The result of the last attempt, inline and unglamorous. */}
      {state.kind !== "idle" && state.kind !== "syncing" && (
        <span
          className={cn(
            "hidden text-2xs md:inline",
            state.kind === "error" ? "text-danger" : "text-muted-foreground",
          )}
        >
          <SyncMessage state={state} />
        </span>
      )}
    </div>
  );
}

function SyncMessage({ state }: { state: SyncState }) {
  switch (state.kind) {
    case "syncing":
      return <>Fetching from every source…</>;
    case "fresh": {
      const remaining = Date.parse(state.nextEligibleAt) - Date.now();
      return <>Up to date · next sync in {humanDuration(remaining)}</>;
    }
    case "synced":
      return state.added > 0 ? (
        <>
          Synced · {state.added} new stor{state.added === 1 ? "y" : "ies"}
        </>
      ) : (
        <>Synced · nothing new</>
      );
    case "rate_limited":
      return <>Too many refreshes · try again in {humanDuration(state.retryAfterSeconds * 1000)}</>;
    case "error":
      return <>{state.message}</>;
    case "idle":
    default:
      return <>Sync now</>;
  }
}
