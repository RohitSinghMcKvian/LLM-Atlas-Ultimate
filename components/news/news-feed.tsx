"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useInfiniteReveal } from "@/lib/hooks/use-infinite-reveal";
import { dayKey, dayLabel } from "@/lib/news/format";
import type { NewsArticle, NewsCluster, NewsView } from "@/lib/news/types";
import { cn } from "@/lib/utils";
import { NewsCard, type NewsCardVariant } from "./news-card";

// The feed itself: one list, four layouts.
//
// A single `<ul role="feed">` in every mode rather than a different tree per
// layout, so the keyboard model, the ARIA positions and the roving focus in
// `news-client.tsx` work identically whichever view is selected.

export interface NewsFeedProps {
  articles: NewsArticle[];
  clusters: readonly NewsCluster[];
  allArticles: readonly NewsArticle[];
  view: NewsView;
  query?: string;
  savedIds: ReadonlySet<string>;
  readIds: ReadonlySet<string>;
  mounted?: boolean;
  busy?: boolean;
  onOpen: (article: NewsArticle) => void;
  onToggleSave: (id: string) => void;
}

/**
 * Cards mounted before the reader scrolls, and per chunk after.
 *
 * Grid layouts show a handful of rows at a time, so 24 covers a tall screen with
 * room to spare; compact rows are ~48px, hence the larger first chunk there.
 */
const REVEAL = { magazine: 24, grid: 24, compact: 60, timeline: 60 } as const;

export function NewsFeed({
  articles: allSelected,
  clusters,
  allArticles,
  view,
  query,
  savedIds,
  readIds,
  mounted,
  busy,
  onOpen,
  onToggleSave,
}: NewsFeedProps) {
  const reducedMotion = useReducedMotion();

  // Chunked reveal, the same treatment `/leaderboard` gives ~400 models. The
  // corpus runs to several hundred articles and every card carries an image, a
  // verification badge and a cluster lookup — mounting the lot costs the first
  // commit and every re-render after it, for rows nobody has scrolled to.
  const chunk = REVEAL[view];
  const { limit, sentinelRef, hasMore } = useInfiniteReveal(allSelected.length, {
    initial: chunk,
    step: chunk,
    // A different filter, sort or layout is a different list; keeping a large
    // limit would mount hundreds of rows the reader never asked for.
    resetKey: `${view}|${query ?? ""}|${allSelected.length}|${allSelected[0]?.id ?? ""}`,
  });

  const articles = React.useMemo(
    () => (limit >= allSelected.length ? allSelected : allSelected.slice(0, limit)),
    [allSelected, limit],
  );

  const sentinel = hasMore ? (
    <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />
  ) : null;

  // Cluster siblings, resolved once per render rather than per card.
  const siblingsByArticle = React.useMemo(() => {
    const byId = new Map(allArticles.map((a) => [a.id, a]));
    const byCluster = new Map(clusters.map((c) => [c.id, c]));
    const out = new Map<string, NewsArticle[]>();

    for (const article of articles) {
      const cluster = byCluster.get(article.clusterId);
      if (!cluster || cluster.memberIds.length < 2) continue;
      out.set(
        article.id,
        cluster.memberIds
          .filter((id) => id !== article.id)
          .map((id) => byId.get(id))
          .filter((a): a is NewsArticle => Boolean(a)),
      );
    }
    return out;
  }, [articles, clusters, allArticles]);

  const cardFor = (
    article: NewsArticle,
    index: number,
    variant: NewsCardVariant,
    className?: string,
  ) => (
    <NewsCard
      key={article.id}
      className={className}
      article={article}
      variant={variant}
      siblings={siblingsByArticle.get(article.id) ?? []}
      query={query}
      saved={savedIds.has(article.id)}
      read={readIds.has(article.id)}
      mounted={mounted}
      priority={index === 0}
      onOpen={onOpen}
      onToggleSave={onToggleSave}
      index={index}
      // The full selection, not the revealed slice: a screen reader should hear
      // "3 of 240", not a total that grows as the reader scrolls.
      setSize={allSelected.length}
    />
  );

  const listProps = {
    role: "feed" as const,
    "aria-busy": busy,
    "aria-label": "AI news stories",
  };

  if (view === "timeline") {
    // Grouped by publication day under sticky headers.
    //
    // Bucketed through a Map rather than by walking adjacent items: the feed
    // arrives in the reader's chosen sort order, which for anything but "Latest"
    // is not chronological. Grouping consecutive runs produced 188 single-item
    // "days" out of 340 articles — a timeline with a header above almost every
    // row. The days are then ordered newest-first, while the order *within* each
    // day still honours the selected sort.
    const buckets = new Map<string, NewsArticle[]>();
    for (const article of articles) {
      const key = dayKey(article.publishedAt);
      const bucket = buckets.get(key);
      if (bucket) bucket.push(article);
      else buckets.set(key, [article]);
    }

    const groups = [...buckets.entries()]
      .map(([key, items]) => ({ key, items }))
      .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));

    let cursor = 0;
    return (
      <>
      <ul {...listProps} className="space-y-6">
        {groups.map((group) => {
          const start = cursor;
          cursor += group.items.length;
          return (
            <li key={group.key}>
              <h2 className="sticky top-[3.25rem] z-10 -mx-1 mb-1 bg-background/85 px-1 py-1.5 font-display text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                {mounted ? dayLabel(group.key) : group.key}
              </h2>
              <div className="relative pl-4">
                <span
                  className="absolute inset-y-0 left-1 w-px bg-gradient-to-b from-action/40 via-border to-transparent"
                  aria-hidden="true"
                />
                <ul className="rounded-xl border border-border bg-surface">
                  {group.items.map((article, i) => cardFor(article, start + i, "compact"))}
                </ul>
              </div>
            </li>
          );
        })}
      </ul>
      {sentinel}
      </>
    );
  }

  if (view === "compact") {
    return (
      <>
        <ul {...listProps} className="overflow-hidden rounded-2xl border border-border bg-surface">
          {articles.map((article, index) => cardFor(article, index, "compact"))}
        </ul>
        {sentinel}
      </>
    );
  }

  if (view === "magazine") {
    // The top story spans the grid; the rest fall in behind it. Below `sm` this
    // collapses to one column, which is why the lead does not get a bespoke
    // two-column treatment — it would only exist above one breakpoint.
    return (
      <>
        <motion.ul
          {...listProps}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
          initial={reducedMotion ? false : "hidden"}
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.03 } } }}
        >
          {articles.map((article, index) =>
            cardFor(
              article,
              index,
              index === 0 ? "magazine" : "grid",
              // The class lands on the `<li>`, which is the grid item. Wrapping it
              // in a `display: contents` div would put the span on a box the grid
              // does not lay out.
              index === 0 ? "sm:col-span-2" : undefined,
            ),
          )}
        </motion.ul>
        {sentinel}
      </>
    );
  }

  return (
    <>
      <ul {...listProps} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {articles.map((article, index) => cardFor(article, index, "grid"))}
      </ul>
      {sentinel}
    </>
  );
}
