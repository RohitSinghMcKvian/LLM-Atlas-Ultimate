"use client";

import * as React from "react";
import { Radio, ShieldCheck, Signal, Clock } from "lucide-react";
import type { NewsSnapshot, NewsArticle } from "@/lib/news/types";
import { cn } from "@/lib/utils";
import { NewsLiveWire } from "./news-live-wire";
import { NewsSyncPill, type SyncState } from "./news-sync-pill";

// The page header.
//
// The subtitle states real numbers from the current corpus rather than a slogan,
// because the numbers are the pitch: a reader should be able to tell at a glance
// how much is here, how much of it is verified, and how fresh it is. Every
// figure is derived from the snapshot, so none of it can drift out of date.

export function NewsHero({
  snapshot,
  latest,
  syncState,
  canRefresh,
  mounted,
  onRefresh,
  onOpen,
  onShowSources,
}: {
  snapshot: NewsSnapshot;
  latest: NewsArticle[];
  syncState: SyncState;
  canRefresh: boolean;
  mounted?: boolean;
  onRefresh: () => void;
  onOpen: (article: NewsArticle) => void;
  onShowSources: () => void;
}) {
  const { stats } = snapshot;

  return (
    <header className="relative isolate mb-4 overflow-hidden rounded-3xl border border-border">
      {/* Backdrop: aurora over a grid, faded out at the bottom so the filter bar
          below reads as part of the same surface. */}
      <div className="absolute inset-0 -z-10 bg-gradient-aurora opacity-40" aria-hidden="true" />
      <div className="absolute inset-0 -z-10 bg-grid-fade opacity-60" aria-hidden="true" />
      <div
        className="absolute inset-0 -z-10 bg-gradient-to-t from-background via-background/40 to-transparent"
        aria-hidden="true"
      />

      <div className="px-5 py-6 sm:px-7 sm:py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="mb-1.5 inline-flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wider text-cyan">
              <Radio className="size-3" aria-hidden="true" />
              Live feed
            </p>
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Atlas <span className="text-gradient">News</span>
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {stats.articles > 0 ? (
                <>
                  <strong className="font-medium text-foreground">{stats.articles}</strong> stories
                  from{" "}
                  <button
                    type="button"
                    onClick={onShowSources}
                    className="font-medium text-foreground underline decoration-dotted underline-offset-2 hover:text-cyan"
                  >
                    {stats.sources} live sources
                  </button>
                  , de-duplicated across publishers and re-synced every hour. Every story links to
                  the original.
                </>
              ) : (
                <>
                  Verified AI news from around thirty first-party, research and press sources.
                  Re-synced every hour, no API key required.
                </>
              )}
            </p>
          </div>

          <NewsSyncPill
            syncedAt={snapshot.syncedAt}
            state={syncState}
            warnings={snapshot.warnings}
            canRefresh={canRefresh}
            mounted={mounted}
            onRefresh={onRefresh}
            className="shrink-0"
          />
        </div>

        {stats.articles > 0 && (
          <dl className="mt-5 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:gap-6">
            <Stat icon={Signal} label="Stories" value={stats.articles} />
            <Stat
              icon={ShieldCheck}
              label="Verified"
              value={stats.verified}
              hint="Verified or corroborated"
            />
            <Stat icon={Radio} label="Sources live" value={stats.sources} />
            <Stat icon={Clock} label="Last 24h" value={stats.last24h} />
          </dl>
        )}

        {latest.length > 0 && (
          <NewsLiveWire
            articles={latest}
            mounted={mounted}
            onOpen={onOpen}
            className="mt-5 -mb-1"
          />
        )}
      </div>
    </header>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Signal;
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-2xs uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3" aria-hidden="true" />
        {label}
      </dt>
      {/* Rendered as a plain number, not a CountUp.
          These figures back the claim the subtitle just made, so they have to be
          correct in the server HTML and correct for a reader who never scrolls
          them into view. CountUp starts at zero and animates on intersection,
          which on a short viewport left the hero reading "351 stories" beside
          four counters showing 0. */}
      <dd className={cn("font-display text-xl font-semibold tnum sm:text-2xl")} title={hint}>
        {value.toLocaleString("en-GB")}
      </dd>
    </div>
  );
}
