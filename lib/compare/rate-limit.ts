// A token bucket for the compare routes.
//
// Compare is the one endpoint in the app that turns a single request into N
// concurrent upstream calls plus judge and synthesis passes, and it is
// unauthenticated (`middleware.ts` has gating disabled and `lib/auth/routes.ts`
// classifies every `/api/…` path as public). Before this rebuild that was one
// fan-out; a six-lane Deep run is several times larger. Multiplying the fan-out
// without any guard would be handing out the operator's provider budget.
//
// This is a mitigation, not authentication. It stops accidental and casual
// abuse from one address; it does not stop anyone determined, and it is
// per-instance, so a serverless deployment enforces it per warm instance rather
// than globally. Both limits are stated here rather than implied so nobody
// mistakes it for a security control.
//
// Pure state transitions with an injected clock, so the refill arithmetic — the
// part that is easy to get subtly wrong and impossible to notice — is tested.

export interface BucketLimits {
  /** Tokens the bucket holds when full. A burst this size is allowed at once. */
  capacity: number;
  /** Milliseconds to refill from empty to full. */
  windowMs: number;
}

export interface BucketState {
  tokens: number;
  /** When `tokens` was last accurate. */
  updatedAt: number;
}

export interface Decision {
  ok: boolean;
  state: BucketState;
  /** Tokens left after the decision, floored at 0. */
  remaining: number;
  /** How long until the request would succeed. 0 when it did. */
  retryAfterMs: number;
}

/**
 * One lane, one token.
 *
 * Charging per lane rather than per request is the whole point: a one-lane Quick
 * run and a six-lane Deep run are not the same load, and a per-request limit
 * would price them identically.
 */
export const DEFAULT_LIMITS: BucketLimits = {
  capacity: 12,
  windowMs: 5 * 60 * 1000,
};

export function freshBucket(limits: BucketLimits, now: number): BucketState {
  return { tokens: limits.capacity, updatedAt: now };
}

/**
 * Bring a bucket up to date.
 *
 * Continuous rather than stepped: a caller that waits half the window gets half
 * the capacity back, instead of nothing until the window rolls over. Clock
 * skew that moves `now` backwards leaves the bucket untouched rather than
 * draining it.
 */
export function refill(state: BucketState, limits: BucketLimits, now: number): BucketState {
  const elapsed = now - state.updatedAt;
  if (elapsed <= 0) return state;
  const gained = (elapsed / limits.windowMs) * limits.capacity;
  return {
    tokens: Math.min(limits.capacity, state.tokens + gained),
    updatedAt: now,
  };
}

/**
 * Spend `cost` tokens if they are there.
 *
 * All or nothing. A partial grant would let a six-lane run start four lanes and
 * silently drop two, which is worse than being told to wait — the user would
 * read the missing lanes as models that failed.
 */
export function consume(
  state: BucketState,
  limits: BucketLimits,
  cost: number,
  now: number,
): Decision {
  const filled = refill(state, limits, now);
  const want = Math.max(1, cost);

  // A request larger than the bucket could ever hold would wait forever, so it
  // is refused immediately rather than queued against an impossible threshold.
  if (want > limits.capacity) {
    return { ok: false, state: filled, remaining: Math.floor(filled.tokens), retryAfterMs: 0 };
  }

  if (filled.tokens >= want) {
    const next = { tokens: filled.tokens - want, updatedAt: now };
    return { ok: true, state: next, remaining: Math.floor(next.tokens), retryAfterMs: 0 };
  }

  const shortfall = want - filled.tokens;
  const retryAfterMs = Math.ceil((shortfall / limits.capacity) * limits.windowMs);
  return { ok: false, state: filled, remaining: Math.floor(filled.tokens), retryAfterMs };
}

/**
 * Buckets keyed by caller.
 *
 * Deliberately a plain `Map` and not Redis: this deployment has no durable
 * store on the request path, and a per-instance limiter that works is better
 * than a global one that needs infrastructure the project does not have.
 */
export class RateLimiter {
  private buckets = new Map<string, BucketState>();

  constructor(private limits: BucketLimits = DEFAULT_LIMITS) {}

  check(key: string, cost: number, now: number = Date.now()): Decision {
    const current = this.buckets.get(key) ?? freshBucket(this.limits, now);
    const decision = consume(current, this.limits, cost, now);
    this.buckets.set(key, decision.state);
    return decision;
  }

  /**
   * Forget buckets that have refilled completely.
   *
   * Without this the map grows once per distinct caller and never shrinks. A
   * full bucket is indistinguishable from a fresh one, so dropping it loses
   * nothing.
   */
  sweep(now: number = Date.now()): number {
    let dropped = 0;
    for (const [key, state] of this.buckets) {
      if (refill(state, this.limits, now).tokens >= this.limits.capacity) {
        this.buckets.delete(key);
        dropped++;
      }
    }
    return dropped;
  }

  get size(): number {
    return this.buckets.size;
  }
}

/**
 * The identity a limit is applied to.
 *
 * `x-forwarded-for` is the only signal available behind Vercel's proxy and it
 * is trivially spoofable, which is exactly why this is a mitigation rather than
 * a control. The leftmost entry is the client as the first proxy saw it.
 */
export function callerKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "anonymous";
}

/** Process-wide limiter for the compare routes. */
export const compareLimiter = new RateLimiter();
