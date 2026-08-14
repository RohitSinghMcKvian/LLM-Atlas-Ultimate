"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { debouncedLocalStorage } from "./debounced-storage";
import {
  CHAT_ARTIFACT,
  CHAT_HISTORY,
  CODE_AGENT,
  CODE_EXPLORER,
  CODE_TERMINAL,
  SHEET_DEFAULT,
  sanitize,
  type PanelState,
} from "@/lib/panels";
import { isRailTab, type RailTab } from "@/lib/chat/rail-state";

/**
 * Persisted frame sizes for Atlas Chat and Atlas Code.
 *
 * Deliberately separate from `ui-store` rather than a few more fields on it:
 * every `set()` there re-runs the selectors of the sidebar, topbar, model
 * switcher and command palette, all of which are mounted on *every* route.
 * Panel sizes are read by exactly two surfaces, so they get their own store and
 * their own version line.
 *
 * Invariant to preserve when editing: **nothing under `components/shell/` may
 * import this store**, or the split above stops meaning anything.
 *
 * Writes land on `pointerup`, not per-frame — the live drag goes straight to a
 * CSS custom property on the surface root (see `use-panel-resize`), so React
 * never re-renders `ChatClient`/`CodeClient` mid-gesture. The debounced storage
 * is belt-and-braces for the keyboard path, which can fire a set per keydown.
 */

export type PanelKey =
  | "chatHistory"
  | "chatArtifact"
  | "codeExplorer"
  | "codeTerminal"
  | "codeAgent";

/** Exactly what reaches localStorage; `storage` and `partialize` must agree. */
interface PersistedLayout {
  panels: Record<PanelKey, PanelState>;
  /** Mobile artifact sheet height, as a fraction of `dvh`. */
  chatSheetFraction: number;
  /**
   * Which tab of the chat rail is showing.
   *
   * Persisted, because it is a preference — someone who watches the run rather
   * than the preview should not have to re-choose it on every reload. The
   * auto-focus in `chat-client.tsx` overrides it per turn unless the user has
   * pinned a tab by picking one during that turn.
   *
   * Defaults to `"run"`, which is always valid. It used to default to
   * `"preview"`, which is the one tab that can be empty — a build producing only
   * data files, or a fresh conversation, got a rail with a disabled tab and no
   * body at all. `effectiveTab` in `lib/chat/rail-state.ts` now guards the read
   * as well, so a value stored by an older build cannot reproduce that.
   */
  chatRailTab: RailTab;
}

interface LayoutState extends PersistedLayout {
  setPanel: (key: PanelKey, next: PanelState) => void;
  togglePanel: (key: PanelKey) => void;
  resetPanel: (key: PanelKey) => void;
  setChatSheetFraction: (v: number) => void;
  setChatRailTab: (tab: PersistedLayout["chatRailTab"]) => void;
  resetChat: () => void;
  resetCode: () => void;
}

const CONSTRAINTS = {
  chatHistory: CHAT_HISTORY,
  chatArtifact: CHAT_ARTIFACT,
  codeExplorer: CODE_EXPLORER,
  codeTerminal: CODE_TERMINAL,
  codeAgent: CODE_AGENT,
} as const;

function defaults(): Record<PanelKey, PanelState> {
  return {
    chatHistory: { size: CHAT_HISTORY.defaultSize, collapsed: false },
    chatArtifact: { size: CHAT_ARTIFACT.defaultSize, collapsed: false },
    codeExplorer: { size: CODE_EXPLORER.defaultSize, collapsed: false },
    codeTerminal: { size: CODE_TERMINAL.defaultSize, collapsed: false },
    codeAgent: { size: CODE_AGENT.defaultSize, collapsed: false },
  };
}

function defaultsFor(keys: PanelKey[], from: Record<PanelKey, PanelState>) {
  const base = defaults();
  const next = { ...from };
  for (const k of keys) next[k] = base[k];
  return next;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      panels: defaults(),
      chatSheetFraction: SHEET_DEFAULT,
      chatRailTab: "run",

      setChatRailTab: (tab) => set({ chatRailTab: tab }),
      setPanel: (key, next) =>
        set((s) => ({ panels: { ...s.panels, [key]: next } })),
      togglePanel: (key) =>
        set((s) => ({
          panels: {
            ...s.panels,
            [key]: { ...s.panels[key], collapsed: !s.panels[key].collapsed },
          },
        })),
      resetPanel: (key) =>
        set((s) => ({ panels: { ...s.panels, [key]: defaults()[key] } })),
      setChatSheetFraction: (v) => set({ chatSheetFraction: v }),
      resetChat: () =>
        set((s) => ({
          panels: defaultsFor(["chatHistory", "chatArtifact"], s.panels),
          chatSheetFraction: SHEET_DEFAULT,
        })),
      resetCode: () =>
        set((s) => ({
          panels: defaultsFor(["codeExplorer", "codeTerminal", "codeAgent"], s.panels),
        })),
    }),
    {
      name: "atlas-layout",
      version: 2,
      storage: debouncedLocalStorage<PersistedLayout>(300),
      /**
       * v1 → v2: `chatRailTab` defaulted to `"preview"`, the one tab that can
       * be empty. A stored `"preview"` is therefore indistinguishable from a
       * deliberate choice, and far more likely to be the default nobody
       * touched — so it is rewritten **once**, here, rather than on every read.
       * A user who picks Preview after this keeps it.
       */
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Partial<PersistedLayout>;
        if (version < 2 && s.chatRailTab === "preview") s.chatRailTab = "run";
        return s as PersistedLayout;
      },
      // Constraints get retuned between deploys, so a size that was valid when
      // it was written can be out of range by the time it is read back. Merging
      // through `sanitize` is what stops that from shipping a broken layout —
      // and it also absorbs a partially-written or hand-edited storage entry.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<LayoutState>;
        const panels = defaults();
        for (const key of Object.keys(panels) as PanelKey[]) {
          panels[key] = sanitize(p.panels?.[key], CONSTRAINTS[key]);
        }
        const fraction = p.chatSheetFraction;
        const tab = p.chatRailTab;
        return {
          ...current,
          panels,
          chatSheetFraction:
            typeof fraction === "number" && Number.isFinite(fraction)
              ? fraction
              : SHEET_DEFAULT,
          // Same hardening as the panel sizes: a persisted value from an older
          // build may name a tab that no longer exists. The one-time rewrite of
          // the old `"preview"` default lives in `migrate`, not here — doing it
          // on every read would mean a deliberate choice never stuck.
          chatRailTab: isRailTab(tab) ? tab : "run",
        };
      },
      partialize: (s) => ({
        panels: s.panels,
        chatSheetFraction: s.chatSheetFraction,
        chatRailTab: s.chatRailTab,
      }),
    },
  ),
);

export { CONSTRAINTS as PANEL_CONSTRAINTS };
