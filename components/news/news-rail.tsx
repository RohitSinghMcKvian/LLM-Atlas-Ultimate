"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Bookmark, CheckCheck, Plus, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getModelById } from "@/lib/catalog";
import type { CatalogDiffEntry } from "@/lib/catalog/snapshot";
import { sourceAccent } from "@/lib/news/format";
import { trendingFromNews } from "@/lib/news/select";
import type { NewsArticle, NewsSourceSummary } from "@/lib/news/types";
import { cn } from "@/lib/utils";
import { VerificationDisclosure } from "./news-verification";

// The right rail.
//
// "What changed" is the part worth noting: the retired news feed had a
// hand-authored `diff` field on each item, so the cards claimed catalog movement
// that had never happened. This reads the REAL `CatalogDiffEntry[]` off the
// catalog snapshot — the same data the daily model sync produces — and joins it
// to the news corpus by model id. The accent scheme is carried over from the old
// component, which was the one part of it that was good.

const DIFF_STYLE = {
  new_model: { icon: Plus, label: "New model", accent: "text-success", border: "border-l-success" },
  price_change: {
    icon: TrendingDown,
    label: "Price change",
    accent: "text-action",
    border: "border-l-action",
  },
  deprecation: {
    icon: AlertTriangle,
    label: "Deprecation",
    accent: "text-amber",
    border: "border-l-amber",
  },
} as const;

export function NewsRail({
  catalogDiff,
  articles,
  sources,
  savedCount,
  readCount,
  onFilterSource,
  onShowSaved,
  onMarkAllRead,
}: {
  catalogDiff: readonly CatalogDiffEntry[];
  articles: readonly NewsArticle[];
  sources: readonly NewsSourceSummary[];
  savedCount: number;
  readCount: number;
  onFilterSource: (id: string) => void;
  onShowSaved: () => void;
  onMarkAllRead: () => void;
}) {
  // Model ids ranked by how often the CURRENT corpus mentions them, rather than
  // the catalog's static `trending` flag — so the rail reflects the news.
  const trending = React.useMemo(() => trendingFromNews(articles, 6), [articles]);

  // Only show diff entries the news actually talks about; a diff nobody covered
  // is catalog trivia, not news.
  const coverage = React.useMemo(() => {
    const byModel = new Map<string, number>();
    for (const article of articles) {
      for (const id of article.models) byModel.set(id, (byModel.get(id) ?? 0) + 1);
    }
    return catalogDiff
      .map((entry) => ({ entry, mentions: byModel.get(entry.modelId) ?? 0 }))
      .sort((a, b) => b.mentions - a.mentions)
      .slice(0, 5);
  }, [catalogDiff, articles]);

  const topSources = React.useMemo(
    () => sources.filter((s) => s.count > 0).slice(0, 6),
    [sources],
  );

  return (
    <aside className="space-y-4" aria-label="News sidebar">
      {coverage.length > 0 && (
        <RailCard title="What changed">
          <ul className="space-y-1.5">
            {coverage.map(({ entry, mentions }) => {
              const style = DIFF_STYLE[entry.kind];
              const model = getModelById(entry.modelId);
              const Icon = style.icon;
              return (
                <li key={`${entry.kind}-${entry.modelId}`}>
                  <Link
                    href={`/compare?models=${encodeURIComponent(entry.modelId)}`}
                    className={cn(
                      "block border-l-2 py-1 pl-2.5 transition-colors hover:bg-surface-2",
                      style.border,
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <Icon className={cn("size-3 shrink-0", style.accent)} aria-hidden="true" />
                      <span className="truncate text-xs font-medium">
                        {model?.name ?? entry.modelId}
                      </span>
                      {mentions > 0 && (
                        <span className="ml-auto shrink-0 tnum text-2xs text-muted-foreground">
                          {mentions} stor{mentions === 1 ? "y" : "ies"}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-2xs text-muted-foreground">
                      {entry.detail}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </RailCard>
      )}

      {trending.length > 0 && (
        <RailCard title="Most mentioned">
          <div className="flex flex-wrap gap-1.5">
            {trending.map((id) => {
              const model = getModelById(id);
              return (
                <Link
                  key={id}
                  href={`/compare?models=${encodeURIComponent(id)}`}
                  className="rounded-md border border-action/25 bg-action/5 px-2 py-1 text-2xs text-action transition-colors hover:bg-action/15"
                >
                  {model?.name ?? id}
                </Link>
              );
            })}
          </div>
        </RailCard>
      )}

      {topSources.length > 0 && (
        <RailCard title="Top sources">
          <ul className="space-y-0.5">
            {topSources.map((source) => (
              <li key={source.id}>
                <button
                  type="button"
                  onClick={() => onFilterSource(source.id)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-surface-2"
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: sourceAccent(source.id) }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">{source.name}</span>
                  {source.tier === "first_party" && (
                    <Badge variant="outline" className="shrink-0 px-1 py-0 text-2xs">
                      1st
                    </Badge>
                  )}
                  <span className="shrink-0 tnum text-2xs text-muted-foreground">
                    {source.count}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </RailCard>
      )}

      <RailCard title="Your reading">
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onShowSaved}
            disabled={savedCount === 0}
            className="justify-start"
          >
            <Bookmark aria-hidden="true" />
            {savedCount > 0 ? `${savedCount} saved` : "Nothing saved yet"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onMarkAllRead}
            className="justify-start"
            disabled={readCount === 0 && true}
          >
            <CheckCheck aria-hidden="true" />
            Mark everything read
          </Button>
        </div>
      </RailCard>

      <div className="rounded-2xl border border-border bg-surface-2/40 p-3">
        <VerificationDisclosure />
      </div>
    </aside>
  );
}

function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-3">
      <h2 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}
