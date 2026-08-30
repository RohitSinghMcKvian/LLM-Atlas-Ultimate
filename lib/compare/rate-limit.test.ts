import { describe, it, expect } from "vitest";
import {
  DEFAULT_LIMITS,
  RateLimiter,
  callerKey,
  consume,
  freshBucket,
  refill,
  type BucketLimits,
} from "./rate-limit";

const limits: BucketLimits = { capacity: 10, windowMs: 1_000 };

describe("refill", () => {
  it("returns tokens continuously, not in steps", () => {
    const half = refill({ tokens: 0, updatedAt: 0 }, limits, 500);
    expect(half.tokens).toBeCloseTo(5, 10);
  });

  it("never exceeds capacity", () => {
    expect(refill({ tokens: 8, updatedAt: 0 }, limits, 10_000).tokens).toBe(10);
  });

  it("leaves the bucket alone when the clock goes backwards", () => {
    const state = { tokens: 3, updatedAt: 1_000 };
    expect(refill(state, limits, 500)).toBe(state);
  });
});

describe("consume", () => {
  it("spends what it grants", () => {
    const d = consume(freshBucket(limits, 0), limits, 4, 0);
    expect(d.ok).toBe(true);
    expect(d.remaining).toBe(6);
  });

  it("is all or nothing — a run never starts with some of its lanes missing", () => {
    // Four tokens left, six lanes wanted. Granting four would look to the user
    // like two models failed.
    const d = consume({ tokens: 4, updatedAt: 0 }, limits, 6, 0);
    expect(d.ok).toBe(false);
    expect(d.remaining).toBe(4);
  });

  it("says how long to wait for the shortfall, not for a full bucket", () => {
    // 2 short of 10 capacity over a 1000ms window = 200ms.
    const d = consume({ tokens: 4, updatedAt: 0 }, limits, 6, 0);
    expect(d.retryAfterMs).toBe(200);
  });

  it("refuses a request larger than the bucket immediately rather than forever", () => {
    const d = consume(freshBucket(limits, 0), limits, 99, 0);
    expect(d.ok).toBe(false);
    expect(d.retryAfterMs).toBe(0);
  });

  it("treats a zero cost as one, so a free request still counts", () => {
    const d = consume(freshBucket(limits, 0), limits, 0, 0);
    expect(d.remaining).toBe(9);
  });

  it("recovers over time", () => {
    const empty = { tokens: 0, updatedAt: 0 };
    expect(consume(empty, limits, 5, 500).ok).toBe(true);
  });
});

describe("RateLimiter", () => {
  it("keeps callers apart", () => {
    const rl = new RateLimiter(limits);
    expect(rl.check("a", 10, 0).ok).toBe(true);
    expect(rl.check("a", 1, 0).ok).toBe(false);
    expect(rl.check("b", 10, 0).ok).toBe(true);
  });

  it("carries state between calls for the same caller", () => {
    const rl = new RateLimiter(limits);
    rl.check("a", 6, 0);
    expect(rl.check("a", 6, 0).ok).toBe(false);
    expect(rl.check("a", 4, 0).ok).toBe(true);
  });

  it("forgets callers whose buckets have refilled, so the map cannot grow forever", () => {
    const rl = new RateLimiter(limits);
    rl.check("a", 1, 0);
    rl.check("b", 1, 0);
    expect(rl.size).toBe(2);
    expect(rl.sweep(10_000)).toBe(2);
    expect(rl.size).toBe(0);
  });

  it("keeps callers who are still throttled", () => {
    const rl = new RateLimiter(limits);
    rl.check("a", 10, 0);
    expect(rl.sweep(100)).toBe(0);
  });
});

describe("DEFAULT_LIMITS", () => {
  it("allows two full six-lane runs back to back, then throttles", () => {
    const rl = new RateLimiter(DEFAULT_LIMITS);
    expect(rl.check("ip", 6, 0).ok).toBe(true);
    expect(rl.check("ip", 6, 0).ok).toBe(true);
    expect(rl.check("ip", 6, 0).ok).toBe(false);
  });
});

describe("callerKey", () => {
  it("takes the leftmost forwarded address", () => {
    expect(callerKey(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    expect(callerKey(new Headers({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("buckets everything unidentifiable together rather than exempting it", () => {
    expect(callerKey(new Headers())).toBe("anonymous");
  });

  it("ignores an empty forwarded header", () => {
    expect(callerKey(new Headers({ "x-forwarded-for": "  " }))).toBe("anonymous");
  });
});
