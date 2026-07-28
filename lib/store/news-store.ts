"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { NewsSort, NewsView } from "@/lib/news/types";

// Per-reader news state: what they saved, what they have opened, and how they
// like the feed laid out.
//
// Persisted to localStorage, following `lib/store/ui-store.ts`. The corpus is
// rebuilt hourly and articles age out after two weeks, so the id sets here would
// grow forever and accumulate references to stories that no longer exist —
// `prune` is called once on mount with the live id set, the same healing pattern
// `<CatalogHeal>` applies to a persisted `activeModelId`.

/** Hard ceiling on retained ids, in case `prune` never runs (private mode, quota errors). */
const MAX_TRACKED = 4_000;

interface NewsState {
  saved: string[];
  read: string[];
  /** ISO instant of the reader's previous visit, for the "new since" marker. */
  lastVisitAt: string | null;
  sort: NewsSort;
  view: NewsView;

  toggleSaved: (id: string) => void;
  isSaved: (id: string) => boolean;
  markRead: (id: string) => void;
  markAllRead: (ids: readonly string[]) => void;
  clearRead: () => void;
  setSort: (sort: NewsSort) => void;
  setView: (view: NewsView) => void;
  /** Record this visit and return when the previous one was. */
  touchVisit: () => string | null;
  /** Drop ids that are no longer in the corpus. */
  prune: (liveIds: ReadonlySet<string>) => void;
}

const cap = (ids: string[]): string[] =>
  ids.length > MAX_TRACKED ? ids.slice(ids.length - MAX_TRACKED) : ids;

export const useNewsStore = create<NewsState>()(
  persist(
    (set, get) => ({
      saved: [],
      read: [],
      lastVisitAt: null,
      sort: "top",
      view: "magazine",

      toggleSaved: (id) =>
        set((state) => ({
          saved: state.saved.includes(id)
            ? state.saved.filter((x) => x !== id)
            : cap([...state.saved, id]),
        })),

      isSaved: (id) => get().saved.includes(id),

      markRead: (id) =>
        set((state) => (state.read.includes(id) ? state : { read: cap([...state.read, id]) })),

      markAllRead: (ids) =>
        set((state) => ({ read: cap([...new Set([...state.read, ...ids])]) })),

      clearRead: () => set({ read: [] }),
      setSort: (sort) => set({ sort }),
      setView: (view) => set({ view }),

      touchVisit: () => {
        const previous = get().lastVisitAt;
        set({ lastVisitAt: new Date().toISOString() });
        return previous;
      },

      prune: (liveIds) =>
        set((state) => {
          const saved = state.saved.filter((id) => liveIds.has(id));
          const read = state.read.filter((id) => liveIds.has(id));
          // Only write when something actually changed — a `set` with identical
          // content still notifies every subscriber and re-renders the feed.
          if (saved.length === state.saved.length && read.length === state.read.length) {
            return state;
          }
          return { saved, read };
        }),
    }),
    {
      name: "atlas-news",
      version: 1,
      // `isSaved` and the actions are derived, not data.
      partialize: (state) => ({
        saved: state.saved,
        read: state.read,
        lastVisitAt: state.lastVisitAt,
        sort: state.sort,
        view: state.view,
      }),
      // A malformed or older payload degrades to defaults rather than throwing
      // during hydration, which would take the whole page down over a stale
      // localStorage entry.
      migrate: (persisted, version) => {
        const fallback = {
          saved: [] as string[],
          read: [] as string[],
          lastVisitAt: null as string | null,
          sort: "top" as NewsSort,
          view: "magazine" as NewsView,
        };
        if (version === 0 || !persisted || typeof persisted !== "object") return fallback;

        const state = persisted as Partial<NewsState>;
        return {
          saved: Array.isArray(state.saved) ? state.saved : fallback.saved,
          read: Array.isArray(state.read) ? state.read : fallback.read,
          lastVisitAt: typeof state.lastVisitAt === "string" ? state.lastVisitAt : null,
          sort: state.sort ?? fallback.sort,
          view: state.view ?? fallback.view,
        };
      },
    },
  ),
);
