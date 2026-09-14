import { describe, expect, it } from "vitest";
import { msUntilReset, windowEnd, windowKey, windowStart } from "./windows";

const at = (iso: string) => Date.parse(iso);

describe("windowStart", () => {
  it("floors to the containing window", () => {
    const t = at("2026-09-10T13:47:31.482Z");
    expect(new Date(windowStart("minute", t)).toISOString()).toBe("2026-09-10T13:47:00.000Z");
    expect(new Date(windowStart("day", t)).toISOString()).toBe("2026-09-10T00:00:00.000Z");
    expect(new Date(windowStart("month", t)).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("is idempotent on an exact boundary", () => {
    // A request landing precisely on the boundary belongs to the new window,
    // not the one that just closed.
    const t = at("2026-09-01T00:00:00.000Z");
    for (const kind of ["minute", "day", "month"] as const) {
      expect(windowStart(kind, t)).toBe(t);
    }
  });
});

describe("windowEnd", () => {
  it("returns the first instant of the next window", () => {
    const t = at("2026-09-10T13:47:31.482Z");
    expect(new Date(windowEnd("minute", t)).toISOString()).toBe("2026-09-10T13:48:00.000Z");
    expect(new Date(windowEnd("day", t)).toISOString()).toBe("2026-09-11T00:00:00.000Z");
    expect(new Date(windowEnd("month", t)).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("rolls the year over in December", () => {
    expect(new Date(windowEnd("month", at("2026-12-14T09:00:00Z"))).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("handles months of every length, including a leap February", () => {
    const cases: [string, string][] = [
      ["2026-02-10T00:00:00Z", "2026-03-01T00:00:00.000Z"], // 28 days
      ["2028-02-10T00:00:00Z", "2028-03-01T00:00:00.000Z"], // 29 days, leap year
      ["2026-04-10T00:00:00Z", "2026-05-01T00:00:00.000Z"], // 30 days
      ["2026-07-10T00:00:00Z", "2026-08-01T00:00:00.000Z"], // 31 days
    ];
    for (const [now, expected] of cases) {
      expect(new Date(windowEnd("month", at(now))).toISOString()).toBe(expected);
    }
  });
});

// The reason this module is UTC-only, pinned so nobody localises it later.
describe("daylight saving", () => {
  it("keeps every day exactly 24 hours across a DST changeover", () => {
    // 2026-03-08 is the US spring-forward date: local time loses an hour, and a
    // local-midnight implementation would produce a 23-hour window here — one
    // that silently grants an hour less quota than the provider does.
    const before = at("2026-03-08T05:30:00Z");
    const after = at("2026-03-09T05:30:00Z");
    expect(windowStart("day", after) - windowStart("day", before)).toBe(86_400_000);
  });

  it("advances the day window at UTC midnight, not local midnight", () => {
    // 23:30 in New York on the 10th is already the 11th in UTC. Providers reset
    // on UTC, so this must read as the 11th's window.
    expect(new Date(windowStart("day", at("2026-09-11T03:30:00Z"))).toISOString()).toBe(
      "2026-09-11T00:00:00.000Z",
    );
  });
});

describe("windowKey", () => {
  it("is stable for every instant inside one window", () => {
    const a = windowKey("day", at("2026-09-10T00:00:00.001Z"));
    const b = windowKey("day", at("2026-09-10T23:59:59.999Z"));
    expect(a).toBe(b);
    expect(a).toBe("2026-09-10T00:00:00.000Z");
  });

  it("differs across adjacent windows", () => {
    expect(windowKey("minute", at("2026-09-10T13:47:59Z"))).not.toBe(
      windowKey("minute", at("2026-09-10T13:48:00Z")),
    );
  });
});

describe("msUntilReset", () => {
  it("counts down to the window boundary", () => {
    expect(msUntilReset("minute", at("2026-09-10T13:47:30Z"))).toBe(30_000);
  });

  it("never goes negative", () => {
    expect(msUntilReset("day", at("2026-09-10T00:00:00Z"))).toBeGreaterThan(0);
    expect(msUntilReset("minute", at("2026-09-10T13:48:00Z"))).toBe(60_000);
  });
});
