"use client";

import * as React from "react";
import { AlertTriangle, ArrowUp, CloudOff, RefreshCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fullTime, relativeTime } from "@/lib/news/format";
import type { NewsSnapshot } from "@/lib/news/types";
import { cn } from "@/lib/utils";
import type { AutoSyncPhase } from "./use-news-auto-sync";

// Sync status, with nothing to press.
//
// This replaced a pill with a Refresh button beside it. The button was never
// wrong exactly — it was honest about the server's cooldown, it was rate
// limited, it announced its result to screen readers — it was just an admission
// that the feed could not keep itself current. It can. See
// `use-news-auto-sync.ts`.
//
// What remains is a statement rather than a control: how fresh this is, whether
// anything is wrong, and whether the connection is up. The one interactive
// element in this file is the "new stories" ribbon, and that is a *reveal*, not
// a fetch — the stories it shows have already been downloaded.

export function NewsLiveStatus({
  syncedAt,
  origin,
  phase,
  warnings,
  mounted,
  className,
}: {
  syncedAt: string;
  /**
   * `baseline` means no sweep has ever completed.
   *
   * Worth a branch of its own: the bundled baseline carries `new Date(0)` as its
   * `syncedAt`, so a cold start rendered "Live · 1 Jan 1970" — technically the
   * truth about a field, and nonsense as a statement about the product.
   */
  origin: NewsSnapshot["origin"];
  phase: AutoSyncPhase;
  warnings: string[];
  /** False during SSR and the first paint, when `Date.now()` would not match the server. */
  mounted?: boolean;
  className?: string;
}) {
  const neverSynced = origin === "baseline";
  const ageMs = mounted && !neverSynced ? Date.now() - Date.parse(syncedAt) : 0;
  const hasWarnings = warnings.length > 0;
  const offline = phase === "offline";

  // Green under 90 minutes (one hourly cycle plus slack), amber to six hours,
  // red beyond that.
  //
  // A partial source failure is AMBER, not red. Two or three of thirty-odd feeds
  // failing is the normal condition of the open web on any given hour — a CDN
  // hiccup, a WAF, a feed being republished — and the corpus is designed so that
  // a failed source removes nothing. Painting the live indicator red for it said
  // "this is broken" about a feed that was working perfectly, which is the kind
  // of false alarm that teaches people to ignore the indicator entirely.
  // Offline is red, because then it really is not live.
  const health: "ok" | "warn" | "bad" = !mounted || neverSynced
    ? "ok"
    : offline || ageMs > 6 * 3_600_000
      ? "bad"
      : hasWarnings || ageMs > 90 * 60_000
        ? "warn"
        : "ok";

  const dotColour = health === "ok" ? "bg-success" : health === "warn" ? "bg-amber" : "bg-danger";
  const working = phase === "checking" || phase === "updating";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs",
            className,
          )}
        >
          {offline ? (
            <CloudOff className="size-3 text-danger" aria-hidden="true" />
          ) : (
            <span className="relative flex size-2">
              {/* The ping is the whole point of a live indicator, so it runs
                  whenever the feed is healthy — but never while a request is in
                  flight, where a second animation just reads as jitter. */}
              {health === "ok" && !working && (
                <span
                  className={cn(
                    "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
                    dotColour,
                  )}
                  aria-hidden="true"
                />
              )}
              <span className={cn("relative inline-flex size-2 rounded-full", dotColour)} />
            </span>
          )}

          <span className="text-muted-foreground">
            {offline ? (
              "Offline"
            ) : phase === "updating" ? (
              "Updating…"
            ) : neverSynced ? (
              "First sync running"
            ) : mounted ? (
              <>
                Live ·{" "}
                <time dateTime={syncedAt} title={fullTime(syncedAt)}>
                  {relativeTime(syncedAt)}
                </time>
              </>
            ) : (
              // Pre-hydration there is no clock to read from, and a relative
              // time rendered on the server is wrong by the time it arrives.
              "Live"
            )}
          </span>

          {hasWarnings && !offline && (
            <AlertTriangle className="size-3 text-amber" aria-hidden="true" />
          )}
        </span>
      </TooltipTrigger>

      <TooltipContent className="max-w-xs">
        {offline ? (
          <p>No connection. The feed will catch up on its own when you are back online.</p>
        ) : neverSynced ? (
          <p>
            Atlas is sweeping its sources for the first time. Nothing here needs pressing — the feed
            fills itself in.
          </p>
        ) : (
          <>
            <p>Last sweep: {fullTime(syncedAt)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Atlas syncs itself — there is nothing to refresh.{" "}
              {hasWarnings ? warnings[0] : "All sources responded."}
            </p>
          </>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The held-update reveal.
 *
 * Shown only when new stories arrived while the reader was scrolled into the
 * feed. Adopting them silently there would re-sort the page mid-sentence, which
 * is the one thing a live feed must never do — so they are downloaded, held, and
 * offered.
 *
 * `aria-live="polite"` rather than `assertive`: this is an offer, not an alert,
 * and it must not interrupt a screen reader reading an article.
 */
export function NewsNewStoriesRibbon({
  count,
  onReveal,
  className,
}: {
  count: number;
  onReveal: () => void;
  className?: string;
}) {
  if (count <= 0) return null;

  return (
    <div
      className={cn(
        "pointer-events-none sticky top-3 z-30 flex justify-center",
        // The ribbon occupies no layout space of its own — it floats over the
        // feed. Without this the whole page shifts down the moment news breaks.
        "h-0",
        className,
      )}
      aria-live="polite"
    >
      <button
        type="button"
        onClick={onReveal}
        className={cn(
          "pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border",
          "bg-surface px-4 py-2 text-xs font-medium shadow-lg",
          "transition-transform hover:-translate-y-px hover:text-action",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action",
          "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2",
        )}
      >
        <ArrowUp className="size-3.5" aria-hidden="true" />
        {count === 1 ? "1 new story" : `${count} new stories`}
      </button>
    </div>
  );
}

/**
 * A compact spinner for the corner of the hero while a check is in flight.
 *
 * Deliberately tiny and deliberately optional: the reader does not need to know
 * that a 300-byte request is happening, and a prominent indicator would make an
 * invisible background task feel like something they should wait for.
 */
export function NewsSyncWhisper({ phase }: { phase: AutoSyncPhase }) {
  if (phase !== "checking" && phase !== "updating") return null;

  return (
    <RefreshCw
      className="size-3 animate-spin text-muted-foreground/60"
      aria-hidden="true"
    />
  );
}
