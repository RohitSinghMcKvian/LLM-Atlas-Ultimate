"use client";

import { useMemo } from "react";
import { useKeysStore } from "@/lib/store/keys-store";
import { userKeyHeaders } from "@/lib/router/user-keys";

/**
 * Returns the per-request headers carrying the user's BYOK provider keys, to
 * spread into `postSSE(url, body, signal, headers)`. Empty object when no key is
 * set (free models on operator-funded providers don't need one).
 *
 * One `x-atlas-key-<provider>` header per connected provider — the encoding is
 * defined once in `lib/router/user-keys.ts` and read back there by every route
 * handler, so the two halves cannot drift.
 */
export function useUserKeyHeaders(): Record<string, string> {
  const providerKeys = useKeysStore((s) => s.providerKeys);
  // `providerKeys` keeps its identity until a key is actually written, so this
  // is both stable across unrelated re-renders and correct when a key's *value*
  // changes without the connected set changing.
  return useMemo(() => userKeyHeaders(providerKeys), [providerKeys]);
}
