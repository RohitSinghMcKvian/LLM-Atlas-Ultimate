"use client";

import * as React from "react";
import { Loader2, SearchX, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { topicLabel } from "@/lib/news/topics";
import type { NewsFilterState } from "@/lib/news/types";
import { NewsGeneratedArt } from "./news-generated-art";

/**
 * Cold start: the corpus has never been filled.
 *
 * `lib/news/baseline.ts` ships no articles on purpose — inventing a starter feed
 * attributed to real publishers, wearing this feature's own verification badges,
 * would contradict the one thing it is for. So this state is honest and, on any
 * deployment with outbound network, brief: the first request schedules a sweep
 * and the feeds need no API keys.
 */
export function NewsColdStart() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface px-6 py-16 text-center">
      <div className="relative size-20 overflow-hidden rounded-2xl opacity-70">
        <NewsGeneratedArt seed="atlas-cold-start" />
      </div>
      <div className="max-w-md space-y-2">
        <h2 className="font-display text-lg font-semibold">The first sync is running</h2>
        <p className="text-sm text-muted-foreground">
          Atlas is pulling stories from around forty AI sources right now, and finding a picture for
          each one. No API key is needed, and nothing here needs pressing — the page fills itself in
          as soon as the sweep lands.
        </p>
      </div>
      {/* The Sync now button that used to live here has gone, along with the
          rest of the manual sync surface. It was the least defensible one in the
          product: the cold-start page already polls, and offering a button on a
          screen that is about to update itself invites the reader to press it
          and then watch nothing visibly happen. */}
      <p className="inline-flex items-center gap-2 text-2xs uppercase tracking-wide text-muted-foreground">
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        Waiting for the first sweep
      </p>
    </div>
  );
}

/** Nothing matched the current filters — with one-click removal for each. */
export function NewsFilteredEmpty({
  filters,
  onClearTopic,
  onClearSource,
  onClearQuery,
  onClearAll,
  sourceName,
}: {
  filters: NewsFilterState;
  onClearTopic: (topic: string) => void;
  onClearSource: (id: string) => void;
  onClearQuery: () => void;
  onClearAll: () => void;
  sourceName: (id: string) => string;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border px-6 py-16 text-center">
      <SearchX className="size-8 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <h2 className="font-display text-base font-semibold">No stories match</h2>
        <p className="text-sm text-muted-foreground">
          Remove a filter to widen the search.
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-1.5">
        {filters.query.trim() && (
          <FilterPill label={`“${filters.query.trim()}”`} onRemove={onClearQuery} />
        )}
        {filters.topics.map((topic) => (
          <FilterPill key={topic} label={topicLabel(topic)} onRemove={() => onClearTopic(topic)} />
        ))}
        {filters.sources.map((id) => (
          <FilterPill key={id} label={sourceName(id)} onRemove={() => onClearSource(id)} />
        ))}
        {filters.verifiedOnly && <FilterPill label="Verified only" onRemove={onClearAll} />}
        {filters.savedOnly && <FilterPill label="Saved only" onRemove={onClearAll} />}
      </div>

      <Button variant="ghost" size="sm" onClick={onClearAll}>
        Clear all filters
      </Button>
    </div>
  );
}

function FilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs transition-colors hover:border-danger/40 hover:text-danger"
    >
      {label}
      <X className="size-3" aria-hidden="true" />
      <span className="sr-only">Remove this filter</span>
    </button>
  );
}

/** Every source failed — almost always our egress, not thirty publishers at once. */
export function NewsOffline({ warnings }: { warnings: string[] }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber/30 bg-amber/5 px-6 py-12 text-center">
      <WifiOff className="size-7 text-amber" aria-hidden="true" />
      <h2 className="font-display text-base font-semibold">No sources could be reached</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Every feed failed on the last sweep. That usually means this deployment has no outbound
        network access rather than that every publisher is down.
      </p>
      {warnings.length > 0 && (
        <p className="max-w-md font-mono text-2xs text-muted-foreground">{warnings[0]}</p>
      )}
    </div>
  );
}
