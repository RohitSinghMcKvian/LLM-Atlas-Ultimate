import { describe, it, expect } from "vitest";
import {
  BUILD_LIMITS,
  BuildBudget,
  CHAT_LIMITS,
  GENERATION_SLOWDOWN,
  limitsFor,
  MAX_TURN_MS,
  maxMsFor,
} from "./build-budget";
import { DEFAULT_OUTPUT_BUDGET, MAX_OUTPUT_BUDGET, outputBudget } from "./continuation";

/** A controllable clock, so the wall-clock cap is tested without waiting. */
function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("limitsFor", () => {
  // The regression that matters: an ordinary conversation must be unchanged.
  it("gives ordinary chat exactly the previous constants", () => {
    const l = limitsFor(false);
    expect(l.maxRounds).toBe(4);
    expect(l.maxContinuations).toBe(3);
    expect(l.outputCeiling).toBe(MAX_OUTPUT_BUDGET);
  });

  it("raises rounds, continuations and output in build mode", () => {
    const l = limitsFor(true);
    expect(l.maxRounds).toBeGreaterThan(CHAT_LIMITS.maxRounds);
    expect(l.maxContinuations).toBeGreaterThan(CHAT_LIMITS.maxContinuations);
    expect(l.outputCeiling).toBeGreaterThan(CHAT_LIMITS.outputCeiling);
  });

  it("accepts overrides, so a user-set spend ceiling wins", () => {
    expect(limitsFor(true, { maxUsd: 0.5 }).maxUsd).toBe(0.5);
  });

  // No-progress halting only makes sense where there is a build to make progress
  // on; in plain chat a round that only searches is perfectly normal.
  it("does not halt ordinary chat for lack of progress", () => {
    const b = new BuildBudget(limitsFor(false));
    // Every round short of the cap, so the assertion is about progress rather
    // than about running out of rounds.
    for (let i = 0; i < CHAT_LIMITS.maxRounds - 1; i++) b.completeRound("barren");
    expect(b.stopReason()).toBeNull();
  });
});

describe("round cap", () => {
  it("stops after the configured number of rounds", () => {
    const b = new BuildBudget({ ...BUILD_LIMITS, maxRounds: 3 });
    b.completeRound("productive");
    b.completeRound("productive");
    expect(b.stopReason()).toBeNull();
    b.completeRound("productive");
    expect(b.stopReason()).toBe("rounds");
    expect(b.describeStop()).toContain("3 tool rounds");
  });

  it("says the work is saved, because it is", () => {
    const b = new BuildBudget({ ...BUILD_LIMITS, maxRounds: 1 });
    b.completeRound("productive");
    expect(b.describeStop()).toContain("workspace and plan are saved");
  });

  // The UI has to offer a different control per reason — a round cap gets a
  // Continue button, a cost ceiling gets a settings link — so the machine-
  // readable reason travels with the prose rather than being re-derived.
  it("returns the reason alongside the message", () => {
    const b = new BuildBudget({ ...BUILD_LIMITS, maxRounds: 1 });
    expect(b.stop()).toBeNull();
    b.completeRound("productive");
    expect(b.stop()).toEqual({ reason: "rounds", message: expect.stringContaining("continue") });
  });
});

describe("cost ceiling", () => {
  it("stops once real spend reaches the ceiling", () => {
    const b = new BuildBudget({ ...BUILD_LIMITS, maxUsd: 0.5 });
    b.chargeUsd(0.2);
    b.chargeUsd(0.2);
    expect(b.stopReason()).toBeNull();
    b.chargeUsd(0.2);
    expect(b.stopReason()).toBe("cost");
    expect(b.describeStop()).toContain("$0.50");
  });

  it("accumulates and ignores nonsense charges", () => {
    const b = new BuildBudget(BUILD_LIMITS);
    b.chargeUsd(0.1);
    b.chargeUsd(-5);
    b.chargeUsd(0);
    expect(b.spentUsd).toBeCloseTo(0.1);
  });
});

describe("wall clock", () => {
  it("stops at the time limit", () => {
    const c = clock();
    const b = new BuildBudget({ ...BUILD_LIMITS, maxMs: 1000 }, c.now);
    c.advance(999);
    expect(b.stopReason()).toBeNull();
    c.advance(1);
    expect(b.stopReason()).toBe("time");
  });
});

/**
 * The guard the round counter cannot provide.
 *
 * A cap of 20 says nothing about whether the build is advancing. But "advancing"
 * used to mean "wrote a file", which made every search, repository read and
 * connector call count as failure — so two rounds of research halted the build
 * with "no file written". Research-then-build is the normal shape of an
 * end-to-end task, so the guard fired on exactly the runs it existed to protect.
 *
 * Two counters now. `informative` keeps a researching run alive; only a run that
 * genuinely produced nothing, or read for six straight rounds, is stopped.
 */
describe("no-progress halt", () => {
  it("stops after enough rounds that produced nothing", () => {
    const b = new BuildBudget(BUILD_LIMITS);
    for (let i = 1; i < BUILD_LIMITS.maxBarrenRounds; i++) {
      b.completeRound("barren");
      expect(b.stopReason()).toBeNull();
    }
    b.completeRound("barren");
    expect(b.stopReason()).toBe("no-progress");
  });

  // THE regression test for this phase. Research is not failure.
  it("does not halt a run that is gathering information", () => {
    const b = new BuildBudget(BUILD_LIMITS);
    b.completeRound("informative");
    b.completeRound("informative");
    b.completeRound("informative");
    expect(b.stopReason()).toBeNull();
    expect(b.barrenRounds).toBe(0);
  });

  it("resets the barren count when a round produces something", () => {
    const b = new BuildBudget(BUILD_LIMITS);
    b.completeRound("barren");
    b.completeRound("productive");
    b.completeRound("barren");
    expect(b.stopReason()).toBeNull();
    expect(b.barrenRounds).toBe(1);
  });

  // Reading is progress, but only for so long. A run that has gathered context
  // for six straight rounds and written nothing is avoiding the work.
  it("still stops a run that only ever reads", () => {
    const b = new BuildBudget(BUILD_LIMITS);
    for (let i = 0; i < BUILD_LIMITS.maxUnproductiveRounds; i++) b.completeRound("informative");
    expect(b.stopReason()).toBe("stalled");
    expect(b.describeStop()).toContain("no file written");
  });

  it("only a write resets the unproductive counter", () => {
    const b = new BuildBudget(BUILD_LIMITS);
    b.completeRound("informative");
    b.completeRound("informative");
    expect(b.unproductiveRounds).toBe(2);
    b.completeRound("productive");
    expect(b.unproductiveRounds).toBe(0);
  });

  it("explains what to do instead of just stopping", () => {
    const b = new BuildBudget(BUILD_LIMITS);
    for (let i = 0; i < BUILD_LIMITS.maxBarrenRounds; i++) b.completeRound("barren");
    expect(b.describeStop()).toContain("repeated an earlier one");
  });
});

/**
 * A model alternating between two calls it has already made never produces a
 * consecutive repeat, so no per-round counter can catch it. Repetition is a
 * property of the whole turn.
 */
describe("loop detection", () => {
  it("stops once one call has been made three times", () => {
    const b = new BuildBudget(BUILD_LIMITS);
    b.noteCalls(['workspace:{"command":"view"}']);
    b.completeRound("informative");
    b.noteCalls(['workspace:{"command":"view"}']);
    b.completeRound("informative");
    expect(b.stopReason()).toBeNull();
    b.noteCalls(['workspace:{"command":"view"}']);
    expect(b.stopReason()).toBe("looping");
    expect(b.describeStop()).toContain("repeated three times");
  });

  it("catches an alternating pair, which no consecutive counter would", () => {
    const b = new BuildBudget(BUILD_LIMITS);
    for (let i = 0; i < 3; i++) {
      b.noteCalls(["a:{}", "b:{}"]);
      b.completeRound("informative");
    }
    expect(b.stopReason()).toBe("looping");
  });

  it("does not fire on distinct calls", () => {
    const b = new BuildBudget(BUILD_LIMITS);
    for (let i = 0; i < 6; i++) {
      b.noteCalls([`workspace:{"path":"f${i}"}`]);
      b.completeRound("productive");
    }
    expect(b.stopReason()).toBeNull();
  });
});

describe("precedence", () => {
  // Rounds is checked first so the message names the cap the user can reason
  // about, rather than whichever limit happened to trip in the same round.
  it("reports the round cap when several are exhausted at once", () => {
    const c = clock();
    const b = new BuildBudget({ ...BUILD_LIMITS, maxRounds: 1, maxMs: 10, maxUsd: 0.01 }, c.now);
    b.completeRound("productive");
    c.advance(100);
    b.chargeUsd(1);
    expect(b.stopReason()).toBe("rounds");
  });

  // A loop outranks "nothing happened": naming the repeated call is advice the
  // user can act on, where "no progress" is only a description.
  it("prefers the loop diagnosis over the barren one", () => {
    const b = new BuildBudget(BUILD_LIMITS);
    for (let i = 0; i < BUILD_LIMITS.maxBarrenRounds; i++) {
      b.noteCalls(["same:{}"]);
      b.completeRound("barren");
    }
    expect(b.stopReason()).toBe("looping");
  });

  it("is not exhausted before anything happens", () => {
    expect(new BuildBudget(BUILD_LIMITS).exhausted).toBe(false);
    expect(new BuildBudget(BUILD_LIMITS).stop()).toBeNull();
  });
});

describe("outputBudget with a ceiling", () => {
  it("keeps its previous behaviour when no ceiling is given", () => {
    expect(outputBudget(undefined)).toBe(DEFAULT_OUTPUT_BUDGET);
    expect(outputBudget(200_000)).toBe(MAX_OUTPUT_BUDGET);
    expect(outputBudget(4096)).toBe(4096);
  });

  it("lets build mode ask for more, bounded by the model", () => {
    expect(outputBudget(200_000, BUILD_LIMITS.outputCeiling)).toBe(BUILD_LIMITS.outputCeiling);
    expect(outputBudget(20_000, BUILD_LIMITS.outputCeiling)).toBe(20_000);
  });

  // A model with no declared maxOutput must not be handed the build ceiling on
  // the strength of a ceiling that describes the app, not the model.
  it("does not inflate the default past the ceiling", () => {
    expect(outputBudget(undefined, 4096)).toBe(4096);
    expect(outputBudget(undefined, BUILD_LIMITS.outputCeiling)).toBe(DEFAULT_OUTPUT_BUDGET);
  });
});

/**
 * The clock has to know how fast the model is.
 *
 * Measured end to end against `nvidia/nemotron-3-ultra-550b-a55b`: 57 s to first
 * byte, then 16,384 output tokens in 496 s — 554 s for a single round. That is
 * longer than `CHAT_LIMITS.maxMs` in its entirety and 62% of a whole build turn,
 * so the wall clock, not the round cap and not the budget, became the thing that
 * ended a turn which was working.
 */
describe("maxMsFor", () => {
  /** The catalog record for the model the measurements above came from. */
  const ULTRA = { throughputTps: 70, latencyMs: 1600 };
  const FAST = { throughputTps: 400, latencyMs: 250 };

  it("gives a slow model time to finish one full-length answer", () => {
    const ms = maxMsFor(ULTRA, BUILD_LIMITS);
    // One 32k answer at the measured rate is ~16 minutes on its own.
    expect(ms).toBeGreaterThan((BUILD_LIMITS.outputCeiling / ULTRA.throughputTps) * 1000);
    expect(ms).toBeGreaterThan(BUILD_LIMITS.maxMs);
  });

  it("lets an ordinary chat turn outlive one answer from a 550B model", () => {
    // The measured 554 s round did not fit in the 5-minute chat allowance at all.
    expect(maxMsFor(ULTRA, CHAT_LIMITS)).toBeGreaterThan(554_000);
  });

  it("never gives any model less time than it has today", () => {
    for (const m of [ULTRA, FAST, { throughputTps: 5_000, latencyMs: 10 }]) {
      expect(maxMsFor(m, CHAT_LIMITS)).toBeGreaterThanOrEqual(CHAT_LIMITS.maxMs);
      expect(maxMsFor(m, BUILD_LIMITS)).toBeGreaterThanOrEqual(BUILD_LIMITS.maxMs);
    }
  });

  it("leaves a fast model on the constants it was tuned for", () => {
    expect(maxMsFor({ throughputTps: 5_000, latencyMs: 10 }, CHAT_LIMITS)).toBe(CHAT_LIMITS.maxMs);
  });

  it("falls back to the constant when the catalog says nothing", () => {
    expect(maxMsFor(null, BUILD_LIMITS)).toBe(BUILD_LIMITS.maxMs);
    expect(maxMsFor({}, BUILD_LIMITS)).toBe(BUILD_LIMITS.maxMs);
    expect(maxMsFor({ throughputTps: 0 }, BUILD_LIMITS)).toBe(BUILD_LIMITS.maxMs);
  });

  // "Wait longer" stops being the right answer somewhere, and the user should be
  // told the model is wrong for the task rather than left watching a spinner.
  it("is bounded however slow the model claims to be", () => {
    expect(maxMsFor({ throughputTps: 0.01, latencyMs: 5_000 }, BUILD_LIMITS)).toBe(MAX_TURN_MS);
  });

  // The catalog's throughput is a vendor best case: 70 advertised against 33
  // measured. A budget derived from it without margin stops a turn that was
  // about to succeed.
  it("allows for the catalog being optimistic", () => {
    const generous = maxMsFor(ULTRA, CHAT_LIMITS);
    const naive = (CHAT_LIMITS.outputCeiling / ULTRA.throughputTps) * 1000;
    expect(generous).toBeGreaterThan(naive * GENERATION_SLOWDOWN);
  });
});
