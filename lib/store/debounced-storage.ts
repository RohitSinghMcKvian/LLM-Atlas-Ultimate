"use client";

import { createJSONStorage, type PersistStorage } from "zustand/middleware";

/**
 * localStorage for zustand's `persist`, with writes debounced.
 *
 * `persist` serializes and writes on *every* `set()`. For a store whose
 * partialized slice is edited character by character — the playground config
 * holds the system prompt, every turn's body, params and tool JSON — that is a
 * full `JSON.stringify` plus a synchronous `localStorage.setItem` on each
 * keystroke, on the main thread, in the typing path.
 *
 * Reads stay synchronous so rehydration is completely unchanged; only the write
 * is coalesced. A pending write is flushed on `pagehide` and on tab-hide, which
 * covers navigation, tab close and mobile app-switch — the paths where losing
 * the last few hundred milliseconds of typing would actually be noticed.
 *
 * Deliberately not used for the key/vault stores: those persist secrets on an
 * explicit user action, where writing immediately is the correct semantic.
 */
export function debouncedLocalStorage<T>(delayMs = 300): PersistStorage<T> | undefined {
  const base = createJSONStorage<T>(() => localStorage);
  if (!base) return undefined;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let queued: { name: string; value: unknown } | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!queued) return;
    const { name, value } = queued;
    queued = null;
    base.setItem(name, value as never);
  };

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }

  return {
    getItem: (name) => base.getItem(name),
    setItem: (name, value) => {
      queued = { name, value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    removeItem: (name) => {
      // Drop any pending write so it can't resurrect what was just removed.
      if (timer) clearTimeout(timer);
      timer = null;
      queued = null;
      return base.removeItem(name);
    },
  };
}
