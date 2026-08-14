"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, X } from "lucide-react";
import type { CatalogDiffEntry } from "@/lib/catalog/snapshot";
import { announce } from "@/lib/atlas-events";
import { useMounted } from "@/lib/hooks/use-media-query";
import {
  DEFAULT_FILTERS,
  clusterSiblings,
  relatedArticles,
  selectArticles,
  toNewsSearchParams,
} from "@/lib/news/select";
import { TOPIC_IDS } from "@/lib/news/topics";
import type { NewsArticle, NewsFilterState, NewsSnapshot, NewsView } from "@/lib/news/types";
import { useNewsStore } from "@/lib/store/news-store";
import { NewsDetailDrawer } from "./news-detail-drawer";
import { NewsColdStart, NewsFilteredEmpty, NewsOffline } from "./news-empty";
import { NewsFeed } from "./news-feed";
import { NewsFilterBar } from "./news-filter-bar";
import { NewsHero } from "./news-hero";
import { NewsRail } from "./news-rail";
import type { SyncState } from "./news-sync-pill";

// The /news orchestrator.
//
// Owns filter state, URL synchronisation, the keyboard model, the refresh
// lifecycle and the screen-reader announcements. Everything below it is
// presentational, which is why none of those components needs to know about the
// router or the store.

const VIEW_CYCLE: NewsView[] = ["magazine", "grid", "compact", "timeline"];

/** Articles pulled in one client request. Matches the API route's `limit` ceiling. */
const CORPUS_PAGE = 300;

/** Cold-start poll: how often to re-check, and for how long, before giving up. */
const COLD_POLL_MS = 4_000;
const COLD_POLL_ATTEMPTS = 15;

export function NewsClient({
  snapshot,
  totalArticles,
  catalogDiff,
  initial,
  publicRefresh,
}: {
  snapshot: NewsSnapshot;
  /**
   * Articles in the *server's* corpus. The `snapshot` prop carries only the
   * highest-ranked slice of it (see `PAGE_ARTICLE_LIMIT`), so this is how the
   * client knows a tail exists and is worth fetching.
   */
  totalArticles: number;
  catalogDiff: readonly CatalogDiffEntry[];
  initial: NewsFilterState;
  /** Whether the operator left the public Refresh endpoint enabled. */
  publicRefresh: boolean;
}) {
  const mounted = useMounted();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [filters, setFilters] = React.useState<NewsFilterState>(initial);
  const [syncState, setSyncState] = React.useState<SyncState>({ kind: "idle" });
  const [live, setLive] = React.useState<NewsSnapshot>(snapshot);
  const [dismissedWarning, setDismissedWarning] = React.useState(false);

  const searchRef = React.useRef<HTMLInputElement>(null);
  const feedRef = React.useRef<HTMLDivElement>(null);

  // A fresh server render (navigation back to /news) must win over stale client
  // state from the last visit.
  React.useEffect(() => setLive(snapshot), [snapshot]);

  /**
   * Pull the current corpus from the API and adopt it.
   *
   * The single reconciliation path: the page prop is only ever the top slice,
   * and on a cold start it is empty entirely. Returns the article count so a
   * caller can report what changed.
   */
  const pullCorpus = React.useCallback(async (): Promise<number | null> => {
    try {
      const response = await fetch(`/api/v1/news?limit=${CORPUS_PAGE}`, { cache: "no-store" });
      if (!response.ok) return null;
      const fresh = await response.json();
      if (!Array.isArray(fresh.articles)) return null;

      setLive((prev) => ({
        ...prev,
        version: fresh.version ?? prev.version,
        syncedAt: fresh.syncedAt ?? prev.syncedAt,
        origin: fresh.origin ?? prev.origin,
        articles: fresh.articles,
        clusters: fresh.clusters ?? prev.clusters,
        sources: fresh.sources ?? prev.sources,
        stats: fresh.stats ?? prev.stats,
        warnings: fresh.warnings ?? [],
      }));
      return fresh.articles.length as number;
    } catch {
      // Offline, or the route is down. The page keeps rendering what it has.
      return null;
    }
  }, []);

  // The tail. The server sends the top slice so the document stays small; the
  // rest arrives immediately after mount, before the reader has scrolled past
  // what they were given.
  React.useEffect(() => {
    if (totalArticles <= snapshot.articles.length) return;
    void pullCorpus();
  }, [totalArticles, snapshot.articles.length, pullCorpus]);

  /**
   * Cold start.
   *
   * The first request to a fresh server sees an empty corpus, schedules the
   * sweep behind the response, and renders "the first sync is still running".
   * Without this the page would say that forever: the sweep finishes seconds
   * later on the server, but nothing tells the already-rendered client. Polling
   * stops the moment articles arrive, and gives up rather than hammering.
   */
  React.useEffect(() => {
    if (live.articles.length > 0) return;

    let cancelled = false;
    let attempts = 0;

    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      const count = await pullCorpus();
      if (cancelled) return;
      if (count && count > 0) {
        announce(`${count} stories loaded`);
        return;
      }
      if (attempts < COLD_POLL_ATTEMPTS) timer = window.setTimeout(tick, COLD_POLL_MS);
    };

    let timer = window.setTimeout(tick, COLD_POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [live.articles.length, pullCorpus]);

  const saved = useNewsStore((s) => s.saved);
  const read = useNewsStore((s) => s.read);
  const toggleSaved = useNewsStore((s) => s.toggleSaved);
  const markRead = useNewsStore((s) => s.markRead);
  const markAllRead = useNewsStore((s) => s.markAllRead);
  const prune = useNewsStore((s) => s.prune);

  const savedIds = React.useMemo(() => new Set(saved), [saved]);
  const readIds = React.useMemo(() => new Set(read), [read]);

  // Persisted ids accumulate across weeks while articles age out after two, so
  // the store is healed once against the live corpus — the same pattern
  // `<CatalogHeal>` applies to a stale `activeModelId`.
  React.useEffect(() => {
    if (!live.articles.length) return;
    prune(new Set(live.articles.map((a) => a.id)));
  }, [live.articles, prune]);

  // --- URL synchronisation --------------------------------------------------

  React.useEffect(() => {
    const query = toNewsSearchParams(filters);
    if (query === searchParams.toString()) return;
    // `replace`, not `push`: a filter change is not a navigation. `scroll:
    // false` stops the feed jumping to the top on every keystroke.
    router.replace(query ? `/news?${query}` : "/news", { scroll: false });
    // `searchParams` is intentionally excluded — reacting to our own write loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, router]);

  const patch = React.useCallback((next: Partial<NewsFilterState>) => {
    setFilters((prev) => ({ ...prev, ...next }));
  }, []);

  const clearFilters = React.useCallback(() => {
    setFilters((prev) => ({ ...DEFAULT_FILTERS, sort: prev.sort, view: prev.view }));
    announce("Filters cleared");
  }, []);

  // --- Selection ------------------------------------------------------------

  const selection = React.useMemo(
    () =>
      selectArticles({
        articles: live.articles,
        clusters: live.clusters,
        filters,
        saved: savedIds,
      }),
    [live.articles, live.clusters, filters, savedIds],
  );

  const openArticle = React.useMemo(
    () => live.articles.find((a) => a.id === filters.articleId) ?? null,
    [live.articles, filters.articleId],
  );

  const siblings = React.useMemo(
    () => (openArticle ? clusterSiblings(openArticle, live.clusters, live.articles) : []),
    [openArticle, live.clusters, live.articles],
  );

  const related = React.useMemo(
    () => (openArticle ? relatedArticles(openArticle, live.articles) : []),
    [openArticle, live.articles],
  );

  const latest = React.useMemo(
    () =>
      [...live.articles]
        .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
        .slice(0, 12),
    [live.articles],
  );

  // Announce the result of a filter change, so a screen-reader user learns the
  // count without going hunting for it.
  const previousCount = React.useRef(selection.articles.length);
  React.useEffect(() => {
    if (!mounted || previousCount.current === selection.articles.length) return;
    previousCount.current = selection.articles.length;
    announce(`${selection.articles.length} stories`);
  }, [selection.articles.length, mounted]);

  // --- Open / save ----------------------------------------------------------

  const handleOpen = React.useCallback(
    (article: NewsArticle) => {
      patch({ articleId: article.id });
      markRead(article.id);
    },
    [patch, markRead],
  );

  const handleClose = React.useCallback(() => patch({ articleId: undefined }), [patch]);

  const handleToggleSave = React.useCallback(
    (id: string) => {
      const wasSaved = savedIds.has(id);
      toggleSaved(id);
      announce(wasSaved ? "Removed from saved" : "Saved");
    },
    [toggleSaved, savedIds],
  );

  // --- Refresh --------------------------------------------------------------

  const refresh = React.useCallback(async () => {
    if (syncState.kind === "syncing") return;
    setSyncState({ kind: "syncing" });
    announce("Syncing news");

    try {
      const response = await fetch("/api/v1/news/refresh", {
        method: "POST",
        // The CSRF guard: a cross-origin form POST cannot set a custom header
        // without a preflight, and the route sends no CORS headers.
        headers: { "x-atlas-refresh": "1" },
      });

      if (response.status === 429) {
        const body = await response.json();
        setSyncState({ kind: "rate_limited", retryAfterSeconds: body.retryAfterSeconds ?? 60 });
        announce("Too many refreshes. Try again shortly.");
        return;
      }
      if (!response.ok) throw new Error(`Refresh failed (${response.status})`);

      const body = await response.json();

      const before = live.articles.length;

      if (body.status === "fresh") {
        // The server's global cooldown: no upstream sweep ran. That does NOT
        // mean this page is showing what the server has.
        //
        // The bug this guards against was the whole feature failing in front of
        // a reader: a cold-start page renders empty, the background sweep fills
        // the server's corpus seconds later, and the reader presses Sync now.
        // The cooldown answers "fresh", and returning here left them staring at
        // "the first sync is still running" while 245 stories sat one fetch
        // away. Whenever the server's corpus differs from ours, adopt it —
        // "up to date" has to mean the screen is, not just the server.
        const stale =
          body.syncedAt !== live.syncedAt || (body.articles ?? 0) !== before;
        if (stale) {
          const count = await pullCorpus();
          if (count !== null) {
            setDismissedWarning(false);
            setSyncState({ kind: "synced", added: Math.max(0, count - before) });
            announce(count > before ? `${count - before} new stories.` : "Up to date.");
            return;
          }
        }

        setSyncState({ kind: "fresh", nextEligibleAt: body.nextEligibleAt });
        announce("Already up to date");
        return;
      }

      const count = await pullCorpus();
      setDismissedWarning(false);

      const added = Math.max(0, (count ?? before) - before);
      setSyncState({ kind: "synced", added });
      announce(added > 0 ? `Synced. ${added} new stories.` : "Synced. Nothing new.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Refresh failed";
      setSyncState({ kind: "error", message });
      announce(message);
    }
  }, [syncState.kind, live.articles.length, live.syncedAt, pullCorpus]);

  // --- Keyboard -------------------------------------------------------------

  React.useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      return (
        el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.isContentEditable
      );
    };

    const cards = (): HTMLElement[] =>
      Array.from(feedRef.current?.querySelectorAll<HTMLElement>("[data-news-card]") ?? []);

    const move = (delta: number) => {
      const list = cards();
      if (!list.length) return;
      const index = list.findIndex((el) => el === document.activeElement);
      const next = list[Math.max(0, Math.min(list.length - 1, index + delta))] ?? list[0];
      next.focus();
      next.scrollIntoView({ block: "nearest" });
    };

    const focusedArticle = (): NewsArticle | undefined => {
      const id = (document.activeElement as HTMLElement | null)?.dataset?.newsCard;
      return id ? live.articles.find((a) => a.id === id) : undefined;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const typing = isTypingTarget(event.target);

      // `/` and `r` are global, matching the app-wide shortcut convention.
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === "r" && !typing && !event.shiftKey) {
        event.preventDefault();
        if (publicRefresh) void refresh();
        return;
      }
      if (typing) return;

      // `g` works anywhere on the page; everything else needs feed focus, so it
      // cannot steal keys from the rail or the drawer.
      const inFeed = Boolean(
        feedRef.current && document.activeElement && feedRef.current.contains(document.activeElement),
      );
      if (!inFeed && event.key !== "g") return;

      switch (event.key) {
        case "j":
        case "ArrowDown":
          event.preventDefault();
          move(1);
          break;
        case "k":
        case "ArrowUp":
          event.preventDefault();
          move(-1);
          break;
        case "o": {
          const article = focusedArticle();
          if (article) {
            event.preventDefault();
            handleOpen(article);
          }
          break;
        }
        case "Enter": {
          if (!event.shiftKey) break;
          const article = focusedArticle();
          if (article) {
            event.preventDefault();
            window.open(article.url, "_blank", "noopener,noreferrer");
          }
          break;
        }
        case "s": {
          const article = focusedArticle();
          if (article) {
            event.preventDefault();
            handleToggleSave(article.id);
          }
          break;
        }
        case "v":
          event.preventDefault();
          patch({ verifiedOnly: !filters.verifiedOnly });
          announce(filters.verifiedOnly ? "Showing all stories" : "Showing verified only");
          break;
        case "g": {
          event.preventDefault();
          const next = VIEW_CYCLE[(VIEW_CYCLE.indexOf(filters.view) + 1) % VIEW_CYCLE.length];
          patch({ view: next });
          announce(`${next} layout`);
          break;
        }
        default: {
          if (!/^[1-9]$/.test(event.key)) break;
          const topic = TOPIC_IDS[Number(event.key) - 1];
          if (!topic) break;
          event.preventDefault();
          patch({
            topics: filters.topics.includes(topic)
              ? filters.topics.filter((t) => t !== topic)
              : [...filters.topics, topic],
          });
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filters, live.articles, handleOpen, handleToggleSave, patch, refresh, publicRefresh]);

  // --- Render ---------------------------------------------------------------

  const sourceName = React.useCallback(
    (id: string) => live.sources.find((s) => s.id === id)?.name ?? id,
    [live.sources],
  );

  const coldStart = live.articles.length === 0;
  const everythingFailed = coldStart && live.warnings.some((w) => w.startsWith("All "));

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:py-10">
      <NewsHero
        snapshot={live}
        latest={latest}
        syncState={syncState}
        canRefresh={publicRefresh}
        mounted={mounted}
        onRefresh={refresh}
        onOpen={handleOpen}
        onShowSources={() =>
          document.getElementById("news-feed")?.scrollIntoView({ behavior: "smooth" })
        }
      />

      {!coldStart && (
        <NewsFilterBar
          filters={filters}
          topicCounts={selection.topicCounts}
          sourceCounts={selection.sourceCounts}
          sources={live.sources}
          showing={selection.articles.length}
          total={selection.total}
          savedCount={saved.length}
          searchRef={searchRef}
          onChange={patch}
          onClear={clearFilters}
        />
      )}

      {/* Partial failure. Dismissible — a reader who has seen it once does not
          need it every render — but never hidden by default. */}
      {live.warnings.length > 0 && !dismissedWarning && !coldStart && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber/30 bg-amber/5 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber" aria-hidden="true" />
          <p className="flex-1 text-muted-foreground">{live.warnings[0]}</p>
          <button
            type="button"
            onClick={() => setDismissedWarning(true)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Dismiss warning"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div id="news-feed" ref={feedRef}>
          {everythingFailed ? (
            <NewsOffline warnings={live.warnings} />
          ) : coldStart ? (
            <NewsColdStart
              syncing={syncState.kind === "syncing"}
              onRefresh={publicRefresh ? refresh : undefined}
            />
          ) : selection.articles.length === 0 ? (
            <NewsFilteredEmpty
              filters={filters}
              sourceName={sourceName}
              onClearTopic={(topic) => patch({ topics: filters.topics.filter((t) => t !== topic) })}
              onClearSource={(id) => patch({ sources: filters.sources.filter((s) => s !== id) })}
              onClearQuery={() => patch({ query: "" })}
              onClearAll={clearFilters}
            />
          ) : (
            <NewsFeed
              articles={selection.articles}
              clusters={live.clusters}
              allArticles={live.articles}
              view={filters.view}
              query={filters.query}
              savedIds={savedIds}
              readIds={readIds}
              mounted={mounted}
              busy={syncState.kind === "syncing"}
              onOpen={handleOpen}
              onToggleSave={handleToggleSave}
            />
          )}
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <NewsRail
            catalogDiff={catalogDiff}
            articles={live.articles}
            sources={live.sources}
            savedCount={saved.length}
            readCount={read.length}
            onFilterSource={(id) => patch({ sources: filters.sources.includes(id) ? [] : [id] })}
            onShowSaved={() => patch({ savedOnly: !filters.savedOnly })}
            onMarkAllRead={() => {
              markAllRead(selection.articles.map((a) => a.id));
              announce("All visible stories marked read");
            }}
          />
        </div>
      </div>

      <NewsDetailDrawer
        article={openArticle}
        siblings={siblings}
        related={related}
        saved={openArticle ? savedIds.has(openArticle.id) : false}
        mounted={mounted}
        onClose={handleClose}
        onToggleSave={handleToggleSave}
        onOpenArticle={handleOpen}
      />
    </div>
  );
}
