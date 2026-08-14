"use client";

import * as React from "react";
import type { RouteEnv } from "@/lib/catalog/availability";
import { useProviders } from "./use-providers";
import { useKeysStore } from "@/lib/store/keys-store";

// The client half of the availability contract.
//
// `modelAvailability()` needs to know which operator providers are configured,
// whether the user has their own OpenRouter key, and the operator's free-price
// ceiling. The server reads all of that from `process.env`; the browser gets it
// from `/api/v1/providers` plus the local keys store. Both then call the *same*
// function, which is what stops the picker promising "Free" for something the
// server will answer 402 on.
//
// Returns `null` until the provider list has loaded. Callers must treat that as
// "not known yet" and fall back to `intrinsicAccess` for labelling rather than
// guessing — claiming a model is free before we know which keys exist is the
// exact mistake this whole design removes.

/**
 * The routing environment as the browser sees it, or `null` while loading.
 *
 * The returned object is referentially stable for a given set of inputs, so it is
 * safe as a `useMemo`/`useEffect` dependency.
 */
export function useRouteEnv(): RouteEnv | null {
  const providers = useProviders();
  const hasUserKey = useKeysStore((s) => s.keyPresent);

  // `configured` is a fresh array on every provider fetch, so memoize on its
  // contents rather than its identity.
  const configuredKey = providers.configured.join(",");

  return React.useMemo(() => {
    if (providers.loading) return null;
    return {
      configured: configuredKey ? (configuredKey.split(",") as RouteEnv["configured"]) : [],
      userOpenRouterKey: hasUserKey,
      servePaid: providers.servePaid,
      freeCeilingPerM: providers.freeCeilingPerM,
    };
  }, [
    providers.loading,
    configuredKey,
    hasUserKey,
    providers.servePaid,
    providers.freeCeilingPerM,
  ]);
}
