"use client";

import * as React from "react";
import { ArrowUpRight, Sunrise } from "lucide-react";
import { selectDigestStories } from "@/lib/news/digest";
import { relativeTime } from "@/lib/news/format";
import { DEFAULT_PUSH_PREFERENCES } from "@/lib/push/types";
import type { NewsArticle } from "@/lib/news/types";
import { cn } from "@/lib/utils";
import { NewsImage } from "./news-image";
import { VerificationBadge } from "./news-verification";

// Today's brief, on the page.
//
// The same stories, chosen by the same function, that the daily notification
// carries — `selectDigestStories` is imported rather than re-implemented, so the
// two can never drift. That equivalence is the point of the component: a reader
// deciding whether to turn notifications on can see exactly what they would have
// received this morning, and a reader who never turns them on still gets the
// edited view rather than only the firehose.
//
// It sits above the feed and is deliberately short. A brief that scrolls is a
// feed with extra steps.

export function NewsBrief({
  articles,
  mounted,
  onOpen,
  className,
}: {
  articles: readonly NewsArticle[];
  mounted?: boolean;
  onOpen: (article: NewsArticle) => void;
  className?: string;
}) {
  // `now` is read once per render rather than per story, so every relative time
  // in the block is measured from the same instant — otherwise two stories
  // published in the same minute can render as "2h ago" and "3h ago".
  const stories = React.useMemo(
    () =>
      selectDigestStories({
        articles,
        preferences: { ...DEFAULT_PUSH_PREFERENCES, maxStories: 5 },
        now: Date.now(),
      }),
    [articles],
  );

  // Under three stories this is not a brief, it is a card with a headline in it,
  // and the feed immediately below already says the same thing better.
  if (stories.length < 3) return null;

  const [lead, ...rest] = stories;

  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-surface",
        className,
      )}
      aria-labelledby="news-brief-heading"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h2
          id="news-brief-heading"
          className="flex items-center gap-2 font-display text-sm font-semibold"
        >
          <Sunrise className="size-4 text-action" aria-hidden="true" />
          Today&rsquo;s brief
        </h2>
        <p className="text-2xs uppercase tracking-wide text-muted-foreground">
          {stories.length} stories
        </p>
      </header>

      <div className="grid gap-px bg-border sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* The lead, with its picture at size. Every story in a brief is
            guaranteed to have one — `selectDigestStories` requires it — which is
            what makes this layout safe to commit to. */}
        <button
          type="button"
          onClick={() => onOpen(lead)}
          className="group relative flex min-h-[13rem] flex-col justify-end bg-surface text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-action"
        >
          <NewsImage
            image={lead.image}
            alt={lead.title}
            seed={lead.id}
            priority
            className="absolute inset-0"
            imgClassName="transition-transform duration-700 group-hover:scale-[1.03]"
            sizes="(min-width: 1280px) 620px, (min-width: 640px) 55vw, 100vw"
          />
          {/* The scrim, not a blanket opacity on the image: text over a dimmed
              photograph is grey on grey, text over a gradient is readable and the
              picture keeps its contrast. */}
          <div
            className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent"
            aria-hidden="true"
          />
          <div className="relative space-y-1.5 p-4">
            <div className="flex items-center gap-2 text-2xs text-white/75">
              <span className="font-medium text-white/90">{lead.sourceName}</span>
              {mounted && <time dateTime={lead.publishedAt}>{relativeTime(lead.publishedAt)}</time>}
            </div>
            <h3 className="font-display text-lg font-semibold leading-tight text-white">
              {lead.title}
            </h3>
          </div>
        </button>

        <ol className="divide-y divide-border bg-surface">
          {rest.map((article, index) => (
            <li key={article.id}>
              <button
                type="button"
                onClick={() => onOpen(article)}
                className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-action"
              >
                <span
                  className="mt-0.5 font-mono text-2xs tabular-nums text-muted-foreground"
                  aria-hidden="true"
                >
                  {String(index + 2).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="line-clamp-2 block text-xs font-medium leading-snug group-hover:text-action">
                    {article.title}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground">
                    <span>{article.sourceName}</span>
                    <VerificationBadge
                      verification={article.verification}
                      article={article}
                      compact
                    />
                  </span>
                </span>
                <ArrowUpRight
                  className="mt-0.5 size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  aria-hidden="true"
                />
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
