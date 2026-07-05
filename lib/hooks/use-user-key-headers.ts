"use client";

import { useKeysStore } from "@/lib/store/keys-store";

/**
 * Returns the per-request headers carrying the user's BYOK OpenRouter key,
 * to spread into `postSSE(url, body, signal, headers)`. Empty object when no
 * key is set (free models don't need one).
 */
export function useUserKeyHeaders(): Record<string, string> {
  const key = useKeysStore((s) => s.openrouterKey);
  return key ? { "x-openrouter-key": key } : {};
}
