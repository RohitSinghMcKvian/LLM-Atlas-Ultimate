import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENDPOINT,
  initEndpoint,
  open,
  promisesMore,
  spokenMs,
  step,
  type EndpointAction,
  type EndpointState,
} from "./endpoint";

/** Drive a trace of {speaking, atMs} and return the first action that is not "none". */
function drive(
  frames: { speaking: boolean; atMs: number; partial?: string }[],
  startState: EndpointState = open(0),
): { action: EndpointAction; state: EndpointState; atMs: number } {
  let state = startState;
  for (const f of frames) {
    const r = step(state, { speaking: f.speaking, now: f.atMs, partial: f.partial });
    state = r.state;
    if (r.action.kind !== "none") return { action: r.action, state, atMs: f.atMs };
  }
  return { action: { kind: "none" }, state, atMs: frames.at(-1)?.atMs ?? 0 };
}

/** 50ms frames from `fromMs` to `toMs`. */
function frames(fromMs: number, toMs: number, speaking: boolean, partial?: string) {
  const out: { speaking: boolean; atMs: number; partial?: string }[] = [];
  for (let t = fromMs; t <= toMs; t += 50) out.push({ speaking, atMs: t, partial });
  return out;
}

describe("promisesMore", () => {
  it("holds the turn open after a word that trails", () => {
    expect(promisesMore("so the thing is")).toBe(true);
    expect(promisesMore("what about the")).toBe(true);
    expect(promisesMore("um")).toBe(true);
  });

  it("lets a finished sentence close", () => {
    expect(promisesMore("what does Summit Pro cost")).toBe(false);
    expect(promisesMore("compare them")).toBe(false);
  });

  it("respects punctuation the backend already committed to", () => {
    expect(promisesMore("so.")).toBe(false);
    expect(promisesMore("and?")).toBe(false);
  });

  it("handles nothing at all", () => {
    expect(promisesMore("")).toBe(false);
    expect(promisesMore("   ")).toBe(false);
    expect(promisesMore("123")).toBe(false);
  });
});

describe("step", () => {
  it("does nothing while closed", () => {
    const r = step(initEndpoint(), { speaking: true, now: 100 });
    expect(r.action.kind).toBe("none");
    expect(r.state.status).toBe("closed");
  });

  it("commits after a real utterance and enough silence", () => {
    const { action, atMs } = drive([
      ...frames(0, 900, true),
      ...frames(950, 2_000, false),
    ]);
    expect(action).toEqual({ kind: "commit", reason: "silence" });
    // ~600ms after speech stopped, not immediately.
    expect(atMs).toBeGreaterThanOrEqual(950 + DEFAULT_ENDPOINT.silenceMs);
    expect(atMs).toBeLessThan(950 + DEFAULT_ENDPOINT.silenceMs + 200);
  });

  it("waits longer when the words promise more", () => {
    const plain = drive([...frames(0, 900, true, "what is the cost"), ...frames(950, 3_000, false, "what is the cost")]);
    const trailing = drive([...frames(0, 900, true, "the cost of"), ...frames(950, 3_000, false, "the cost of")]);
    expect(plain.action.kind).toBe("commit");
    expect(trailing.action.kind).toBe("commit");
    expect(trailing.atMs).toBeGreaterThan(plain.atMs);
  });

  it("does not close on the pause between two clauses", () => {
    const { action } = drive([
      ...frames(0, 600, true),
      // 400ms of thinking - under the 600ms threshold.
      ...frames(650, 1_000, false),
      ...frames(1_050, 1_600, true),
      ...frames(1_650, 1_800, false),
    ]);
    expect(action.kind).toBe("none");
  });

  it("discards a cough rather than transcribing it", () => {
    const { action } = drive([
      ...frames(0, 100, true),
      ...frames(150, 1_500, false),
    ]);
    expect(action).toEqual({ kind: "cancel", reason: "too_short" });
  });

  it("gives up on a microphone nobody spoke into", () => {
    const { action } = drive(frames(0, 10_000, false));
    expect(action).toEqual({ kind: "cancel", reason: "timeout" });
  });

  it("closes an utterance that never ends", () => {
    const { action } = drive(frames(0, 65_000, true));
    expect(action).toEqual({ kind: "commit", reason: "max_length" });
  });

  it("tracks status through the turn", () => {
    let state = open(0);
    state = step(state, { speaking: false, now: 50 }).state;
    expect(state.status).toBe("waiting");
    state = step(state, { speaking: true, now: 100 }).state;
    expect(state.status).toBe("listening");
    state = step(state, { speaking: false, now: 200, partial: "and" }).state;
    expect(state.status).toBe("trailing");
  });

  it("reports how long the person actually spoke", () => {
    let state = open(0);
    state = step(state, { speaking: true, now: 100 }).state;
    expect(spokenMs(state, 600)).toBe(500);
    state = step(state, { speaking: false, now: 700 }).state;
    // Frozen once silence starts, so the UI does not keep counting.
    expect(spokenMs(state, 5_000)).toBe(600);
  });

  it("has nothing to report before anyone speaks", () => {
    expect(spokenMs(open(0), 1_000)).toBe(0);
  });
});

describe("a finalised transcript ends the turn sooner", () => {
  // `silenceMs` is a bet that more words may be coming. Once the engine has
  // committed a final result that bet is settled, and the rest of the wait is
  // dead air the person hears as the assistant being slow.
  const speak = (state: EndpointState, from: number, ms: number) => {
    let s = state;
    for (let t = from; t < from + ms; t += 20) {
      s = step(s, { speaking: true, now: t }).state;
    }
    return s;
  };

  /** Silence begins on the first silent frame, so the wait is measured from it. */
  const goQuiet = (
    state: EndpointState,
    from: number,
    ms: number,
    input: { partial: string; finalized?: boolean },
  ) => {
    let s = state;
    let last: ReturnType<typeof step> = { state: s, action: { kind: "none" } };
    for (let t = from; t <= from + ms; t += 20) {
      last = step(s, { speaking: false, now: t, ...input });
      s = last.state;
      if (last.action.kind !== "none") return last;
    }
    return last;
  };

  it("commits at the shorter silence when the words are already in", () => {
    const state = speak(open(0), 0, 600);
    const r = goQuiet(state, 600, DEFAULT_ENDPOINT.finalizedSilenceMs, {
      partial: "what does this cost",
      finalized: true,
    });
    expect(r.action).toEqual({ kind: "commit", reason: "silence" });
  });

  it("still waits the full silence when nothing has been finalised", () => {
    const state = speak(open(0), 0, 600);
    const r = goQuiet(state, 600, DEFAULT_ENDPOINT.finalizedSilenceMs, {
      partial: "what does this cost",
    });
    expect(r.action).toEqual({ kind: "none" });
  });

  it("never cuts off a trailing word, finalised or not", () => {
    const state = speak(open(0), 0, 600);
    const r = goQuiet(state, 600, DEFAULT_ENDPOINT.finalizedSilenceMs, {
      partial: "the cost of",
      finalized: true,
    });
    expect(r.action).toEqual({ kind: "none" });
  });

  it("is faster than the ordinary wait, which is the whole point", () => {
    expect(DEFAULT_ENDPOINT.finalizedSilenceMs).toBeLessThan(DEFAULT_ENDPOINT.silenceMs);
  });
});
