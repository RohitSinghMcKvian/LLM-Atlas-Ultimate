import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  deriveCompareProgress,
  getCompareProgress,
  getCompareProgressServer,
  publishCompareProgress,
  subscribeCompareProgress,
} from "./live-pill";

beforeEach(() => {
  publishCompareProgress(null);
});

describe("compare live-pill signal", () => {
  it("starts empty, so a route that never opens Compare draws nothing", () => {
    expect(getCompareProgress()).toBeNull();
  });

  it("never reports a run during server render", () => {
    publishCompareProgress({ done: 1, total: 4 });
    expect(getCompareProgressServer()).toBeNull();
  });

  it("hands the published numbers back to subscribers", () => {
    const seen = vi.fn();
    const off = subscribeCompareProgress(seen);

    publishCompareProgress({ done: 2, total: 5 });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(getCompareProgress()).toEqual({ done: 2, total: 5 });

    off();
    publishCompareProgress({ done: 3, total: 5 });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  /**
   * The runtime commits roughly every 48 ms while lanes stream, and every
   * commit republishes. `useSyncExternalStore` re-reads `getSnapshot` after
   * each notification and loops forever if the value keeps changing identity,
   * so an unchanged publish has to be a genuine no-op — not merely cheap.
   */
  it("is a no-op when the numbers have not moved", () => {
    const seen = vi.fn();
    subscribeCompareProgress(seen);

    publishCompareProgress({ done: 1, total: 3 });
    const first = getCompareProgress();

    publishCompareProgress({ done: 1, total: 3 });
    expect(seen).toHaveBeenCalledTimes(1);
    // Same reference, so `useSyncExternalStore` sees no change at all.
    expect(getCompareProgress()).toBe(first);
  });

  it("notifies when a run ends", () => {
    const seen = vi.fn();
    subscribeCompareProgress(seen);

    publishCompareProgress({ done: 4, total: 4 });
    publishCompareProgress(null);

    expect(seen).toHaveBeenCalledTimes(2);
    expect(getCompareProgress()).toBeNull();
  });

  it("does not fire twice for a run that was already absent", () => {
    const seen = vi.fn();
    subscribeCompareProgress(seen);
    publishCompareProgress(null);
    expect(seen).not.toHaveBeenCalled();
  });
});

describe("deriveCompareProgress", () => {
  const lane = (status: string, blocked = false) => ({ status, blocked });

  it("reports nothing when no lane is still working", () => {
    expect(deriveCompareProgress([lane("done"), lane("done")])).toBeNull();
    expect(deriveCompareProgress([])).toBeNull();
    expect(deriveCompareProgress([lane("error"), lane("done")])).toBeNull();
  });

  it("counts answered lanes while one is still streaming", () => {
    expect(
      deriveCompareProgress([lane("done"), lane("done"), lane("streaming")]),
    ).toEqual({ done: 2, total: 3 });
  });

  it("treats a queued lane as live", () => {
    expect(deriveCompareProgress([lane("done"), lane("queued")])).toEqual({
      done: 1,
      total: 2,
    });
  });

  /**
   * The reason `total` is not `lanes.length`. A blocked lane never answers, so
   * counting it would pin the pill at "5/6" for the rest of the run.
   */
  it("leaves blocked lanes out of the total", () => {
    expect(
      deriveCompareProgress([
        lane("done"),
        lane("streaming"),
        lane("blocked", true),
      ]),
    ).toEqual({ done: 1, total: 2 });
  });

  it("can reach a full count while a blocked lane keeps the run live", () => {
    expect(
      deriveCompareProgress([lane("done"), lane("queued", true)]),
    ).toEqual({ done: 1, total: 1 });
  });
});
