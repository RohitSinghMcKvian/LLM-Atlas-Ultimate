"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIState {
  sidebarCollapsed: boolean;
  activeModelId: string;
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
      activeModelId: "gpt-oss-120b",
      commandOpen: false,
      mobileNavOpen: false,
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      setActiveModel: (id) => set({ activeModelId: id }),
      setCommandOpen: (v) => set({ commandOpen: v }),
      toggleCommand: () => set((s) => ({ commandOpen: !s.commandOpen })),
      setMobileNavOpen: (v) => set({ mobileNavOpen: v }),
    }),
    {
      name: "atlas-ui",
      partialize: (s) => ({
        sidebarCollapsed: s.sidebarCollapsed,
        activeModelId: s.activeModelId,
      }),
    },
  ),
);
