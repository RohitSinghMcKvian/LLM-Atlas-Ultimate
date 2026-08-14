"use client";

import * as React from "react";
import Link from "next/link";
import { Bookmark, BookmarkCheck, ExternalLink, Flag, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getModelById, blendedPrice, intelligenceIndex } from "@/lib/catalog";
import { absoluteTime, fullTime, relativeTime, sourceAccent, sourceMonogram } from "@/lib/news/format";
import { topicLabel } from "@/lib/news/topics";
import type { NewsArticle } from "@/lib/news/types";
import { cn } from "@/lib/utils";
import { NewsClusterList } from "./news-cluster-list";
import { NewsImage } from "./news-image";
import { VerificationDisclosure, VerificationPanel } from "./news-verification";

// The deep dive.
//
// Shared by the drawer and by `/news/[id]`, so a story reads identically whether
// it was opened in-session or arrived as a shared link.
//
// The governing rule: **nothing on this page is asserted by Atlas.** Every claim
// carries its source, the machine-written abstract is labelled as such, and the
// primary action is to leave for the publisher's own page.

export function NewsDetailBody({
  article,
  siblings,
  related,
  saved,
  mounted,
  onToggleSave,
  onOpenArticle,
}: {
  article: NewsArticle;
  siblings: NewsArticle[];
  related: NewsArticle[];
  saved?: boolean;
  mounted?: boolean;
  onToggleSave?: (id: string) => void;
  onOpenArticle?: (article: NewsArticle) => void;
}) {
  return (
    <article className="space-y-5">
      <div className="relative -mx-6 -mt-6 aspect-[2/1] overflow-hidden sm:rounded-t-2xl">
        <NewsImage
          image={article.image}
          alt={article.title}
          seed={article.id}
          priority
          className="h-full w-full"
          sizes="(min-width: 640px) 36rem, 100vw"
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-popover via-popover/20 to-transparent"
          aria-hidden="true"
        />
      </div>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span
            className="grid size-5 place-items-center rounded-md text-2xs font-bold text-background"
            style={{ backgroundColor: sourceAccent(article.sourceId) }}
            aria-hidden="true"
          >
            {sourceMonogram(article.sourceName)}
          </span>
          <span className="font-medium text-foreground">{article.sourceName}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">{article.host}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={article.publishedAt} title={fullTime(article.publishedAt)}>
            {mounted ? relativeTime(article.publishedAt) : absoluteTime(article.publishedAt)}
          </time>
          {article.author && (
            <>
              <span aria-hidden="true">·</span>
              <span>{article.author}</span>
            </>
          )}
          {article.readMinutes && (
            <>
              <span aria-hidden="true">·</span>
              <span>{article.readMinutes} min read</span>
            </>
          )}
        </div>

        <h1 className="text-balance font-display text-xl font-bold leading-tight sm:text-2xl">
          {article.title}
        </h1>

        <div className="flex flex-wrap gap-1.5">
          {article.topics.map((topic) => (
            <Badge key={topic} variant="outline" className="text-2xs">
              {topicLabel(topic)}
            </Badge>
          ))}
        </div>
      </header>

      <VerificationPanel verification={article.verification} article={article} />

      {article.summary && (
        <p className="text-sm leading-relaxed text-foreground/90">{article.summary}</p>
      )}

      {/* An LLM-written abstract is always labelled. A reader must be able to
          tell at a glance which sentences came from the publisher's own feed and
          which a model produced. */}
      {article.abstract && (
        <aside className="rounded-xl border border-accent/25 bg-accent/5 p-3">
          <p className="mb-1.5 inline-flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-accent">
            <Sparkles className="size-3" aria-hidden="true" />
            AI-generated abstract — verify against the source
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">{article.abstract}</p>
        </aside>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" asChild className="flex-1 sm:flex-none">
          <a href={article.url} target="_blank" rel="noreferrer noopener">
            <ExternalLink aria-hidden="true" />
            Read the original on {article.host}
          </a>
        </Button>
        {onToggleSave && (
          <Button variant="outline" onClick={() => onToggleSave(article.id)} aria-pressed={saved}>
            {saved ? (
              <BookmarkCheck className="text-action" aria-hidden="true" />
            ) : (
              <Bookmark aria-hidden="true" />
            )}
            {saved ? "Saved" : "Save"}
          </Button>
        )}
      </div>

      {siblings.length > 0 && (
        <section aria-labelledby="also-reported">
          <h2
            id="also-reported"
            className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Also reported by
          </h2>
          <NewsClusterList articles={siblings} mounted={mounted} />
        </section>
      )}

      {article.models.length > 0 && (
        <section aria-labelledby="related-models">
          <h2
            id="related-models"
            className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Models mentioned
          </h2>
          <ul className="space-y-1.5">
            {article.models.map((id) => {
              const model = getModelById(id);
              if (!model) return null;
              const price = blendedPrice(model);
              return (
                <li key={id}>
                  <Link
                    href={`/compare?models=${encodeURIComponent(id)}`}
                    className="flex items-center gap-2 rounded-xl border border-border bg-surface-2/50 px-3 py-2 transition-colors hover:border-border-strong hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{model.name}</span>
                      <span className="block text-2xs text-muted-foreground">
                        {model.provider} · {(model.contextWindow / 1000).toFixed(0)}k ctx
                        {price > 0 && ` · $${price.toFixed(2)}/Mtok`}
                        {` · index ${intelligenceIndex(model).toFixed(0)}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-2xs text-action">Compare →</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {related.length > 0 && (
        <section aria-labelledby="related-stories">
          <h2
            id="related-stories"
            className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Related
          </h2>
          <ul className="space-y-1">
            {related.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onOpenArticle?.(item)}
                  disabled={!onOpenArticle}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                    onOpenArticle ? "hover:bg-surface-2" : "cursor-default",
                  )}
                >
                  <span
                    className="mt-1 size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: sourceAccent(item.sourceId) }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-xs leading-snug">{item.title}</span>
                    <span className="mt-0.5 block font-mono text-2xs text-muted-foreground">
                      {item.host}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="space-y-3 border-t border-border pt-4">
        <VerificationDisclosure />
        <a
          href={`https://github.com/search?q=${encodeURIComponent(article.host)}`}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground hover:text-foreground"
        >
          <Flag className="size-3" aria-hidden="true" />
          Something wrong with this item?
        </a>
      </footer>
    </article>
  );
}
