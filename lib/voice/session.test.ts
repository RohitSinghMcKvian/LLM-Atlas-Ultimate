import { describe, expect, it } from "vitest";
import {
  DEFAULT_VOICE,
  PHASE_LABELS,
  initVoice,
  micOpen,
  reduce,
  type VoiceAction,
  type VoiceEvent,
  type VoiceState,
} from "./session";

function run(events: VoiceEvent[], from: VoiceState = initVoice()) {
  let state = from;
  const actions: VoiceAction[] = [];
  for (const e of events) {
    const r = reduce(state, e);
    state = r.state;
    if (r.action.kind !== "none") actions.push(r.action);
  }
  return { state, actions };
}

function frames(fromMs: number, toMs: number, speaking: boolean, partial?: string): VoiceEvent[] {
  const out: VoiceEvent[] = [];
  for (let t = fromMs; t <= toMs; t += 50) out.push({ kind: "frame", speaking, now: t, partial });
  return out;
}

describe("the ordinary turn", () => {
  it("listens, transcribes, asks, speaks, and hands the floor back", () => {
    const { state, actions } = run([
      { kind: "start", now: 0 },
      ...frames(50, 900, true),
      ...frames(950, 2_000, false),
      { kind: "transcribed", text: "what does Summit Pro cost" },
      { kind: "speaking" },
      { kind: "spoken" },
    ]);

    expect(actions.map((a) => a.kind)).toEqual(["transcribe", "ask"]);
    expect(actions[1]).toMatchObject({ text: "what does Summit Pro cost" });
    // Back to listening with no button press - this is what makes it a
    // conversation rather than a series of dictations.
    expect(state.phase).toBe("listening");
  });

  it("keeps what was said for the transcript", () => {
    const { state } = run([
      { kind: "start", now: 0 },
      { kind: "transcribed", text: "compare them" },
    ]);
    expect(state.utterance).toBe("compare them");
    expect(state.phase).toBe("thinking");
  });
});

describe("barge-in", () => {
  it("stops playback once the user has really started talking", () => {
    const { state, actions } = run([
      { kind: "start", now: 0 },
      { kind: "transcribed", text: "go" },
      { kind: "speaking" },
      ...frames(100, 100 + 50 * DEFAULT_VOICE.bargeFrames, true),
    ]);
    expect(actions).toContainEqual({ kind: "barge_in" });
    expect(state.phase).toBe("listening");
  });

  it("is not triggered by a single frame - echo and coughs are not interruptions", () => {
    const { state, actions } = run([
      { kind: "start", now: 0 },
      { kind: "transcribed", text: "go" },
      { kind: "speaking" },
      { kind: "frame", speaking: true, now: 100 },
      { kind: "frame", speaking: false, now: 150 },
    ]);
    expect(actions.some((a) => a.kind === "barge_in")).toBe(false);
    expect(state.phase).toBe("speaking");
  });

  it("resets its count when the room goes quiet again", () => {
    let state = run([
      { kind: "start", now: 0 },
      { kind: "transcribed", text: "go" },
      { kind: "speaking" },
      { kind: "frame", speaking: true, now: 100 },
      { kind: "frame", speaking: true, now: 150 },
      { kind: "frame", speaking: false, now: 200 },
    ]).state;
    expect(state.bargeFrames).toBe(0);
    // One more frame must not immediately trip it.
    state = reduce(state, { kind: "frame", speaking: true, now: 250 }).state;
    expect(state.phase).toBe("speaking");
  });

  it("interrupts while the agent is still thinking, not only while speaking", () => {
    const { actions } = run([
      { kind: "start", now: 0 },
      { kind: "transcribed", text: "go" },
      ...frames(100, 100 + 50 * DEFAULT_VOICE.bargeFrames, true),
    ]);
    expect(actions).toContainEqual({ kind: "barge_in" });
  });
});

describe("nothing worth sending", () => {
  it("reopens after a cough instead of transcribing it", () => {
    const { state, actions } = run([
      { kind: "start", now: 0 },
      ...frames(50, 100, true),
      ...frames(150, 1_500, false),
    ]);
    expect(actions[0]).toMatchObject({ kind: "reopen" });
    expect(state.phase).toBe("listening");
  });

  it("reopens when the transcriber heard nothing, rather than asking an empty question", () => {
    const { state, actions } = run([
      { kind: "start", now: 0 },
      { kind: "transcribed", text: "   " },
    ]);
    expect(actions).toContainEqual({ kind: "reopen", reason: "nothing was heard" });
    expect(state.phase).toBe("listening");
    expect(actions.some((a) => a.kind === "ask")).toBe(false);
  });

  it("reopens after nobody spoke at all", () => {
    const { actions } = run([{ kind: "start", now: 0 }, ...frames(50, 10_000, false)]);
    expect(actions[0]).toMatchObject({ kind: "reopen", reason: "no one spoke" });
  });
});

describe("stopping", () => {
  it("closes on request", () => {
    const { state, actions } = run([{ kind: "start", now: 0 }, { kind: "stop" }]);
    expect(state.phase).toBe("idle");
    expect(actions).toContainEqual({ kind: "close", reason: "stopped" });
  });

  it("closes on an error and keeps the reason to show", () => {
    const { state } = run([
      { kind: "start", now: 0 },
      { kind: "error", message: "Microphone permission was declined." },
    ]);
    expect(state.phase).toBe("idle");
    expect(state.note).toContain("permission");
  });

  it("ignores frames while idle", () => {
    const { actions } = run(frames(0, 5_000, true));
    expect(actions).toEqual([]);
  });
});

describe("micOpen / labels", () => {
  it("keeps the microphone open during playback, which is what allows barge-in", () => {
    expect(micOpen({ ...initVoice(), phase: "speaking" })).toBe(true);
    expect(micOpen({ ...initVoice(), phase: "thinking" })).toBe(true);
    expect(micOpen(initVoice())).toBe(false);
  });

  it("labels every phase in plain words", () => {
    for (const label of Object.values(PHASE_LABELS)) {
      expect(label.length).toBeGreaterThan(3);
      expect(label).not.toMatch(/[_-]/);
    }
  });
});
