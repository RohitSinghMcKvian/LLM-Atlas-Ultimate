"use client";

import * as React from "react";
import { defaultChatModel } from "@/lib/catalog/defaults";
import { resolveModelId } from "@/lib/catalog/resolve";
import { useCatalogSnapshotLive } from "@/lib/hooks/use-catalog-snapshot";
import { useUIStore } from "@/lib/store/ui-store";

// Repairs the globally-selected model when the daily sync retires it.
//
// `atlas-ui` persists `activeModelId` to localStorage and nothing validated it,
// so a retired id left the topbar switcher reading "Select model" permanently,
// with no path back. This generalizes the one self-healing default the app
// already had, in `components/code/agent-panel.tsx`.
//
// Mounted from the workspace layout, not from `<CatalogScope>`, because the
// switcher it repairs is in the topbar on *every* workspace route — including
// `/docs`, `/datasets` and `/notebooks`, which render no catalog page and so have
// no scope to hang it off. It uses the `Live` hook for the same reason: on those
// routes there is no server-supplied snapshot to heal against.
//
// Renders nothing, and is loaded via `next/dynamic({ ssr: false })` so the
// catalog stays out of the always-parsed layout chunk — the same split
// `components/shell/model-switcher.tsx` documents.

export function CatalogHeal() {
  const snapshot = useCatalogSnapshotLive();

  React.useEffect(() => {
    if (snapshot.models.length === 0) return;

    const heal = () => {
      // Read through `getState` rather than subscribing: this must act on the
      // rehydrated value once, not fight the user on every later change.
      const { activeModelId, setActiveModel } = useUIStore.getState();
      const live = resolveModelId(activeModelId);
      if (live === activeModelId) return;

      // `resolveModelId` also remaps a renamed id, so someone who had a model
      // selected keeps the closest equivalent instead of being reset.
      const next = live ?? defaultChatModel();
      if (next && next !== activeModelId) setActiveModel(next);
    };

    // Zustand rehydrates `atlas-ui` asynchronously. Healing before that lands
    // would write a default and then be overwritten by the stale persisted id.
    const persist = (
      useUIStore as unknown as {
        persist?: {
          hasHydrated?: () => boolean;
          onFinishHydration?: (fn: () => void) => () => void;
        };
      }
    ).persist;

    if (!persist?.hasHydrated || persist.hasHydrated()) {
      heal();
      return;
    }
    return persist.onFinishHydration?.(heal);
  }, [snapshot]);

  return null;
}
