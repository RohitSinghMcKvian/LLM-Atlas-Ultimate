"use client";

import * as React from "react";
import { compareRuntime, type CompareView } from "@/lib/compare/runtime";
import type { CompareRun } from "@/lib/compare/types";

/**
 * Read the live session from the runtime singleton.
 *
 * `useSyncExternalStore` rather than `useState` plus an effect, because the
 * session outlives this component: the runtime keeps streaming whether or not
 * anything is subscribed, and a component mounting halfway through a turn has to
 * see the current state on its first render rather than after an effect fires.
 *
 * Unsubscribing on unmount does exactly that and nothing more — it does not stop
 * the run. That is the entire point of the arrangement.
 */
export function useCompareView(): CompareView | null {
  return React.useSyncExternalStore(
    compareRuntime.subscribe,
    compareRuntime.getSnapshot,
    compareRuntime.getServerSnapshot,
  );
}

/** The turn being driven right now, or null when no session is open. */
export function useCompareRun(): CompareRun | null {
  return useCompareView()?.current ?? null;
}

/**
 * Whether this tab is the one making requests.
 *
 * A second tab on the same session renders it live but must not drive it, or the
 * user is billed twice for one comparison. The UI uses this to explain why its
 * controls are inert rather than leaving them looking broken.
 */
export function useCompareDriving(): boolean {
  return React.useSyncExternalStore(
    compareRuntime.subscribe,
    () => compareRuntime.getStatus().driving,
    () => false,
  );
}
