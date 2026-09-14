"use client";

import * as React from "react";
import type { ProviderId } from "@/lib/catalog/types";
import type { LaneUnit } from "@/lib/quota/lanes";
import type { WindowKind } from "@/lib/quota/windows";

// Reads `GET /api/v1/quota` — how much of each OPERATOR-funded free tier is
// left. Same module-level cache shape as `use-providers`: one in-flight
// promise, one snapshot, a subscriber set, and a refetch on focus.
//
// The difference is that this answer genuinely goes stale: providers reset on a
// clock, and every turn the user takes spends some of it. So unlike the
// providers snapshot it is also revalidated on demand — call `refreshQuota()`
// when a stream reports usage, not on every keystroke.
//
// NOTE the import above: `@/lib/quota/lanes` for the types, never the
// `@/lib/quota` barrel, which pulls in the ledger and through it the
// server-only Supabase client.

export interface QuotaWindow {
  window: WindowKind;
  unit: LaneUnit;
  limit: number;
  used: number;
  remaining: number;
  /** Epoch ms. */
  resetsAt: number;
}

export interface QuotaLane {
  id: ProviderId;
  name: string;
  /** `null` when the provider has no free tier at all. */
  kind: "recurring" | "grant" | null;
  /** An expiring balance rather than a resetting allowance. Renders "Credits". */
  credits: boolean;
  /** Empty for a grant — there is no window to count. */
  windows: QuotaWindow[];
}

export interface QuotaInfo {
  lanes: QuotaLane[];
  /** False when nothing is persisted, so counts are per-instance and partial. */
  durable: boolean;
  loading: boolean;
}

const IDLE: QuotaInfo = { lanes: [], durable: false, loading: true };

let cached: QuotaInfo | null = null;
let inflight: Promise<void> | null = null;
const subscribers = new Set<(info: QuotaInfo) => void>();

function fetchQuota(): void {
  if (inflight) return;
  inflight = fetch("/api/v1/quota")
    .then((r) => r.json())
    .then((d) => {
      cached = { lanes: d.lanes ?? [], durable: Boolean(d.durable), loading: false };
    })
    .catch(() => {
      // Keep the last good answer. A failed refresh must never flash an empty
      // meter over a working one — the same rule `use-providers` follows.
    })
    .finally(() => {
      inflight = null;
      const next = cached ?? { ...IDLE, loading: false };
      for (const notify of subscribers) notify(next);
    });
}

/** Ask again, keeping the current answer until a better one arrives. */
export function refreshQuota(): void {
  fetchQuota();
}

/**
 * The tightest window on a lane — the one that will actually stop a request.
 *
 * A lane with both a per-minute and a per-day ceiling is limited by whichever
 * is nearest, and showing the roomier one would promise headroom that is not
 * there. Ties break toward the shorter window, since that is the one that
 * recovers first.
 */
export function bindingWindow(lane: QuotaLane): QuotaWindow | undefined {
  if (lane.windows.length === 0) return undefined;
  const rank: Record<WindowKind, number> = { minute: 0, day: 1, month: 2 };
  return [...lane.windows].sort((a, b) => {
    const fa = a.limit > 0 ? a.remaining / a.limit : 0;
    const fb = b.limit > 0 ? b.remaining / b.limit : 0;
    return fa - fb || rank[a.window] - rank[b.window];
  })[0];
}

/** Where a lane stands, for a caller that only wants to badge it. */
export interface LaneHeadroom {
  remaining: number;
  limit: number;
  window: WindowKind;
  /** Under 20% left — worth surfacing on a row that normally says nothing. */
  low: boolean;
  spent: boolean;
}

/**
 * Headroom on one provider's lane, or `null` when there is nothing to say.
 *
 * Returns null for a lane with no countable allowance rather than a zeroed
 * object, so a caller cannot accidentally render "0 left" for a provider that
 * simply has no meter.
 */
export function laneHeadroom(
  lanes: QuotaLane[],
  provider: ProviderId,
): LaneHeadroom | null {
  const lane = lanes.find((l) => l.id === provider);
  if (!lane) return null;
  const w = bindingWindow(lane);
  if (!w || w.limit <= 0) return null;
  return {
    remaining: w.remaining,
    limit: w.limit,
    window: w.window,
    low: w.remaining / w.limit < 0.2,
    spent: w.remaining === 0,
  };
}

/** Live free-tier headroom for the operator's connected providers. */
export function useQuota(): QuotaInfo {
  const [info, setInfo] = React.useState<QuotaInfo>(IDLE);

  React.useEffect(() => {
    let active = true;
    const apply = (next: QuotaInfo) => {
      if (active) setInfo(next);
    };

    subscribers.add(apply);
    if (cached) apply(cached);
    else fetchQuota();

    const onFocus = () => refreshQuota();
    window.addEventListener("focus", onFocus);

    return () => {
      active = false;
      subscribers.delete(apply);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return info;
}
