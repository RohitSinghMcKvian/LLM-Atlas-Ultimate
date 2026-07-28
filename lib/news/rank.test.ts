import { describe, expect, it } from "vitest";
import { baseScore, liveScore, recencyFactor } from "./rank";
import type { BaseScoreInput } from "./rank";
import type { Verification } from "./types";

function verification(partial: Partial<Verification> = {}): Verification {
  return {
    level: "reported",
    score: 40,
    signals: [],
    corroboration: 1,
    distinctDomains: 1,
    firstParty: false,
    ...partial,
  };
}

function input(partial: Partial<BaseScoreInput> = {}): BaseScoreInput {
  return {
    tier: "press",
    sourceWeight: 0.65,
    verification: verification(),
    relevance: 0.5,
    topicCount: 1,
    modelCount: 0,
    hasImage: false,
    summaryLength: 100,
    ...partial,
  };
}

describe("baseScore", () => {
  // The property the whole two-part design exists to preserve.
  it("does not depend on time in any way", () => {
    const one = baseScore(input());
    const two = baseScore(input());
    expect(one).toBe(two);
    // No argument to `baseScore` carries a timestamp; this is a structural check
    // that nobody has quietly added one.
    expect(Object.keys(input())).not.toContain("publishedAt");
  });

  it("ranks a verified first-party item above a lone press item", () => {
    const strong = baseScore(
      input({
        tier: "first_party",
        sourceWeight: 1,
        verification: verification({ level: "verified", distinctDomains: 3 }),
        relevance: 1,
        modelCount: 2,
        hasImage: true,
      }),
    );
    const weak = baseScore(
      input({ sourceWeight: 0.55, verification: verification({ level: "unconfirmed" }) }),
    );
    expect(strong).toBeGreaterThan(weak);
  });

  it("rewards corroboration with diminishing returns", () => {
    const at = (domains: number) =>
      baseScore(input({ verification: verification({ distinctDomains: domains }) }));
    const gain1to2 = at(2) - at(1);
    const gain4to5 = at(5) - at(4);
    expect(gain1to2).toBeGreaterThan(0);
    expect(gain4to5).toBeLessThan(gain1to2);
  });

  it("weights trust above presentation", () => {
    // An item must not out-rank a better-sourced one because it shipped an image.
    const prettyButThin = baseScore(
      input({ verification: verification({ level: "unconfirmed" }), hasImage: true, modelCount: 4 }),
    );
    const plainButVerified = baseScore(
      input({ tier: "first_party", verification: verification({ level: "verified" }) }),
    );
    expect(plainButVerified).toBeGreaterThan(prettyButThin);
  });

  it("stays within 0..100", () => {
    const max = baseScore(
      input({
        tier: "first_party",
        sourceWeight: 1,
        verification: verification({ level: "verified", distinctDomains: 12 }),
        relevance: 1,
        topicCount: 3,
        modelCount: 8,
        hasImage: true,
        summaryLength: 400,
      }),
    );
    const min = baseScore(
      input({
        tier: "press",
        sourceWeight: 0.01,
        verification: verification({ level: "unconfirmed", distinctDomains: 0 }),
        relevance: 0,
        topicCount: 0,
        modelCount: 0,
        hasImage: false,
        summaryLength: 0,
      }),
    );
    expect(max).toBeLessThanOrEqual(100);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeGreaterThan(min);
  });
});

describe("recencyFactor", () => {
  const now = Date.parse("2025-07-15T12:00:00.000Z");

  it("is 1 at publication and decays monotonically", () => {
    expect(recencyFactor("2025-07-15T12:00:00.000Z", now)).toBeCloseTo(1, 5);
    const hours = [1, 6, 20, 48, 168].map((h) =>
      recencyFactor(new Date(now - h * 3_600_000).toISOString(), now),
    );
    for (let i = 1; i < hours.length; i++) expect(hours[i]).toBeLessThan(hours[i - 1]);
  });

  it("halves at the half-life", () => {
    expect(recencyFactor(new Date(now - 20 * 3_600_000).toISOString(), now)).toBeCloseTo(0.5, 5);
  });

  it("degrades gracefully for an unparseable date", () => {
    expect(recencyFactor("not a date", now)).toBeGreaterThan(0);
    expect(recencyFactor("not a date", now)).toBeLessThan(1);
  });
});

describe("liveScore", () => {
  const now = Date.parse("2025-07-15T12:00:00.000Z");
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();

  it("orders by recency when the base score is equal", () => {
    const fresh = liveScore({ baseScore: 60, publishedAt: hoursAgo(1) }, now);
    const stale = liveScore({ baseScore: 60, publishedAt: hoursAgo(72) }, now);
    expect(fresh).toBeGreaterThan(stale);
  });

  it("lets a much better-sourced older story outrank a thin fresh one", () => {
    const strongOld = liveScore({ baseScore: 95, publishedAt: hoursAgo(40) }, now);
    const weakNew = liveScore({ baseScore: 25, publishedAt: hoursAgo(1) }, now);
    expect(strongOld).toBeGreaterThan(weakNew);
  });

  it("still lets a fresh story beat a slightly better one from days ago", () => {
    // Otherwise the feed stops being news.
    const goodWeekOld = liveScore({ baseScore: 70, publishedAt: hoursAgo(168) }, now);
    const goodToday = liveScore({ baseScore: 65, publishedAt: hoursAgo(2) }, now);
    expect(goodToday).toBeGreaterThan(goodWeekOld);
  });

  it("never returns NaN or a value outside 0..100", () => {
    const cases = [
      { baseScore: 0, publishedAt: hoursAgo(0) },
      { baseScore: 100, publishedAt: hoursAgo(0) },
      { baseScore: 100, publishedAt: hoursAgo(10_000) },
      { baseScore: 50, publishedAt: "not a date" },
      { baseScore: 50, publishedAt: "" },
    ];
    for (const article of cases) {
      const score = liveScore(article, now);
      expect(Number.isFinite(score), JSON.stringify(article)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("produces a total order with no ties for distinct inputs", () => {
    const scores = [10, 30, 50, 70, 90].map((base) =>
      liveScore({ baseScore: base, publishedAt: hoursAgo(5) }, now),
    );
    expect(new Set(scores).size).toBe(scores.length);
  });
});
