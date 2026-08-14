"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { expireNegatives, NEGATIVE_TTL_MS } from "@/lib/chat/tool-support";

/**
 * Which models have actually refused `tools`.
 *
 * Only negatives are stored, and only ones that were observed. A model is
 * offered tools until a provider says otherwise, so the absence of an entry is
 * the normal, working state — there is nothing to warm up and nothing to sync.
 *
 * Persisted because the alternative is paying for the same rejected round trip
 * on the first turn of every session. Expired on read rather than on a timer:
 * nothing needs to happen while the tab is closed, and a sweep on hydrate is one
 * pass over a handful of keys.
 *
 * The policy — what counts as a rejection, how long it is trusted — lives in
 * `lib/chat/tool-support.ts`, which is pure and tested. This holds the bytes.
 */
interface ToolSupportState {
  /** Atlas model id → when the rejection was observed, in ms. */
  negatives: Record<string, number>;
  /** Record a route's refusal. Idempotent; refreshes the timestamp. */
  recordToolsUnsupported: (modelId: string) => void;
  /**
   * Forget a model's rejection.
   *
   * Not exposed in the UI yet, but the escape hatch has to exist: a provider
   * that adds tool support mid-TTL would otherwise leave the user with a model
   * that is quietly degraded and no way to say "try again".
   */
  clearToolsUnsupported: (modelId: string) => void;
}

export const useToolSupportStore = create<ToolSupportState>()(
  persist(
    (set) => ({
      negatives: {},
      recordToolsUnsupported: (modelId) =>
        set((s) => ({ negatives: { ...s.negatives, [modelId]: Date.now() } })),
      clearToolsUnsupported: (modelId) =>
        set((s) => {
          const { [modelId]: _drop, ...rest } = s.negatives;
          return { negatives: rest };
        }),
    }),
    {
      name: "atlas-tool-support",
      version: 1,
      // Sweeping here rather than on every read keeps `toolSupportFor` a pure
      // function of its arguments, which is what makes it testable.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const live = expireNegatives(state.negatives, Date.now(), NEGATIVE_TTL_MS);
        if (live !== state.negatives) state.negatives = live;
      },
    },
  ),
);
