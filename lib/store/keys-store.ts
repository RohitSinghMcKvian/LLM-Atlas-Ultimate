"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { encryptedLocalStorage } from "@/lib/crypto/encrypted-storage";
import type { ProviderId } from "@/lib/catalog/types";
import type { UserKeys } from "@/lib/router/user-keys";

/**
 * BYOK key store. The user's provider keys live ONLY in their browser and are
 * sent per-request as `x-atlas-key-<provider>` headers to Atlas's own API
 * routes, which forward them upstream and discard them. They are never stored or
 * logged server-side.
 *
 * At rest they are AES-GCM encrypted under a non-extractable key in IndexedDB
 * (§1.3) — see lib/crypto/secret-box.ts. Because that storage adapter is async,
 * `providerKeys` is empty until rehydration completes; every consumer subscribes
 * through the hook and re-renders when it lands. Use `keysPresent` if you need
 * to distinguish "no key" from "not loaded yet".
 *
 * This used to hold a single `openrouterKey`, which is the reason OpenRouter was
 * the only provider a user could bring their own credential for. It is now a map
 * so that someone's own free-tier Groq or Z.ai key works too.
 */
interface KeysState {
  /** The user's own key per provider. Absent means "not connected". */
  providerKeys: UserKeys;
  /**
   * Which providers have a key, known synchronously and before decryption ends.
   *
   * Decrypting is async, so `providerKeys` is empty for the first frame or two.
   * Most of the UI only asks "does the user have a key?" to pick a label or a
   * badge; without this they would all flash the wrong answer on load. Only the
   * provider ids are persisted in the clear — they reveal nothing about the keys.
   */
  keysPresent: ProviderId[];
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
  /**
   * Which provider the modal is asking for.
   *
   * With thirteen connectable lanes, "add your key" is no longer one question.
   * A 402 on a Claude route and a spent Groq allowance want different keys, and
   * a dialog that always said "OpenRouter" would send people to the wrong
   * console. Defaults to `openrouter` because that is the lane that unlocks the
   * most models at once.
   */
  keyModalProvider: ProviderId;
  setProviderKey: (id: ProviderId, k: string) => void;
  clearProviderKey: (id: ProviderId) => void;
  setSearchKey: (k: string) => void;
  setGithubKey: (k: string) => void;
  setKeyModalOpen: (v: boolean, provider?: ProviderId) => void;
}

/** Cleartext presence marker, kept beside the encrypted blob. */
const PRESENCE_KEY = "atlas-keys-present";

function readPresence(): ProviderId[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(PRESENCE_KEY);
    if (!raw) return [];
    // The pre-map marker was the literal "1", meaning "an OpenRouter key exists".
    if (raw === "1") return ["openrouter"];
    return raw.split(",").filter(Boolean) as ProviderId[];
  } catch {
    return [];
  }
}

function writePresence(present: readonly ProviderId[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (present.length > 0) localStorage.setItem(PRESENCE_KEY, present.join(","));
    else localStorage.removeItem(PRESENCE_KEY);
  } catch {
    /* quota or disabled storage — presence is only a hint */
  }
}

function presentIn(keys: UserKeys): ProviderId[] {
  return (Object.keys(keys) as ProviderId[]).filter((id) => (keys[id] ?? "").length > 0);
}

/** The pre-map persisted shape, for `migrate`. */
interface LegacyKeysState {
  openrouterKey?: string;
  searchKey?: string;
  githubKey?: string;
}

export const useKeysStore = create<KeysState>()(
  persist(
    (set, get) => ({
      providerKeys: {},
      searchKey: "",
      githubKey: "",
      // Read synchronously at store creation so the very first render is right.
      keysPresent: readPresence(),
      hydrated: false,
      keyModalOpen: false,
      keyModalProvider: "openrouter",
      setProviderKey: (id, k) => {
        const key = k.trim();
        const providerKeys = { ...get().providerKeys };
        if (key) providerKeys[id] = key;
        else delete providerKeys[id];
        const keysPresent = presentIn(providerKeys);
        writePresence(keysPresent);
        set({ providerKeys, keysPresent });
      },
      clearProviderKey: (id) => {
        const providerKeys = { ...get().providerKeys };
        delete providerKeys[id];
        const keysPresent = presentIn(providerKeys);
        writePresence(keysPresent);
        set({ providerKeys, keysPresent });
      },
      setSearchKey: (k) => set({ searchKey: k.trim() }),
      setGithubKey: (k) => set({ githubKey: k.trim() }),
      setKeyModalOpen: (v, provider) =>
        set(provider ? { keyModalOpen: v, keyModalProvider: provider } : { keyModalOpen: v }),
    }),
    {
      name: "atlas-keys",
      storage: encryptedLocalStorage<KeysState>(),
      version: 2,
      // v0/v1 stored a single `openrouterKey`. Fold it into the map so an
      // existing user does not silently lose the key they already connected.
      migrate: (persisted, version) => {
        if (version >= 2) return persisted as KeysState;
        const old = (persisted ?? {}) as LegacyKeysState;
        const providerKeys: UserKeys = {};
        if (old.openrouterKey) providerKeys.openrouter = old.openrouterKey;
        return {
          providerKeys,
          searchKey: old.searchKey ?? "",
          githubKey: old.githubKey ?? "",
        } as unknown as KeysState;
      },
      partialize: (s) =>
        ({
          providerKeys: s.providerKeys,
          searchKey: s.searchKey,
          githubKey: s.githubKey,
        }) as unknown as KeysState,
      // Runs whether or not a stored value existed, so this is a reliable
      // "storage has been consulted" signal. Reconcile the presence hint here
      // too: if the encrypted blob was dropped as corrupt, the marker is stale.
      onRehydrateStorage: () => (state) => {
        const keysPresent = presentIn(state?.providerKeys ?? {});
        writePresence(keysPresent);
        useKeysStore.setState({ hydrated: true, keysPresent });
      },
    },
  ),
);

/** Does the user have a key for any provider at all? */
export function hasAnyUserKey(s: Pick<KeysState, "keysPresent">): boolean {
  return s.keysPresent.length > 0;
}

/**
 * Read every key outside React (e.g. inside an async send loop).
 *
 * Returns `{}` before rehydration finishes. If you might be called during the
 * first paint, prefer `awaitUserKeys()`.
 */
export function getUserKeys(): UserKeys {
  return useKeysStore.getState().providerKeys;
}

/** Resolve once the encrypted keys have actually been read back from storage. */
export function awaitUserKeys(): Promise<UserKeys> {
  const s = useKeysStore.getState();
  if (s.hydrated) return Promise.resolve(s.providerKeys);
  return new Promise((resolve) => {
    const unsub = useKeysStore.subscribe((next) => {
      if (!next.hydrated) return;
      unsub();
      resolve(next.providerKeys);
    });
  });
}

// OpenRouter-specific conveniences. Thin wrappers over the map rather than
// separate state, so there is nothing to drift. Several call sites still care
// specifically about OpenRouter (the Vault card, the agent and voice runners);
// Phase 4 generalises those surfaces and these can go.

export function getOpenrouterKey(): string {
  return getUserKeys().openrouter ?? "";
}

export function hasOpenrouterKey(): boolean {
  return getOpenrouterKey().length > 0;
}

export function awaitOpenrouterKey(): Promise<string> {
  return awaitUserKeys().then((k) => k.openrouter ?? "");
}

/** Mask a key for display, e.g. `sk-or-…a1b2`. */
export function maskKey(k: string): string {
  if (!k) return "";
  const last4 = k.slice(-4);
  return `${k.slice(0, 6)}…${last4}`;
}
