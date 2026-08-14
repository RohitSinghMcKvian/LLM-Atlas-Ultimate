import { describe, it, expect } from "vitest";
import { Budget, DEFAULT_LIMITS } from "./budget";

/** Controllable clock, so the time cap is tested without waiting. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("Budget", () => {
  it("starts unspent", () => {
    const b = new Budget();
    expect(b.spent).toMatchObject({ queries: 0, sources: 0, rounds: 0 });
    expect(b.exhausted).toBe(false);
  });

  it("uses the defaults, overridden per field", () => {
    const b = new Budget({ maxQueries: 2 });
    expect(b.limits.maxQueries).toBe(2);
    expect(b.limits.maxSources).toBe(DEFAULT_LIMITS.maxSources);
  });

  it("charges and reports what remains", () => {
    const b = new Budget({ maxQueries: 5 });
    expect(b.charge("queries", 2)).toBe(2);
    expect(b.remaining("queries")).toBe(3);
  });

  // Asking for four with two left should run two, not zero.
  it("grants a partial amount rather than refusing outright", () => {
    const b = new Budget({ maxQueries: 3 });
    b.charge("queries", 2);
    expect(b.charge("queries", 4)).toBe(1);
    expect(b.remaining("queries")).toBe(0);
  });

  it("never grants past the cap, however many times it is asked", () => {
    const b = new Budget({ maxQueries: 2 });
    for (let i = 0; i < 20; i++) b.charge("queries", 5);
    expect(b.spent.queries).toBe(2);
  });

  it("ignores a zero or negative charge", () => {
    const b = new Budget({ maxQueries: 3 });
    expect(b.charge("queries", 0)).toBe(0);
    expect(b.charge("queries", -5)).toBe(0);
    expect(b.spent.queries).toBe(0);
  });

  it("keeps the three counters independent", () => {
    const b = new Budget({ maxQueries: 1, maxSources: 5, maxRounds: 2 });
    b.charge("queries", 1);
    expect(b.remaining("sources")).toBe(5);
    expect(b.remaining("rounds")).toBe(2);
  });

  it("is exhausted when any single limit is reached", () => {
    const b = new Budget({ maxQueries: 1, maxSources: 5, maxRounds: 5 });
    b.charge("queries", 1);
    expect(b.exhausted).toBe(true);
  });

  describe("time", () => {
    // Time and query caps fail differently: a slow provider exhausts one, a fast
    // one the other. Both are real limits.
    it("expires on wall clock even with budget left", () => {
      const c = clock();
      const b = new Budget({ maxMs: 1000, maxQueries: 100 }, c.now);
      expect(b.exhausted).toBe(false);
      c.advance(1500);
      expect(b.outOfTime).toBe(true);
      expect(b.exhausted).toBe(true);
      // Every query is still unspent — time alone ended it.
      expect(b.remaining("queries")).toBe(100);
    });

    it("refuses to charge once out of time", () => {
      const c = clock();
      const b = new Budget({ maxMs: 1000 }, c.now);
      c.advance(2000);
      expect(b.charge("queries", 1)).toBe(0);
    });

    it("reports elapsed time", () => {
      const c = clock();
      const b = new Budget({}, c.now);
      c.advance(250);
      expect(b.elapsedMs).toBe(250);
    });
  });

  describe("stopReason", () => {
    it("is null while there is room", () => {
      expect(new Budget().stopReason()).toBeNull();
    });

    it("names the time limit first, since it overrides everything", () => {
      const c = clock();
      const b = new Budget({ maxMs: 1000, maxQueries: 1 }, c.now);
      b.charge("queries", 1);
      c.advance(2000);
      expect(b.stopReason()).toContain("time limit");
    });

    it.each([
      [{ maxQueries: 1 }, "queries" as const, "search limit"],
      [{ maxSources: 1 }, "sources" as const, "source limit"],
      [{ maxRounds: 1 }, "rounds" as const, "rounds"],
    ])("names the %o limit", (limits, kind, phrase) => {
      const b = new Budget(limits);
      b.charge(kind, 1);
      expect(b.stopReason()).toContain(phrase);
    });
  });
});
