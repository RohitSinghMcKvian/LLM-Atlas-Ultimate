"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Bookmark, BookmarkCheck, ExternalLink, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  absoluteTime,
  fullTime,
  highlightSegments,
  relativeTime,
  sourceAccent,
  sourceMonogram,
} from "@/lib/news/format";
import { topicLabel } from "@/lib/news/topics";
import type { NewsArticle } from "@/lib/news/types";
import { cn } from "@/lib/utils";
import { NewsImage } from "./news-image";
import { VerificationBadge } from "./news-verification";
import { NewsClusterList } from "./news-cluster-list";

export type NewsCardVariant = "magazine" | "grid" | "compact";

export interface NewsCardProps {
  article: NewsArticle;
  variant?: NewsCardVariant;
  /** Other articles in this article's cluster. */
  siblings?: NewsArticle[];
  query?: string;
  saved?: boolean;
  read?: boolean;
  /** Client-mounted: switch timestamps from absolute to relative. */
  mounted?: boolean;
  priority?: boolean;
  onOpen: (article: NewsArticle) => void;
  onToggleSave: (id: string) => void;
  index?: number;
  setSize?: number;
  /** Applied to the `<li>`, which IS the grid item — magazine uses it to span columns. */
  className?: string;
}

/** Highlighted title text, without dangerouslySetInnerHTML. */
function Title({ text, query }: { text: string; query?: string }) {
  if (!query?.trim()) return <>{text}</>;
  return (
    <>
      {highlightSegments(text, query).map((segment, i) =>
        segment.match ? (
          <mark key={i} className="rounded bg-cyan/20 px-0.5 text-foreground">
            {segment.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{segment.text}</React.Fragment>
        ),
      )}
    </>
  );
}

function SourceMark({ article }: { article: NewsArticle }) {
  return (
    <span
      className="grid size-5 shrink-0 place-items-center rounded-md text-[9px] font-bold text-background"
      style={{ backgroundColor: sourceAccent(article.sourceId) }}
      aria-hidden="true"
    >
      {sourceMonogram(article.sourceName)}
    </span>
  );
}

/** `<time>` that is absolute on the server and relative once hydrated. */
function ArticleTime({ iso, mounted }: { iso: string; mounted?: boolean }) {
  return (
    <time dateTime={iso} title={fullTime(iso)} className="tnum">
      {mounted ? relativeTime(iso) : absoluteTime(iso)}
    </time>
  );
}

export function NewsCard({
  article,
  variant = "grid",
  siblings = [],
  query,
  saved,
  read,
  mounted,
  priority,
  onOpen,
  onToggleSave,
  index,
  setSize,
  className,
}: NewsCardProps) {
  const [expanded, setExpanded] = React.useState(false);
  const reducedMotion = useReducedMotion();
  const cardRef = React.useRef<HTMLElement>(null);

  // A pointer-tracked highlight, written straight to CSS custom properties.
  // Deliberately not React state: this fires on every mousemove, and a setState
  // there would re-render a card containing an image on every pixel.
  const handlePointerMove = React.useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (reducedMotion) return;
      const el = cardRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      el.style.setProperty("--my", `${event.clientY - rect.top}px`);
    },
    [reducedMotion],
  );

  const open = () => onOpen(article);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      // Space scrolls the page by default, which is not what a focused card means.
      event.preventDefault();
      open();
    }
  };

  const commonProps = {
    ref: cardRef as React.Ref<HTMLLIElement>,
    role: "article",
    "aria-posinset": index !== undefined ? index + 1 : undefined,
    "aria-setsize": setSize,
    "aria-labelledby": `news-title-${article.id}`,
    tabIndex: 0,
    onKeyDown: handleKeyDown,
    onMouseMove: handlePointerMove,
    "data-news-card": article.id,
  };

  // --- Compact: one row, no image. The power-reader layout. ---
  if (variant === "compact") {
    return (
      <li
        {...commonProps}
        onClick={open}
        className={cn(
          "group flex cursor-pointer items-center gap-3 border-b border-border/60 px-3 py-2.5 transition-colors",
          "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
          read && "opacity-60",
          className,
        )}
      >
        <SourceMark article={article} />
        <h3
          id={`news-title-${article.id}`}
          className="min-w-0 flex-1 truncate text-sm font-medium group-hover:text-foreground"
        >
          <Title text={article.title} query={query} />
        </h3>
        {siblings.length > 0 && (
          <Badge variant="outline" className="hidden shrink-0 gap-1 text-2xs sm:inline-flex">
            <Layers className="size-3" aria-hidden="true" />+{siblings.length}
          </Badge>
        )}
        <VerificationBadge verification={article.verification} article={article} compact />
        <span className="hidden shrink-0 font-mono text-2xs text-muted-foreground sm:inline">
          {article.host}
        </span>
        <span className="shrink-0 text-2xs text-muted-foreground">
          <ArticleTime iso={article.publishedAt} mounted={mounted} />
        </span>
      </li>
    );
  }

  // --- Magazine / grid: image card. ---
  const isMagazine = variant === "magazine";

  return (
    <li
      {...commonProps}
      onClick={open}
      className={cn(
        "group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-border bg-surface transition-all duration-300",
        "hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lift",
        "focus-within:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
        read && "opacity-70",
        read && "border-l-2 border-l-cyan/50",
        className,
      )}
    >
      {/* Pointer-tracked highlight. Pure CSS off the custom properties above. */}
      {!reducedMotion && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100 max-[900px]:hidden"
          style={{
            background:
              "radial-gradient(320px circle at var(--mx) var(--my), rgb(var(--cyan) / 0.07), transparent 70%)",
          }}
        />
      )}

      {/* A plain element, not a button: the `<li>` itself carries the role, the
          label, the tab stop and the Enter handler, so a nested button here
          would be a second control announcing the same thing — and marking that
          button `aria-hidden` to suppress it would leave an interactive element
          hidden from assistive tech, which is worse. Only genuinely distinct
          actions below (save, open source, expand cluster) are real controls,
          and each stops propagation. */}
      <div className="relative aspect-video w-full overflow-hidden">
        <NewsImage
          image={article.image}
          alt={article.title}
          seed={article.id}
          priority={priority}
          className="h-full w-full"
          imgClassName={cn(
            "transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
            !reducedMotion && "group-hover:scale-[1.04]",
          )}
        />
        {/* Scrim, so the overlaid chips stay legible on any photograph. */}
        <div
          className="absolute inset-0 bg-gradient-to-t from-surface via-surface/25 to-transparent"
          aria-hidden="true"
        />
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <span className="flex items-center gap-1.5 rounded-full bg-background/70 px-2 py-1 text-2xs font-medium backdrop-blur-sm">
            <SourceMark article={article} />
            <span className="max-w-[9rem] truncate">{article.sourceName}</span>
          </span>
          <VerificationBadge verification={article.verification} article={article} compact />
        </div>
      </div>

      <div className={cn("flex flex-1 flex-col gap-2 p-4", isMagazine && "sm:p-5")}>
        {article.topics.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {article.topics.slice(0, 2).map((topic) => (
              <Badge key={topic} variant="outline" className="px-2 py-0 text-2xs">
                {topicLabel(topic)}
              </Badge>
            ))}
          </div>
        )}

        <h3
          id={`news-title-${article.id}`}
          className={cn(
            "text-balance font-display font-semibold leading-snug",
            isMagazine ? "line-clamp-3 text-base" : "line-clamp-2 text-sm",
          )}
        >
          <span className="transition-colors group-hover:text-cyan">
            <Title text={article.title} query={query} />
          </span>
        </h3>

        {article.summary && (
          <p
            className={cn(
              "text-sm leading-relaxed text-muted-foreground",
              isMagazine ? "line-clamp-3" : "line-clamp-2",
            )}
          >
            <Title text={article.summary} query={query} />
          </p>
        )}

        {article.models.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {article.models.slice(0, 3).map((id) => (
              <Link
                key={id}
                href={`/compare?models=${encodeURIComponent(id)}`}
                onClick={(e) => e.stopPropagation()}
                className="rounded-md border border-cyan/25 bg-cyan/5 px-1.5 py-0.5 font-mono text-2xs text-cyan transition-colors hover:bg-cyan/15"
              >
                {id}
              </Link>
            ))}
          </div>
        )}

        <div className="mt-auto flex items-center gap-2 pt-2 text-2xs text-muted-foreground">
          {/* The domain is always printed. A reader should never have to trust
              our badge when they could just look at who published it. */}
          <span className="truncate font-mono">{article.host}</span>
          <span aria-hidden="true">·</span>
          <ArticleTime iso={article.publishedAt} mounted={mounted} />

          <div className="ml-auto flex items-center gap-0.5">
            {siblings.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((v) => !v);
                }}
                aria-expanded={expanded}
                className="flex items-center gap-1 rounded-md px-1.5 py-1 font-medium text-cyan transition-colors hover:bg-cyan/10"
              >
                <Layers className="size-3" aria-hidden="true" />+{siblings.length} source
                {siblings.length === 1 ? "" : "s"}
              </button>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSave(article.id);
                  }}
                  aria-label={saved ? "Remove from saved" : "Save story"}
                  aria-pressed={saved}
                  className="grid size-7 place-items-center rounded-md transition-colors hover:bg-surface-3 hover:text-foreground"
                >
                  {saved ? (
                    <BookmarkCheck className="size-3.5 text-cyan" aria-hidden="true" />
                  ) : (
                    <Bookmark className="size-3.5" aria-hidden="true" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>{saved ? "Saved" : "Save"}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={article.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Read the original on ${article.host} (opens in a new tab)`}
                  className="grid size-7 place-items-center rounded-md transition-colors hover:bg-surface-3 hover:text-foreground"
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              </TooltipTrigger>
              <TooltipContent>Open {article.host}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* "Also reported by", inline. Expanding here rather than only in the
            detail view is what makes a bad cluster merge visible and checkable
            rather than something that silently hides a story. */}
        <AnimatePresence initial={false}>
          {expanded && siblings.length > 0 && (
            <motion.div
              initial={reducedMotion ? false : { height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={reducedMotion ? undefined : { height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <NewsClusterList articles={siblings} mounted={mounted} className="pt-2" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </li>
  );
}
