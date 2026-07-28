"use client";

import * as React from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FEED_TIER_LABEL, FEED_TIER_ORDER, type FeedTier } from "@/lib/news/feeds";
import { sourceAccent } from "@/lib/news/format";
import type { NewsSourceSummary } from "@/lib/news/types";
import { cn } from "@/lib/utils";

// The source picker, grouped by trust tier.
//
// Doubles as the feature's health dashboard: every source shows its live article
// count and a status dot, so "why am I not seeing anything from X" is answerable
// without reading server logs. A feed that has rotted is visible here first.

export function NewsSourceFilter({
  sources,
  counts,
  selected,
  onChange,
}: {
  sources: readonly NewsSourceSummary[];
  /** Article counts under the *other* active filters. */
  counts: Record<string, number>;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);

  const grouped = React.useMemo(() => {
    const byTier = new Map<FeedTier, NewsSourceSummary[]>();
    for (const tier of FEED_TIER_ORDER) byTier.set(tier, []);
    for (const source of sources) byTier.get(source.tier)?.push(source);
    for (const list of byTier.values()) {
      list.sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0) || a.name.localeCompare(b.name));
    }
    return byTier;
  }, [sources, counts]);

  const toggle = (id: string) => {
    onChange(selectedSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const firstPartyOnly = () =>
    onChange(sources.filter((s) => s.tier === "first_party").map((s) => s.id));

  const liveCount = sources.filter((s) => (counts[s.id] ?? 0) > 0).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          Sources
          {selected.length > 0 ? (
            <Badge variant="primary" className="px-1.5 py-0 text-2xs tnum">
              {selected.length}
            </Badge>
          ) : (
            <span className="tnum text-2xs text-muted-foreground">{liveCount}</span>
          )}
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <p className="text-xs font-medium">Filter by source</p>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-6 px-2 text-2xs" onClick={firstPartyOnly}>
              First-party
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-2xs"
              onClick={() => onChange([])}
              disabled={selected.length === 0}
            >
              Clear
            </Button>
          </div>
        </div>

        <ScrollArea className="max-h-80">
          <div className="p-1">
            {FEED_TIER_ORDER.map((tier) => {
              const list = grouped.get(tier) ?? [];
              if (!list.length) return null;
              return (
                <div key={tier} className="mb-1">
                  <p className="px-2 py-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                    {FEED_TIER_LABEL[tier]}
                  </p>
                  {list.map((source) => {
                    const count = counts[source.id] ?? 0;
                    const checked = selectedSet.has(source.id);
                    const healthy = source.status === "ok" || source.status === "not_modified";
                    return (
                      <label
                        key={source.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-surface-2",
                          count === 0 && "opacity-55",
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggle(source.id)}
                          aria-label={`Filter to ${source.name}`}
                        />
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: sourceAccent(source.id) }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate">{source.name}</span>

                        {/* The health signal. `disabled` and `failed` are the two
                            states worth surfacing to a reader wondering where a
                            publisher went. */}
                        {!healthy && (
                          <span
                            className={cn(
                              "shrink-0 text-2xs",
                              source.status === "disabled" ? "text-muted-foreground" : "text-amber",
                            )}
                            title={
                              source.status === "disabled"
                                ? "Disabled — this feed no longer publishes"
                                : "This source failed on the last sweep"
                            }
                          >
                            {source.status === "disabled" ? "off" : "!"}
                          </span>
                        )}

                        <span className="shrink-0 tnum text-2xs text-muted-foreground">{count}</span>

                        <a
                          href={source.homepage}
                          target="_blank"
                          rel="noreferrer noopener"
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                          aria-label={`Visit ${source.name} (opens in a new tab)`}
                        >
                          <ExternalLink className="size-3" aria-hidden="true" />
                        </a>
                      </label>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
