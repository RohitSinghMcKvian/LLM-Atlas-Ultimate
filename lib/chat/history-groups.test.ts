import { describe, it, expect } from "vitest";
import { bucketFor, BUCKET_ORDER, groupByRecency } from "./history-groups";

/** Midday, so day-boundary arithmetic is not accidentally right. */
const NOW = new Date("2026-08-08T12:00:00").getTime();
const DAY = 86_400_000;
const at = (ms: number, over: { id?: string; pinned?: boolean } = {}) => ({
  id: over.id ?? String(ms),
  updatedAt: ms,
  ...(over.pinned ? { pinned: true } : {}),
});

describe("bucketFor", () => {
  it("puts anything from today in Today", () => {
    expect(bucketFor(at(NOW), NOW)).toBe("Today");
    expect(bucketFor(at(new Date("2026-08-08T00:05:00").getTime()), NOW)).toBe("Today");
  });

  // Calendar days, not elapsed hours: something from 11pm last night is
  // "Yesterday" even though it is thirteen hours old, because that is what the
  // user means by it.
  it("cuts on calendar days rather than elapsed time", () => {
    expect(bucketFor(at(new Date("2026-08-07T23:00:00").getTime()), NOW)).toBe("Yesterday");
    expect(bucketFor(at(new Date("2026-08-08T00:30:00").getTime()), NOW)).toBe("Today");
  });

  it("walks out through the wider buckets", () => {
    expect(bucketFor(at(NOW - 3 * DAY), NOW)).toBe("Last 7 days");
    expect(bucketFor(at(NOW - 7 * DAY), NOW)).toBe("Last 7 days");
    expect(bucketFor(at(NOW - 8 * DAY), NOW)).toBe("Last 30 days");
    expect(bucketFor(at(NOW - 30 * DAY), NOW)).toBe("Last 30 days");
    expect(bucketFor(at(NOW - 31 * DAY), NOW)).toBe("Older");
  });

  // A pin is a statement that this one should not sink with time.
  it("lets a pin outrank the date", () => {
    expect(bucketFor(at(NOW - 400 * DAY, { pinned: true }), NOW)).toBe("Pinned");
  });

  // Clock skew and future-dated rows are real; landing them in "Older" would put
  // the most recent thing at the bottom of the list.
  it("reads a future timestamp as today", () => {
    expect(bucketFor(at(NOW + DAY), NOW)).toBe("Today");
  });
});

describe("groupByRecency", () => {
  it("returns groups in display order", () => {
    const groups = groupByRecency(
      [at(NOW - 40 * DAY), at(NOW), at(NOW - DAY), at(NOW - 3 * DAY, { pinned: true })],
      NOW,
    );
    expect(groups.map((g) => g.bucket)).toEqual(["Pinned", "Today", "Yesterday", "Older"]);
  });

  it("omits empty groups", () => {
    expect(groupByRecency([at(NOW)], NOW).map((g) => g.bucket)).toEqual(["Today"]);
    expect(groupByRecency([], NOW)).toEqual([]);
  });

  // The store sorts pinned-first, which is right for a two-bucket list and wrong
  // here: a pinned row would otherwise pull its whole day out of sequence.
  it("sorts newest first inside each group regardless of input order", () => {
    const groups = groupByRecency(
      [
        at(NOW - 3 * DAY, { id: "old" }),
        at(NOW - 2 * DAY, { id: "mid" }),
        at(NOW - 4 * DAY, { id: "older" }),
      ],
      NOW,
    );
    expect(groups[0].items.map((i) => i.id)).toEqual(["mid", "old", "older"]);
  });

  it("keeps every item exactly once", () => {
    const items = Array.from({ length: 20 }, (_, i) => at(NOW - i * 3 * DAY, { id: `c${i}` }));
    const groups = groupByRecency(items, NOW);
    expect(groups.flatMap((g) => g.items)).toHaveLength(items.length);
    expect(new Set(groups.flatMap((g) => g.items.map((i) => i.id))).size).toBe(items.length);
  });

  it("only ever emits known buckets", () => {
    const groups = groupByRecency(
      Array.from({ length: 50 }, (_, i) => at(NOW - i * 5 * DAY)),
      NOW,
    );
    for (const g of groups) expect(BUCKET_ORDER).toContain(g.bucket);
  });
});
