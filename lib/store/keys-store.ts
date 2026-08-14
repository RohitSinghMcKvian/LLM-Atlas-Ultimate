"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { encryptedLocalStorage } from "@/lib/crypto/encrypted-storage";

/**
 * BYOK key store. The user's OpenRouter key lives ONLY in their browser and is
 * sent per-request as the `x-openrouter-key` header to Atlas's own API routes,
 * which forward it to OpenRouter and discard it. It is never stored or logged
 * server-side.
 *
 * At rest it is AES-GCM encrypted under a non-extractable key in IndexedDB
 * (§1.3) — see lib/crypto/secret-box.ts. Because that storage adapter is async,
 * `openrouterKey` is "" until rehydration completes; every consumer subscribes
 * through the hook and re-renders when it lands. Use `hydrated` if you need to
 * distinguish "no key" from "not loaded yet".
 */
interface KeysState {
  openrouterKey: string;
  /**
   * Whether a key exists, known synchronously and before decryption finishes.
   *
   * Decrypting is async, so `openrouterKey` is "" for the first frame or two.
   * Most of the UI only asks "does the user have a key?" to pick a label or a
   * badge; without this they would all flash the wrong answer on load. Only a
   * boolean is persisted in the clear — it reveals nothing about the key.
   */
  keyPresent: boolean;
  /**
   * API key for a BYO search provider (Brave/Tavily/Exa), §4.6.
   *
   * Encrypted at rest by the same adapter and forwarded per-request as
   * `x-search-key`. Kept in this store rather than a new one precisely because
   * the handling rules are identical — a second store would be a second place to
   * get them wrong.
   */
  searchKey: string;
  /**
   * GitHub personal access token, §4 (GitHub integration).
   *
   * Same handling rules again, and for the same reason they are in this store:
   * held only in this browser, encrypted at rest, forwarded per-request as
   * `x-github-token` to `/api/v1/github`, which uses it once and discards it.
   * Public repositories are readable without it; this exists so private ones are
   * too, and so an authenticated read gets the higher rate limit.
   */
  githubKey: string;
  /** False until the encrypted value has been read back from storage. */
  hydrated: boolean;
  /** Global "paste your key" modal, openable from anywhere (e.g. a key_required error). */
  keyModalOpen: boolean;
  setOpenrouterKey: (k: string) => void;
  clearOpenrouterKey: () => void;
  setSearchKey: (k: string) => void;
  setGithubKey: (k: string) => void;
  setKeyModalOpen: (v: boolean) => void;
}

/** Cleartext presence marker, kept beside the encrypted blob. */
const PRESENCE_KEY = "atlas-keys-present";

function readPresence(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(PRESENCE_KEY) === "1";
  } catch {
    return false;
  }
}

function writePresence(present: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (present) localStorage.setItem(PRESENCE_KEY, "1");
    else localStorage.removeItem(PRESENCE_KEY);
  } catch {
    /* quota or disabled storage — presence is only a hint */
  }
}

export const useKeysStore = create<KeysState>()(
  persist(
    (set) => ({
      openrouterKey: "",
      searchKey: "",
      githubKey: "",
      // Read synchronously at store creation so the very first render is right.
      keyPresent: readPresence(),
      hydrated: false,
      keyModalOpen: false,
      setOpenrouterKey: (k) => {
        const key = k.trim();
        writePresence(key.length > 0);
        set({ openrouterKey: key, keyPresent: key.length > 0 });
      },
      clearOpenrouterKey: () => {
        writePresence(false);
        set({ openrouterKey: "", keyPresent: false });
      },
      setSearchKey: (k) => set({ searchKey: k.trim() }),
      setGithubKey: (k) => set({ githubKey: k.trim() }),
      setKeyModalOpen: (v) => set({ keyModalOpen: v }),
    }),
    {
      name: "atlas-keys",
      storage: encryptedLocalStorage<KeysState>(),
      partialize: (s) =>
        ({
          openrouterKey: s.openrouterKey,
          searchKey: s.searchKey,
          githubKey: s.githubKey,
        }) as unknown as KeysState,
      // Runs whether or not a stored value existed, so this is a reliable
      // "storage has been consulted" signal. Reconcile the presence hint here
      // too: if the encrypted blob was dropped as corrupt, the marker is stale.
      onRehydrateStorage: () => (state) => {
        const present = (state?.openrouterKey ?? "").length > 0;
        writePresence(present);
        useKeysStore.setState({ hydrated: true, keyPresent: present });
      },
    },
  ),
);

/**
 * Read the key outside React (e.g. inside an async send loop).
 *
 * Returns "" before rehydration finishes. If you might be called during the
 * first paint, prefer `awaitOpenrouterKey()`.
 */
export function getOpenrouterKey(): string {
  return useKeysStore.getState().openrouterKey;
}

export function hasOpenrouterKey(): boolean {
  return getOpenrouterKey().length > 0;
}

/** Resolve once the encrypted key has actually been read back from storage. */
export function awaitOpenrouterKey(): Promise<string> {
  const s = useKeysStore.getState();
  if (s.hydrated) return Promise.resolve(s.openrouterKey);
  return new Promise((resolve) => {
    const unsub = useKeysStore.subscribe((next) => {
      if (!next.hydrated) return;
      unsub();
      resolve(next.openrouterKey);
    });
  });
}

/** Mask a key for display, e.g. `sk-or-…a1b2`. */
export function maskKey(k: string): string {
  if (!k) return "";
  const last4 = k.slice(-4);
  return `${k.slice(0, 6)}…${last4}`;
}
