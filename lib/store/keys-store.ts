"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * BYOK key store. The user's OpenRouter key lives ONLY in their browser
 * (localStorage) and is sent per-request as the `x-openrouter-key` header to
 * Atlas's own API routes, which forward it to OpenRouter and discard it. It is
 * never stored or logged server-side.
 */
interface KeysState {
  openrouterKey: string;
  /** Global "paste your key" modal, openable from anywhere (e.g. a key_required error). */
  keyModalOpen: boolean;
  setOpenrouterKey: (k: string) => void;
  clearOpenrouterKey: () => void;
  setKeyModalOpen: (v: boolean) => void;
}

export const useKeysStore = create<KeysState>()(
  persist(
    (set) => ({
      openrouterKey: "",
      keyModalOpen: false,
      setOpenrouterKey: (k) => set({ openrouterKey: k.trim() }),
      clearOpenrouterKey: () => set({ openrouterKey: "" }),
      setKeyModalOpen: (v) => set({ keyModalOpen: v }),
    }),
    {
      name: "atlas-keys",
      partialize: (s) => ({ openrouterKey: s.openrouterKey }),
    },
  ),
);

/** Read the key outside React (e.g. inside an async send loop). */
export function getOpenrouterKey(): string {
  return useKeysStore.getState().openrouterKey;
}

export function hasOpenrouterKey(): boolean {
  return getOpenrouterKey().length > 0;
}

/** Mask a key for display, e.g. `sk-or-…a1b2`. */
export function maskKey(k: string): string {
  if (!k) return "";
  const last4 = k.slice(-4);
  return `${k.slice(0, 6)}…${last4}`;
}
