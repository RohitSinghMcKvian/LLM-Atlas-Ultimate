"use client";

import * as React from "react";
import {
  activeSnapshot,
  installSnapshot,
  subscribeSnapshot,
  type CatalogSnapshot,
} from "@/lib/catalog/snapshot";

// Two ways to read the catalog from a client component.
//
// `useCatalogSnapshot()` — subscribe to whatever is installed. Use it as a
// `useMemo` dependency so a derived list recomputes when the catalog changes.
// Costs nothing: on a page wrapped in `<CatalogScope>` the snapshot is already
// there before the component's body runs.
//
// `useCatalogSnapshotLive()` — additionally fetch the catalog if nothing has been
// installed. Only for the two `ssr: false` shell widgets, which render on routes
// that have no catalog page behind them (`/docs`, `/datasets`, `/notebooks`).
// Anywhere else this would be a needless request and a content flash.

/**
 * The installed snapshot, re-rendering when it changes.
 *
 * `getServerSnapshot` is the same accessor as the client one, and `CatalogScope`
 * installs during render, so the server and hydration passes agree.
 */
export function useCatalogSnapshot(): CatalogSnapshot {
  return React.useSyncExternalStore(subscribeSnapshot, activeSnapshot, activeSnapshot);
}

// Module-level fetch cache, mirroring `lib/hooks/use-providers.ts`: one in-flight
// request no matter how many components mount, and failures are not cached so a
// later mount retries.
let inflight: Promise<void> | null = null;
let fetched = false;

function loadOnce(): void {
  if (fetched || inflight) return;

  inflight = fetch("/api/v1/catalog", { headers: { Accept: "application/json" } })
    .then(async (res) => {
      if (!res.ok) return;
      const snapshot = (await res.json()) as CatalogSnapshot;
      if (!snapshot?.models?.length) return;
      fetched = true;
      // A transition: swapping ~400 models into a mounted list is not urgent, and
      // must not block whatever the user is typing.
      React.startTransition(() => {
        installSnapshot(snapshot);
      });
    })
    .catch(() => {
      // Leave `fetched` false so a later mount can retry.
    })
    .finally(() => {
      inflight = null;
    });
}

// --- Revalidation ---------------------------------------------------------
//
// The catalog resyncs daily and models genuinely come and go: the whole point of
// the sync is that a model a provider retired stops being offered. But
// `loadOnce` sets `fetched` permanently, so a tab left open on /chat overnight
// kept serving yesterday's catalog — offering models that no longer exist and
// missing the ones that now do — until the next full navigation.
//
// Checking on focus fixes that for a few hundred bytes: `?fields=stats` is
// ETag'd, so the common answer is a 304 and no catalog crosses the wire at all.
// The full snapshot is fetched only when the version has actually moved.

/** How long a snapshot is trusted without asking. Shorter than the sync interval. */
const REVALIDATE_AFTER_MS = 5 * 60_000;

let lastChecked = 0;

async function revalidate(): Promise<void> {
  if (inflight) return;
  if (Date.now() - lastChecked < REVALIDATE_AFTER_MS) return;
  lastChecked = Date.now();

  try {
    const res = await fetch("/api/v1/catalog?fields=stats", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return;
    const head = (await res.json()) as Pick<CatalogSnapshot, "version">;
    if (!head?.version || head.version === activeSnapshot().version) return;

    // The catalog moved under us. Now — and only now — pay for the models.
    fetched = false;
    loadOnce();
  } catch {
    // Offline, or the server is restarting. The installed catalog stays; a later
    // focus tries again.
  }
}

/**
 * Re-check the catalog when the tab comes back to the foreground.
 *
 * Mounted once from `<CatalogHeal />`, which is already in the workspace layout
 * on every route for exactly this class of repair, so no page has to remember.
 */
export function useCatalogRevalidation(): void {
  React.useEffect(() => {
    const check = () => {
      if (document.visibilityState === "visible") void revalidate();
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
}

/** Test-only: forget when we last checked. */
export function resetCatalogRevalidation(): void {
  lastChecked = 0;
  fetched = false;
}

/**
 * The snapshot, fetching it once if the server never supplied one.
 *
 * Safe against hydration mismatch because its only callers render behind
 * `next/dynamic({ ssr: false })` — there is no server HTML to disagree with.
 */
export function useCatalogSnapshotLive(): CatalogSnapshot {
  const snapshot = useCatalogSnapshot();

  React.useEffect(() => {
    // Any installed catalog is enough — a page that supplied one via
    // `<CatalogScope>` must not trigger a redundant request. Only the truly
    // empty pointer (`/docs`, `/datasets`, `/notebooks`) needs a fetch.
    if (snapshot.models.length > 0) return;
    loadOnce();
  }, [snapshot.models.length]);

  return snapshot;
}
