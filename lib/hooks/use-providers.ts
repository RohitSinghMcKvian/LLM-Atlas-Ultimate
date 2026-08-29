"use client";

import * as React from "react";
import type { ProviderId } from "@/lib/catalog/types";

interface ProvidersInfo {
  any: boolean;
  /** Free open models can run (an operator provider is connected). */
  freeReady: boolean;
  /** Operator key also serves closed/paid models (no user key required). */
  servePaid: boolean;
  configured: ProviderId[];
  /** `ATLAS_FREE_OPEN_CEILING_PER_M` — needed to match the server's cost verdict. */
  freeCeilingPerM: number;
  providers: { id: ProviderId; name: string; configured: boolean }[];
  loading: boolean;
}

const IDLE: ProvidersInfo = {
  any: false,
  freeReady: false,
  servePaid: false,
  configured: [],
  freeCeilingPerM: 0,
  providers: [],
  loading: true,
};

// `/api/v1/providers` reports which operator keys are present in the server's
// environment — it cannot change while the document is alive. Four components
// mount this hook (the always-present topbar ModelSwitcher, ChatClient, the
// code AgentPanel, and ProviderBanner), and each was firing its own request.
//
// One module-level cache serves them all: a single in-flight promise, a
// resolved snapshot, and a subscriber set so concurrent mounters are notified.
let cached: ProvidersInfo | null = null;
let inflight: Promise<void> | null = null;
const subscribers = new Set<(info: ProvidersInfo) => void>();

function fetchProviders(): void {
  if (inflight) return;
  inflight = fetch("/api/v1/providers")
    .then((r) => r.json())
    .then((d) => {
      cached = { ...d, loading: false };
    })
    .catch(() => {
      // Same degradation as before: stop loading, report nothing configured.
      // Deliberately not cached, so a later mount can retry after a transient
      // network failure. On a *revalidate* this also means the previous good
      // snapshot survives — a failed refresh must never flash "no provider
      // connected" over a working setup.
    })
    .finally(() => {
      inflight = null;
      const next = cached ?? { ...IDLE, loading: false };
      for (const notify of subscribers) notify(next);
    });
}

function load(): void {
  if (cached || inflight) return;
  fetchProviders();
}

/**
 * Ask again, keeping the current answer until a better one arrives.
 *
 * The snapshot above is immortal: it is written once and never invalidated, on
 * the reasoning that the server's environment cannot change while the document
 * is alive. That is true of the *server* and false of the *user*, whose whole
 * reason for being here is often that they just added a key and restarted the
 * dev server. The tab kept serving the old `configured: []` until a hard
 * reload, so the app still said "connect a key" after they had — which reads as
 * the key not working.
 *
 * Refetching on focus covers exactly that: they leave the tab to edit
 * `.env.local`, come back, and the answer is current.
 */
function revalidate(): void {
  fetchProviders();
}

/** Fetches which inference providers are configured (keys live server-side). */
export function useProviders(): ProvidersInfo {
  // Always starts at `loading: true`, even on a warm cache, so the first render
  // is identical to the pre-cache behaviour and the "connect a provider"
  // banners (gated on `!loading && !any`) can never flash.
  const [info, setInfo] = React.useState<ProvidersInfo>(IDLE);

  React.useEffect(() => {
    let active = true;
    const apply = (next: ProvidersInfo) => {
      if (active) setInfo(next);
    };

    // Subscribe unconditionally, warm cache or not. Previously a mount that
    // found a cached snapshot returned early without subscribing, so it could
    // never be told about a later refresh — which would have made `revalidate`
    // update every tab except the ones that already had data.
    subscribers.add(apply);
    if (cached) apply(cached);
    else load();

    const onFocus = () => revalidate();
    window.addEventListener("focus", onFocus);

    return () => {
      active = false;
      subscribers.delete(apply);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return info;
}
