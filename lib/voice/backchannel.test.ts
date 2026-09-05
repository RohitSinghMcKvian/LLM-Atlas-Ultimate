import { describe, expect, it } from "vitest";
import {
  BACKCHANNEL_AFTER_MS,
  LOOKUP_PHRASES,
  RECENT_MEMORY,
  THINKING_PHRASES,
  initBackchannel,
  pickBackchannel,
  shouldBackchannel,
} from "./backchannel";

describe("shouldBackchannel", () => {
  it("stays quiet while the answer is still plausibly imminent", () => {
    expect(shouldBackchannel(BACKCHANNEL_AFTER_MS - 1, false)).toBe(false);
  });

  it("fires once the wait is long enough to read as a stall", () => {
    expect(shouldBackchannel(BACKCHANNEL_AFTER_MS, false)).toBe(true);
  });

  it("never fires once the answer has started", () => {
    // An acknowledgement queued behind the answer arrives after it, which is
    // worse than never having said anything.
    expect(shouldBackchannel(10_000, true)).toBe(false);
  });
});

describe("pickBackchannel", () => {
  it("never repeats the phrase it just used", () => {
    let state = initBackchannel();
    const said: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = pickBackchannel(state, { random: () => 0 });
      state = r.state;
      if (r.phrase) said.push(r.phrase);
    }
    for (let i = 1; i < said.length; i++) expect(said[i]).not.toBe(said[i - 1]);
  });

  it("remembers exactly the configured depth", () => {
    let state = initBackchannel();
    for (let i = 0; i < 5; i++) state = pickBackchannel(state, { random: () => 0 }).state;
    expect(state.recent.length).toBeLessThanOrEqual(RECENT_MEMORY);
  });

  it("says nothing rather than repeating when the pool is exhausted", () => {
    const state = { recent: [...THINKING_PHRASES] };
    expect(pickBackchannel(state).phrase).toBeNull();
  });

  it("uses the lookup pool when the turn is reaching for data", () => {
    const r = pickBackchannel(initBackchannel(), { lookup: true, random: () => 0 });
    expect(LOOKUP_PHRASES).toContain(r.phrase);
  });

  it("stays inside the pool for any random value", () => {
    // `Math.random()` can return values arbitrarily close to 1; an index built
    // from it must not run off the end.
    for (const random of [() => 0, () => 0.999999, () => 0.5]) {
      const r = pickBackchannel(initBackchannel(), { random });
      expect(THINKING_PHRASES).toContain(r.phrase);
    }
  });

  it("keeps every phrase short enough to be spoken over a stall", () => {
    for (const p of [...THINKING_PHRASES, ...LOOKUP_PHRASES]) {
      expect(p.length).toBeLessThan(30);
    }
  });
});
