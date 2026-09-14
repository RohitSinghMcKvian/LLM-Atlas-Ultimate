import { describe, expect, it } from "vitest";
import { PROVIDERS, type ProviderMeta } from "@/lib/catalog/providers";
import { PROVIDER_LIST } from "@/lib/catalog/providers";
import { isExhausted, laneQuota, quotaFor, retryAfterMs } from "./lanes";

const at = (iso: string) => Date.parse(iso);
const NOW = at("2026-09-10T13:47:30Z");

const meta = (over: Partial<ProviderMeta>): ProviderMeta =>
  ({ ...PROVIDERS.groq, ...over }) as ProviderMeta;

const tier = (quota: NonNullable<ProviderMeta["freeTier"]>["quota"]) =>
  meta({
    freeTier: {
      scope: { kind: "all" },
      quota,
      signupUrl: "https://example.test",
      cardRequired: false,
    },
  });

describe("quotaFor", () => {
  it("maps each documented limit onto its window and unit", () => {
    const limits = quotaFor(
      tier({ kind: "recurring", rpm: 30, rpd: 1000, tpm: 6000, tpd: 500_000, tpMonth: 1e9 }),
    );
    expect(limits).toEqual([
      { kind: "minute", unit: "requests", limit: 30 },
      { kind: "day", unit: "requests", limit: 1000 },
      { kind: "minute", unit: "tokens", limit: 6000 },
      { kind: "day", unit: "tokens", limit: 500_000 },
      { kind: "month", unit: "tokens", limit: 1e9 },
    ]);
  });

  // The honesty rule, enforced at the only place it can be enforced.
  it("returns nothing for a grant, however concrete its numbers look", () => {
    // A trial balance is not a window: it does not reset, and Atlas cannot see
    // what has already been spent from it. Any meter drawn here would be
    // invented.
    expect(quotaFor(tier({ kind: "grant", creditsUsd: 25, rpd: 1000 }))).toEqual([]);
  });

  it("returns nothing for a provider with no free tier at all", () => {
    expect(quotaFor(meta({ freeTier: undefined }))).toEqual([]);
    expect(quotaFor(PROVIDERS.anthropic)).toEqual([]);
    expect(quotaFor(PROVIDERS.openai)).toEqual([]);
  });

  it("ignores zero and non-finite limits rather than blocking on them", () => {
    // A `0` in the table would otherwise mean "exhausted before the first
    // request", silently removing the lane.
    expect(quotaFor(tier({ kind: "recurring", rpm: 0, rpd: Number.NaN }))).toEqual([]);
  });

  it("derives a countable window for at least one real free provider", () => {
    // Guards against the table and this mapping drifting apart: if every
    // provider stopped producing limits, the ledger would silently no-op.
    const withQuotas = PROVIDER_LIST.filter((p) => quotaFor(p).length > 0);
    expect(withQuotas.length).toBeGreaterThan(0);
  });
});

describe("isExhausted", () => {
  const q = (used: number, limit = 10) =>
    laneQuota("groq", { kind: "minute", unit: "requests", limit }, used, NOW);

  it("blocks on reaching the limit, not only past it", () => {
    // A lane sitting exactly on its ceiling has no room for the request being
    // considered — attempting it earns the 429 the ledger exists to avoid.
    expect(isExhausted(q(9), NOW)).toBe(false);
    expect(isExhausted(q(10), NOW)).toBe(true);
    expect(isExhausted(q(11), NOW)).toBe(true);
  });

  it("frees the lane once the window has rolled over", () => {
    // A stale row that outlived its window must never block forever, whatever
    // happened to the cleanup pass.
    const stale = q(999);
    expect(isExhausted(stale, NOW)).toBe(true);
    expect(isExhausted(stale, stale.resetsAt)).toBe(false);
    expect(isExhausted(stale, stale.resetsAt + 60_000)).toBe(false);
  });
});

describe("retryAfterMs", () => {
  it("reports the soonest window that frees up", () => {
    const minute = laneQuota("groq", { kind: "minute", unit: "requests", limit: 1 }, 5, NOW);
    const day = laneQuota("groq", { kind: "day", unit: "requests", limit: 1 }, 5, NOW);
    // Both are spent; the minute window recovers first.
    expect(retryAfterMs([day, minute], NOW)).toBe(30_000);
  });

  it("is zero when nothing is exhausted", () => {
    const ok = laneQuota("groq", { kind: "day", unit: "requests", limit: 10 }, 1, NOW);
    expect(retryAfterMs([ok], NOW)).toBe(0);
  });
});
