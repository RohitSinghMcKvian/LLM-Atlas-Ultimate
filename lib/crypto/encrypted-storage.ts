"use client";

import type { PersistStorage, StorageValue } from "zustand/middleware";
import { getMasterKey, isSealed, openWith, sealWith } from "./secret-box";

/**
 * A zustand `persist` adapter that keeps only ciphertext in localStorage.
 *
 * Three behaviours matter here:
 *
 *  - **Migration.** A value written before encryption existed is plain JSON.
 *    We read it, hand it to the store, and immediately re-write it sealed, so
 *    the cleartext is overwritten on the first load after upgrading.
 *  - **Fail closed.** If sealing is impossible (no secure context, IndexedDB
 *    blocked), we delete the stored value rather than fall back to plaintext.
 *    Losing persistence is recoverable; leaking a key is not.
 *  - **Corruption is not an error.** An unreadable blob yields null, the store
 *    starts empty, and the user re-enters their key. Surfacing a decrypt failure
 *    would give them nothing to act on.
 *
 * zustand supports async storage natively and defers `hasHydrated` until the
 * promise settles, so subscribers re-render once the real value lands.
 */
export function encryptedLocalStorage<S>(opts?: {
  /** Test seam. Defaults to the browser's master key. */
  getKey?: () => Promise<CryptoKey>;
  /** Test seam. Defaults to window.localStorage. */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}): PersistStorage<S> {
  const keyOf = opts?.getKey ?? getMasterKey;
  const store = () =>
    opts?.storage ?? (typeof localStorage === "undefined" ? null : localStorage);

  return {
    async getItem(name) {
      const s = store();
      if (!s) return null;
      const raw = s.getItem(name);
      if (!raw) return null;

      if (!isSealed(raw)) {
        // Legacy cleartext. Parse it first so a malformed blob can't cost the
        // user their key, then re-seal in place.
        let parsed: StorageValue<S>;
        try {
          parsed = JSON.parse(raw) as StorageValue<S>;
        } catch {
          s.removeItem(name);
          return null;
        }
        try {
          s.setItem(name, await sealWith(await keyOf(), raw));
        } catch {
          // Can't encrypt — don't leave the plaintext sitting there.
          s.removeItem(name);
        }
        return parsed;
      }

      let plain: string | null;
      try {
        plain = await openWith(await keyOf(), raw);
      } catch {
        plain = null;
      }
      if (plain === null) {
        s.removeItem(name);
        return null;
      }
      try {
        return JSON.parse(plain) as StorageValue<S>;
      } catch {
        s.removeItem(name);
        return null;
      }
    },

    async setItem(name, value) {
      const s = store();
      if (!s) return;
      try {
        s.setItem(name, await sealWith(await keyOf(), JSON.stringify(value)));
      } catch {
        s.removeItem(name);
      }
    },

    async removeItem(name) {
      store()?.removeItem(name);
    },
  };
}
