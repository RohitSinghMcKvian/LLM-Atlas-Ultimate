import { PROVIDERS } from "@/lib/catalog/providers";
import type { ProviderId } from "@/lib/catalog/types";
import { applyProviderHeaders } from "./headers";
import { bumpUsage, counterKey, raiseUsage, readUsage, type ObservedWindow } from "./ledger";
import { isExhausted, laneQuota, quotaFor, retryAfterMs, type LaneQuota } from "./lanes";

// The quota ledger's public face.
//
// One design decision shapes everything here: **only the operator's own key is
// metered server-side.** When a user brings their own key the quota is theirs,
// the request carries their credential, and Atlas counting it would be both
// wrong (it cannot see spend from that key outside this app) and pointless —
// there is no shared pool to protect. The browser tracks those; see
// `GET /api/v1/quota`, which reports operator lanes only.
//
// That is also why the subject below is the constant `"operator"` rather than a
// per-user identity. A provider's free tier applies to *the key*, so every
// caller served by the operator's key is spending from one pool, and a
// per-caller counter would let N users each consume the whole allowance. Fair
// shares between callers are a different problem, handled where it belongs — a
// per-IP limiter on the route (`lib/compare/rate-limit.ts`) — rather than by
// pretending the provider's ceiling is per-user.

export { counterKey, bumpUsage, raiseUsage, readUsage, resetLedgerMemory } from "./ledger";
export type { ObservedWindow } from "./ledger";
export { applyProviderHeaders, parseResetAt, parseRetryAfter } from "./headers";
export { isExhausted, laneQuota, quotaFor, retryAfterMs } from "./lanes";
export type { LaneLimit, LaneQuota, LaneUnit } from "./lanes";
export { msUntilReset, windowEnd, windowKey, windowStart } from "./windows";
export type { WindowKind } from "./windows";

/**
 * The subject every operator-funded lane counts against.
 *
 * A constant, not an identity — see the note above.
 */
export const OPERATOR_SUBJECT = "operator";

/** Lanes whose free tier is a countable recurring allowance. */
export function meterableLanes(lanes: readonly ProviderId[]): ProviderId[] {
  return [...new Set(lanes)].filter((id) => quotaFor(PROVIDERS[id]).length > 0);
}

/**
 * Current quota state for these lanes: the table's ceilings, filled in with
 * what the ledger has recorded this window.
 */
export async function laneQuotas(
  lanes: readonly ProviderId[],
  now: number = Date.now(),
): Promise<Map<ProviderId, LaneQuota[]>> {
  const metered = meterableLanes(lanes);
  const out = new Map<ProviderId, LaneQuota[]>();
  if (metered.length === 0) return out;

  const usage = await readUsage(OPERATOR_SUBJECT, metered, now);
  for (const lane of metered) {
    out.set(
      lane,
      quotaFor(PROVIDERS[lane]).map((limit) =>
        laneQuota(lane, limit, usage.get(counterKey(lane, limit.kind, limit.unit)) ?? 0, now),
      ),
    );
  }
  return out;
}

/**
 * Record one request against an operator lane, and reconcile the lane against
 * whatever the provider said about it in the same breath.
 *
 * Two writes rather than one because they answer different questions: the bump
 * is "Atlas made a request", the reconcile is "and the provider says the true
 * total is at least this". Folding them together would mean choosing one, and
 * each is wrong without the other — the bump alone drifts below reality, the
 * reconcile alone records nothing on a provider that publishes no headers.
 *
 * Never throws. The caller is streaming a response to a user; a counter is not
 * worth failing that over.
 */
export async function recordSpend(
  lane: ProviderId,
  headers?: Headers,
  delta: { requests?: number; tokens?: number } = {},
  now: number = Date.now(),
): Promise<void> {
  if (quotaFor(PROVIDERS[lane]).length === 0) return;
  try {
    await bumpUsage(OPERATOR_SUBJECT, lane, delta, now);
    if (!headers) return;

    // Re-read after the bump so the reconcile compares against a current
    // estimate rather than raising to a figure we have just exceeded.
    const usage = await readUsage(OPERATOR_SUBJECT, [lane], now);
    const quotas = quotaFor(PROVIDERS[lane]).map((limit) =>
      laneQuota(lane, limit, usage.get(counterKey(lane, limit.kind, limit.unit)) ?? 0, now),
    );

    const observed = new Map<string, ObservedWindow>();
    for (const q of applyProviderHeaders(quotas, headers, now)) {
      const entry = observed.get(q.kind) ?? { kind: q.kind };
      if (q.unit === "requests") entry.requests = q.used;
      else entry.tokens = q.used;
      observed.set(q.kind, entry);
    }
    await raiseUsage(OPERATOR_SUBJECT, lane, [...observed.values()], now);
  } catch {
    // A ledger that cannot write is a weaker mitigation, not a broken request.
  }
}

/** A route the ledger can reason about, without importing the router's types. */
export interface MeterableRoute {
  provider: ProviderId;
  /**
   * True when this attempt would spend the *operator's* allowance. A route
   * carrying the user's own key is never blocked by the operator's ledger.
   */
  operatorFunded: boolean;
}

export interface DropResult<T> {
  /** Routes still worth attempting, in the order given. */
  keep: T[];
  /** Lanes skipped, with the reason available for the error message. */
  blocked: ProviderId[];
  /** Soonest any blocked lane frees up. 0 when nothing was blocked. */
  retryAfterMs: number;
}

/**
 * Remove candidates whose lane has no allowance left.
 *
 * An exhausted lane is **skipped, never attempted** — that is the whole reason
 * to keep a ledger rather than react to 429s. Reacting costs a round trip, and
 * on a provider that counts rejected requests it digs the hole deeper.
 *
 * Generic over the route type so `lib/router` can pass its own `ResolvedRoute`
 * without this module depending on it — the dependency runs router → quota, and
 * only that way.
 */
export async function dropExhausted<T extends MeterableRoute>(
  routes: readonly T[],
  now: number = Date.now(),
): Promise<DropResult<T>> {
  const lanes = routes.filter((r) => r.operatorFunded).map((r) => r.provider);
  const quotas = await laneQuotas(lanes, now);
  if (quotas.size === 0) return { keep: [...routes], blocked: [], retryAfterMs: 0 };

  const spent = new Map<ProviderId, LaneQuota[]>();
  for (const [lane, qs] of quotas) {
    const out = qs.filter((q) => isExhausted(q, now));
    if (out.length > 0) spent.set(lane, out);
  }
  if (spent.size === 0) return { keep: [...routes], blocked: [], retryAfterMs: 0 };

  const keep = routes.filter((r) => !(r.operatorFunded && spent.has(r.provider)));
  const blocked = [...spent.keys()];
  const soonest = Math.min(...[...spent.values()].map((qs) => retryAfterMs(qs, now)));

  return { keep, blocked, retryAfterMs: soonest };
}
