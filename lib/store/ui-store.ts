"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIState {
  sidebarCollapsed: boolean;
  activeModelId: string;
  /** Most-recently picked models, newest first. Powers the picker shortlist. */
  recentModelIds: string[];
  commandOpen: boolean;
  mobileNavOpen: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  setActiveModel: (id: string) => void;
  setCommandOpen: (v: boolean) => void;
  toggleCommand: () => void;
  setMobileNavOpen: (v: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      // Empty, not a hardcoded id. Resolving a real default needs the catalog,
      // and importing it here would pull ~90 KB of models into the chunk the
      // always-mounted shell parses on every route. `<CatalogHeal>` fills this
      // in after hydration instead.
      activeModelId: "",
      recentModelIds: [],
      commandOpen: false,
      mobileNavOpen: false,
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      setActiveModel: (id) =>
        set((s) => ({
          activeModelId: id,
          // The pickers are search-first now, so a short recents list is what
          // makes the empty state useful. Capped at 5.
          recentModelIds: id
            ? [id, ...s.recentModelIds.filter((x) => x !== id)].slice(0, 5)
            : s.recentModelIds,
        })),
      setCommandOpen: (v) => set({ commandOpen: v }),
      toggleCommand: () => set((s) => ({ commandOpen: !s.commandOpen })),
      setMobileNavOpen: (v) => set({ mobileNavOpen: v }),
    }),
    {
      name: "atlas-ui",
      // v2: the catalog became a daily-synced snapshot, so a persisted
      // `activeModelId` can name a model that no longer exists. Clearing it lets
      // `<CatalogHeal>` pick a live one; before this, a stale id left the topbar
      // stuck on "Select model" with no way to recover.
      version: 2,
      migrate: (state, version) => {
        const s = (state ?? {}) as Partial<UIState>;
        return (version < 2 ? { ...s, activeModelId: "", recentModelIds: [] } : s) as UIState;
      },
      partialize: (s) => ({
        sidebarCollapsed: s.sidebarCollapsed,
        activeModelId: s.activeModelId,
        recentModelIds: s.recentModelIds,
      }),
    },
  ),
);
