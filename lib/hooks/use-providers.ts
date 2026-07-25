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
  providers: { id: ProviderId; name: string; configured: boolean }[];
  loading: boolean;
}

const IDLE: ProvidersInfo = {
  any: false,
  freeReady: false,
  servePaid: false,
  configured: [],
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

function load(): void {
  if (cached || inflight) return;
  inflight = fetch("/api/v1/providers")
    .then((r) => r.json())
    .then((d) => {
      cached = { ...d, loading: false };
    })
    .catch(() => {
      // Same degradation as before: stop loading, report nothing configured.
      // Deliberately not cached, so a later mount can retry after a transient
      // network failure.
    })
    .finally(() => {
      inflight = null;
      const next = cached ?? { ...IDLE, loading: false };
      for (const notify of subscribers) notify(next);
    });
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

    if (cached) {
      apply(cached);
      return () => {
        active = false;
      };
    }

    subscribers.add(apply);
    load();
    return () => {
      active = false;
      subscribers.delete(apply);
    };
  }, []);

  return info;
}
