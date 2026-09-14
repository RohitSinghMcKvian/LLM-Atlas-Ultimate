import { describe, expect, it } from "vitest";
import { bindingWindow, laneHeadroom, type QuotaLane, type QuotaWindow } from "./use-quota";

// The pure half of the quota hook. These two functions decide which single
// number a user is shown out of several competing windows, so picking the wrong
// one promises headroom that is not there.

const win = (over: Partial<QuotaWindow>): QuotaWindow => ({
  window: "day",
  unit: "requests",
  limit: 100,
  used: 0,
  remaining: 100,
  resetsAt: 0,
  ...over,
});

const lane = (windows: QuotaWindow[]): QuotaLane => ({
  id: "groq",
  name: "Groq",
  kind: "recurring",
  credits: false,
  windows,
});

describe("bindingWindow", () => {
  it("picks the window closest to running out, not the roomiest", () => {
    // The whole point: 900 requests left today is irrelevant when only 2 of
    // this minute's 30 remain. Showing the day figure would promise headroom
    // the next request cannot use.
    const minute = win({ window: "minute", limit: 30, used: 28, remaining: 2 });
    const day = win({ window: "day", limit: 1000, used: 100, remaining: 900 });
    expect(bindingWindow(lane([day, minute]))?.window).toBe("minute");
  });

  it("compares by fraction, so the bigger raw number can still be the binding one", () => {
    // 400 requests left of 1 000 (40%) is tighter than 50 tokens left of 100
    // (50%), even though 50 is the smaller number. Ranking by raw count would
    // pick the token window and understate how close the request cap is.
    const requests = win({ limit: 1000, used: 600, remaining: 400 });
    const tokens = win({ unit: "tokens", limit: 100, used: 50, remaining: 50 });
    expect(bindingWindow(lane([tokens, requests]))?.unit).toBe("requests");
  });

  it("breaks a tie toward the shorter window, which recovers first", () => {
    const minute = win({ window: "minute", limit: 10, used: 5, remaining: 5 });
    const month = win({ window: "month", limit: 100, used: 50, remaining: 50 });
    expect(bindingWindow(lane([month, minute]))?.window).toBe("minute");
  });

  it("returns undefined for a lane with no windows", () => {
    expect(bindingWindow(lane([]))).toBeUndefined();
  });
});

describe("laneHeadroom", () => {
  const lanes = [lane([win({ limit: 100, used: 90, remaining: 10 })])];

  it("reports the binding window's remaining and limit", () => {
    const h = laneHeadroom(lanes, "groq")!;
    expect(h.remaining).toBe(10);
    expect(h.limit).toBe(100);
    expect(h.window).toBe("day");
  });

  it("flags low below a fifth remaining, and not above it", () => {
    expect(laneHeadroom(lanes, "groq")!.low).toBe(true);
    const roomy = [lane([win({ limit: 100, used: 50, remaining: 50 })])];
    expect(laneHeadroom(roomy, "groq")!.low).toBe(false);
  });

  it("flags spent only at zero", () => {
    expect(laneHeadroom(lanes, "groq")!.spent).toBe(false);
    const out = [lane([win({ limit: 100, used: 100, remaining: 0 })])];
    expect(laneHeadroom(out, "groq")!.spent).toBe(true);
  });

  // Returning null rather than a zeroed object is what stops a badge rendering
  // "0 left" for a provider that simply has no meter.
  it("returns null for a lane it knows nothing about", () => {
    expect(laneHeadroom(lanes, "anthropic")).toBeNull();
    expect(laneHeadroom([], "groq")).toBeNull();
  });

  it("returns null for a lane with no countable window", () => {
    expect(laneHeadroom([lane([])], "groq")).toBeNull();
    expect(laneHeadroom([lane([win({ limit: 0, remaining: 0 })])], "groq")).toBeNull();
  });
});
