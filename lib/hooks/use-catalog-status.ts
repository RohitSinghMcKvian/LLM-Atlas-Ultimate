"use client";

import * as React from "react";
import type { CatalogDiffEntry, CatalogStats } from "@/lib/catalog/snapshot";
import type { ProviderId } from "@/lib/catalog/types";

// The sync's own status, for the pill and the updates drawer.
//
// Module-level cache in the same shape as `use-providers.ts`: one in-flight
// request no matter how many components mount, and a failure is not cached so a
// later mount retries.

export interface CatalogSourceStatus {
  status: "ok" | "failed" | "skipped";
  count: number;
  ms?: number;
}

export interface RetiredModel {
  id: string;
  name: string;
  reason: "delisted" | "expired" | "replaced" | "non_chat";
  replacedBy?: string;
  lastSeenAt: string;
}

export interface CatalogStatus {
  loading: boolean;
  version: string;
  syncedAt: string;
  origin: "baseline" | "synced";
  nextDueAt: string | null;
  intervalHours: number;
  stats: CatalogStats | null;
  warnings: string[];
  diff: CatalogDiffEntry[];
  sources: Partial<Record<ProviderId, CatalogSourceStatus>>;
  retired: RetiredModel[];
}

const EMPTY: CatalogStatus = {
  loading: true,
  version: "",
  syncedAt: "",
  origin: "baseline",
  nextDueAt: null,
  intervalHours: 24,
  stats: null,
  warnings: [],
  diff: [],
  sources: {},
  retired: [],
};

let cached: CatalogStatus | null = null;
let inflight: Promise<CatalogStatus | null> | null = null;
const listeners = new Set<() => void>();

function load(): Promise<CatalogStatus | null> {
  if (inflight) return inflight;
  inflight = fetch("/api/v1/catalog/status", { headers: { Accept: "application/json" } })
    .then(async (res) => {
      if (!res.ok) return null;
      const body = (await res.json()) as Omit<CatalogStatus, "loading">;
      cached = { ...body, loading: false };
      for (const l of listeners) l();
      return cached;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Force the next read to re-fetch — after a manual sync, say. */
export function invalidateCatalogStatus(): void {
  cached = null;
  void load();
}

export function useCatalogStatus(): CatalogStatus {
  const [, bump] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    listeners.add(bump);
    if (!cached) void load();
    return () => {
      listeners.delete(bump);
    };
  }, []);

  return cached ?? EMPTY;
}

/**
 * "4 hours ago", "just now" — the coarse relative time a freshness pill wants.
 *
 * Deliberately not `timeAgo` from `lib/utils`, which formats a date for a list
 * row; this reads as a state ("synced 4h ago") and rounds hard, because nobody
 * needs to know the catalog was refreshed 213 minutes ago.
 */
export function syncedAgo(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "unknown";
  const mins = Math.floor((now - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}
