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

/** Fetches which inference providers are configured (keys live server-side). */
export function useProviders(): ProvidersInfo {
  const [info, setInfo] = React.useState<ProvidersInfo>({
    any: false,
    freeReady: false,
    servePaid: false,
    configured: [],
    providers: [],
    loading: true,
  });

  React.useEffect(() => {
    let active = true;
    fetch("/api/v1/providers")
      .then((r) => r.json())
      .then((d) => {
        if (active) setInfo({ ...d, loading: false });
      })
      .catch(() => {
        if (active) setInfo((s) => ({ ...s, loading: false }));
      });
    return () => {
      active = false;
    };
  }, []);

  return info;
}
