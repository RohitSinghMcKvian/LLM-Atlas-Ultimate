"use client";

import * as React from "react";
import { getModelById } from "@/lib/catalog";
import { resolveModelIds } from "@/lib/catalog/resolve";
import { firstPickable, type PickerCapabilities } from "@/lib/catalog/picker";
import { useCatalogSnapshot } from "./use-catalog-snapshot";
import { useRouteEnv } from "./use-route-env";

// Keep a persisted model selection valid across a catalog resync.
//
// Every surface in Atlas stores model ids — Playground's config, Bench's run
// set, Cost's comparison, Compare's lanes, Flow's agent nodes, Code's agent —
// and the catalog underneath them regenerates daily. A model the providers
// retire is deprecated on one sync and deleted on the next, which is exactly
// what the user asked for; what it must not do is leave a surface holding a
// dead id and failing at the provider with a message about a model nobody
// chose.
//
// `<CatalogHeal />` already did this for the single global `activeModelId`.
// Playground and Bench each open-coded a partial version with `resolveModelIds`.
// Flow, Cost and Compare had nothing. This is that logic, once, for any list.
//
// Two deliberate choices:
//
//   * **Remap before dropping.** `resolveModelIds` follows the sync's alias
//     table, so a model that was renamed or superseded keeps its successor
//     rather than vanishing. Only a genuinely gone model with no successor is
//     dropped.
//   * **Say so.** A silent substitution is worse than a dead id: the user
//     compares two models, one is quietly swapped, and the numbers they are
//     reading are no longer the numbers they asked for. The hook returns what
//     changed so the surface can print one line.

export interface HealNotice {
  /** Ids that were dropped outright — retired with no successor. */
  dropped: string[];
  /** Ids that were remapped, `from` → `to` (display name). */
  replaced: { from: string; to: string }[];
}

function noticeIsEmpty(n: HealNotice): boolean {
  return n.dropped.length === 0 && n.replaced.length === 0;
}

/** Human-readable one-liner, or undefined when nothing changed. */
export function healSentence(notice: HealNotice | null): string | undefined {
  if (!notice || noticeIsEmpty(notice)) return undefined;

  const parts: string[] = [];
  for (const { from, to } of notice.replaced) {
    parts.push(`${from} was retired by its provider — switched to ${to}`);
  }
  if (notice.dropped.length === 1) {
    parts.push(`${notice.dropped[0]} was retired by its provider and removed`);
  } else if (notice.dropped.length > 1) {
    parts.push(`${notice.dropped.length} models were retired by their providers and removed`);
  }
  return `${parts.join(". ")}.`;
}

export interface UseHealedModelsOptions {
  /** Capability floor the surface needs, for choosing a replacement. */
  require?: PickerCapabilities;
  /**
   * What to fall back to when healing empties the list.
   *
   * An empty picker is a dead end, so a surface that cannot function with zero
   * models supplies its default here. Surfaces that can (Cost starts empty)
   * leave it out.
   */
  fallback?: () => string[];
}

/**
 * Heal `ids` against the live catalog, calling `onHeal` when they change.
 *
 * Returns the notice for the most recent heal, or `null`. Call `dismiss` when
 * the user has seen it.
 */
export function useHealedModels(
  ids: readonly string[],
  onHeal: (next: string[]) => void,
  { require, fallback }: UseHealedModelsOptions = {},
): { notice: HealNotice | null; dismiss: () => void } {
  const snapshot = useCatalogSnapshot();
  const env = useRouteEnv();
  const [notice, setNotice] = React.useState<HealNotice | null>(null);

  // Read through refs so this reacts to the *catalog* changing, not to the
  // surface re-rendering. Re-running on every `ids` identity change would fight
  // the user as they edit their own selection.
  const idsRef = React.useRef(ids);
  idsRef.current = ids;
  const onHealRef = React.useRef(onHeal);
  onHealRef.current = onHeal;
  const fallbackRef = React.useRef(fallback);
  fallbackRef.current = fallback;

  React.useEffect(() => {
    // Nothing installed yet, or providers not known: healing against either
    // would be healing against a guess.
    if (snapshot.models.length === 0 || !env) return;

    const current = idsRef.current;
    if (current.length === 0) return;

    const next: string[] = [];
    const healed: HealNotice = { dropped: [], replaced: [] };

    for (const id of current) {
      // `resolveModelIds` on a single id: follows the alias table, so a renamed
      // or superseded model keeps its successor.
      const [live] = resolveModelIds([id]);
      if (live === id) {
        next.push(id);
        continue;
      }
      if (live) {
        next.push(live);
        healed.replaced.push({ from: id, to: getModelById(live)?.name ?? live });
        continue;
      }
      healed.dropped.push(id);
    }

    if (next.length === 0 && fallbackRef.current) {
      const replacement = fallbackRef.current();
      // Only take a replacement this environment can actually serve.
      for (const id of replacement) {
        if (firstPickable(env, [id], require)) next.push(id);
      }
    }

    if (noticeIsEmpty(healed)) return;
    onHealRef.current(next);
    setNotice(healed);
    // `require` is a fresh object literal at most call sites, so depend on its
    // contents rather than its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, env, require?.tools, require?.vision, require?.reasoning]);

  const dismiss = React.useCallback(() => setNotice(null), []);
  return { notice, dismiss };
}
