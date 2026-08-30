"use client";

import * as React from "react";
import { modelAvailability } from "@/lib/catalog/availability";
import { defaultChatModel, servableChatModel } from "@/lib/catalog/defaults";
import { getModelById } from "@/lib/catalog";
import { resolveModelId } from "@/lib/catalog/resolve";
import { useCatalogSnapshotLive } from "@/lib/hooks/use-catalog-snapshot";
import { useRouteEnv } from "@/lib/hooks/use-route-env";
import { useUIStore } from "@/lib/store/ui-store";

// Repairs the globally-selected model when it stops being usable — either
// because the daily sync retired it, or because no connected provider can serve
// it.
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
// The second repair — reachability — is the one that made the agent look broken.
// The defaults are chosen by `modelAccess`, which is env-independent by design,
// so an operator whose only key is `GOOGLE_API_KEY` lands on `gpt-oss-120b` and
// every question dies with `No connected provider can serve GPT-OSS 120B`, with
// nine runnable models sitting unselected in the picker. Availability is only
// known once `/api/v1/providers` has answered, which is why this waits on
// `useRouteEnv()` rather than guessing.
//
// Renders nothing, and is loaded via `next/dynamic({ ssr: false })` so the
// catalog stays out of the always-parsed layout chunk — the same split
// `components/shell/model-switcher.tsx` documents.

export function CatalogHeal() {
  const snapshot = useCatalogSnapshotLive();
  const env = useRouteEnv();

  React.useEffect(() => {
    if (snapshot.models.length === 0) return;
    // `null` is "not known yet", not "nothing configured" — healing against a
    // guess would move the user off a model that is in fact reachable.
    if (!env) return;

    const heal = () => {
      // Read through `getState` rather than subscribing: this must act on the
      // rehydrated value once, not fight the user on every later change.
      const { activeModelId, setActiveModel } = useUIStore.getState();
      const live = resolveModelId(activeModelId);

      // `resolveModelId` also remaps a renamed id, so someone who had a model
      // selected keeps the closest equivalent instead of being reset.
      const resolved = live ?? servableChatModel(env) ?? defaultChatModel();

      // Then the reachability pass. `unavailable` only — `needs_key` is a model
      // the user can unlock by connecting their own key, and the banner offering
      // that is a better answer than silently choosing something else for them.
      //
      // `servableChatModel` returns `undefined` when the connected providers can
      // serve nothing at all, and then this deliberately changes nothing: with
      // no keys anywhere, every swap is as dead as the current selection, and
      // churning the switcher would only hide the honest error.
      const model = resolved ? getModelById(resolved) : undefined;
      const next =
        model && modelAvailability(model, env).kind === "unavailable"
          ? (servableChatModel(env) ?? resolved)
          : resolved;

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
  }, [snapshot, env]);

  return null;
}
