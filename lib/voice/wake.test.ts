import { describe, expect, it } from "vitest";
import { DEFAULT_WAKE, feedWake, initWake, resetWake } from "./wake";

describe("waking", () => {
  it("fires on a greeted form", () => {
    const r = feedWake(initWake(), "hey atlas", 1_000);
    expect(r.fired).toBe(true);
  });

  it("carries a command that rode along", () => {
    const r = feedWake(initWake(), "hey atlas open compare", 1_000);
    expect(r.fired).toBe(true);
    expect(r.rest).toBe("open compare");
  });

  it("strips the comma people actually say", () => {
    expect(feedWake(initWake(), "hey atlas, what does this cost", 1_000).rest).toBe(
      "what does this cost",
    );
  });

  it("wakes on a bare name only at the start", () => {
    expect(feedWake(initWake(), "atlas open cost", 1_000).fired).toBe(true);
    // The app is called Atlas; the word appears in ordinary sentences about it.
    expect(feedWake(initWake(), "the atlas catalog is out of date", 1_000).fired).toBe(false);
    expect(feedWake(initWake(), "ask atlas about this", 1_000).fired).toBe(false);
  });

  it("can have the bare form turned off entirely", () => {
    const cfg = { ...DEFAULT_WAKE, allowBare: false };
    expect(feedWake(initWake(), "atlas open cost", 1_000, cfg).fired).toBe(false);
    expect(feedWake(initWake(), "hey atlas open cost", 1_000, cfg).fired).toBe(true);
  });
});

describe("the growing transcript a recogniser actually produces", () => {
  it("fires exactly once as the utterance grows", () => {
    // A recogniser re-emits an interim result many times a second. Without this
    // property one greeting opens a dozen sessions.
    let state = initWake();
    let fires = 0;
    for (const t of ["hey", "hey atlas", "hey atlas open", "hey atlas open compare"]) {
      const r = feedWake(state, t, 1_000);
      state = r.state;
      if (r.fired) fires++;
    }
    expect(fires).toBe(1);
  });

  it("keeps reporting the command as the rest of it arrives", () => {
    let state = initWake();
    let rest = "";
    for (const t of ["hey atlas", "hey atlas open", "hey atlas open compare"]) {
      const r = feedWake(state, t, 1_000);
      state = r.state;
      rest = r.rest;
    }
    expect(rest).toBe("open compare");
  });

  it("holds a second greeting off inside the cooldown", () => {
    const first = feedWake(initWake(), "hey atlas", 1_000);
    const second = feedWake(resetWake(first.state), "hey atlas", 1_500);
    expect(second.fired).toBe(false);
  });

  it("wakes again once the cooldown has passed", () => {
    const first = feedWake(initWake(), "hey atlas", 1_000);
    const later = feedWake(resetWake(first.state), "hey atlas", 1_000 + DEFAULT_WAKE.cooldownMs);
    expect(later.fired).toBe(true);
  });

  it("clears its memory when the utterance is not a wake phrase at all", () => {
    const first = feedWake(initWake(), "hey atlas", 1_000);
    const other = feedWake(first.state, "something unrelated", 1_100);
    expect(other.state.consumed).toBe("");
  });
});

describe("nothing to hear", () => {
  it("does not fire on empty or whitespace", () => {
    expect(feedWake(initWake(), "", 1_000).fired).toBe(false);
    expect(feedWake(initWake(), "   ", 1_000).fired).toBe(false);
  });

  it("reports no command when only the phrase was said", () => {
    expect(feedWake(initWake(), "hello atlas", 1_000).rest).toBe("");
  });
});
