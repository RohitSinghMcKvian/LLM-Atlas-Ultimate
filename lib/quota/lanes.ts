import type { ProviderMeta } from "@/lib/catalog/providers";
import type { ProviderId } from "@/lib/catalog/types";
import { msUntilReset, windowEnd, type WindowKind } from "./windows";

// Turning the provider table's free-tier numbers into countable windows.
//
// `lib/catalog/providers.ts` states a free tier the way the provider documents
// it — `rpm`, `rpd`, `tpm`, `tpd`, `tpMonth`. The ledger needs those as uniform
// (window, unit, limit) triples so one counting path serves all of them.

/** What a limit is measured in. Requests and tokens count separately. */
export type LaneUnit = "requests" | "tokens";

/** A ceiling the provider's table declares. Static — derived from `FreeTier`. */
export interface LaneLimit {
  kind: WindowKind;
  unit: LaneUnit;
  limit: number;
}

/** A ceiling plus what has actually been spent against it this window. */
export interface LaneQuota extends LaneLimit {
  lane: ProviderId;
  used: number;
  /** Epoch ms at which `used` returns to zero. */
  resetsAt: number;
}

/**
 * The countable windows a provider's free tier implies.
 *
 * **Grants return nothing, and that is the point.** A `"grant"` — Cerebras' $5
 * trial, DeepSeek's one-off token allowance, xAI's monthly credits — has no
 * window to tumble and no starting balance Atlas can observe, so any number
 * shown against it would be invented. Grants are surfaced as "Credits" in the
 * UI (see `hasCreditGrant`) and deliberately not metered here. Metering a
 * balance we cannot read is the same class of lie `quota.kind` exists to
 * prevent.
 */
export function quotaFor(meta: ProviderMeta): LaneLimit[] {
  const q = meta.freeTier?.quota;
  if (!q || q.kind !== "recurring") return [];

  const out: LaneLimit[] = [];
  const add = (kind: WindowKind, unit: LaneUnit, limit: number | undefined) => {
    if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
      out.push({ kind, unit, limit });
    }
  };

  add("minute", "requests", q.rpm);
  add("day", "requests", q.rpd);
  add("minute", "tokens", q.tpm);
  add("day", "tokens", q.tpd);
  add("month", "tokens", q.tpMonth);
  return out;
}

/** Pair a static limit with a spend count, resolving its reset time. */
export function laneQuota(
  lane: ProviderId,
  limit: LaneLimit,
  used: number,
  now: number,
): LaneQuota {
  return { ...limit, lane, used, resetsAt: windowEnd(limit.kind, now) };
}

/**
 * Whether this window is spent.
 *
 * `>=` rather than `>`: a lane sitting exactly on its limit has no headroom for
 * the request being considered, and attempting it would earn a 429 — which is
 * precisely the round trip a pre-flight ledger exists to avoid.
 */
export function isExhausted(q: LaneQuota, now: number): boolean {
  // A stale row from a window that has already rolled over counts as spent
  // nothing, so a missed cleanup pass can never block a lane forever.
  if (now >= q.resetsAt) return false;
  return q.used >= q.limit;
}

/** The soonest any exhausted window frees up, or 0 when none are. */
export function retryAfterMs(quotas: readonly LaneQuota[], now: number): number {
  const blocked = quotas.filter((q) => isExhausted(q, now));
  if (blocked.length === 0) return 0;
  return Math.min(...blocked.map((q) => msUntilReset(q.kind, now)));
}
