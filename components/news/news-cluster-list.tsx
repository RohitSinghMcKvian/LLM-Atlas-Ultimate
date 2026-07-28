"use client";

import * as React from "react";
import { ExternalLink } from "lucide-react";
import { absoluteTime, fullTime, relativeTime, sourceAccent, sourceMonogram } from "@/lib/news/format";
import type { NewsArticle } from "@/lib/news/types";
import { cn } from "@/lib/utils";

// "Also reported by" — every other member of a story's cluster.
//
// This list is load-bearing for the trust model, not decoration. The
// corroboration count on a card is a claim; this is the evidence for it. Because
// every member is named, linked and timestamped, a wrong merge is something a
// reader can see and disbelieve, rather than a story that silently disappeared
// into someone else's cluster.

export function NewsClusterList({
  articles,
  mounted,
  className,
  heading,
}: {
  articles: NewsArticle[];
  mounted?: boolean;
  className?: string;
  heading?: string;
}) {
  if (!articles.length) return null;

  return (
    <div className={cn("rounded-xl border border-border bg-surface-2/50 p-2", className)}>
      {heading && (
        <p className="px-1 pb-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          {heading}
        </p>
      )}
      <ul className="space-y-0.5">
        {articles.map((article) => (
          <li key={article.id}>
            <a
              href={article.url}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => e.stopPropagation()}
              className="group flex items-start gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-surface-3"
            >
              <span
                className="mt-0.5 grid size-4 shrink-0 place-items-center rounded text-[8px] font-bold text-background"
                style={{ backgroundColor: sourceAccent(article.sourceId) }}
                aria-hidden="true"
              >
                {sourceMonogram(article.sourceName)}
              </span>

              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-xs leading-snug text-foreground/90 group-hover:text-foreground">
                  {article.title}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-2xs text-muted-foreground">
                  <span className="truncate font-mono">{article.host}</span>
                  <span aria-hidden="true">·</span>
                  <time dateTime={article.publishedAt} title={fullTime(article.publishedAt)}>
                    {mounted ? relativeTime(article.publishedAt) : absoluteTime(article.publishedAt)}
                  </time>
                </span>
              </span>

              <ExternalLink
                className="mt-0.5 size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden="true"
              />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
