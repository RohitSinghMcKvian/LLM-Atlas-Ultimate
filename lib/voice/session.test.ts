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

describe("confirming something that writes", () => {
  const listening = () => reduce(initVoice(), { kind: "start", now: 0 }, DEFAULT_VOICE).state;

  it("holds the floor open and remembers what is pending", () => {
    const r = reduce(
      listening(),
      { kind: "confirm_needed", name: "atlas_prompt", question: "Save that? Should I go ahead?", now: 0 },
      DEFAULT_VOICE,
    );
    expect(r.state.phase).toBe("confirming");
    expect(r.state.pending?.name).toBe("atlas_prompt");
    expect(micOpen(r.state)).toBe(true);
  });

  it("routes the next utterance as a reply rather than a question", () => {
    let state = reduce(
      listening(),
      { kind: "confirm_needed", name: "atlas_prompt", question: "q", now: 0 },
      DEFAULT_VOICE,
    ).state;
    const r = reduce(state, { kind: "transcribed", text: "yes" }, DEFAULT_VOICE);
    expect(r.action).toEqual({ kind: "confirm_reply", text: "yes" });
  });

  it("runs the pending action on approval and resumes working", () => {
    const state = reduce(
      listening(),
      { kind: "confirm_needed", name: "atlas_open", question: "q", now: 0 },
      DEFAULT_VOICE,
    ).state;
    const r = reduce(state, { kind: "confirmed", approved: true }, DEFAULT_VOICE);
    expect(r.action).toEqual({ kind: "run_pending", name: "atlas_open" });
    expect(r.state.phase).toBe("thinking");
    expect(r.state.pending).toBeUndefined();
  });

  it("drops it on refusal and hands the floor back", () => {
    const state = reduce(
      listening(),
      { kind: "confirm_needed", name: "atlas_open", question: "q", now: 0 },
      DEFAULT_VOICE,
    ).state;
    const r = reduce(state, { kind: "confirmed", approved: false }, DEFAULT_VOICE);
    expect(r.action).toEqual({ kind: "drop_pending", name: "atlas_open" });
    expect(r.state.phase).toBe("listening");
  });

  it("treats a timed-out confirmation as a refusal, never an approval", () => {
    // The safety property: someone who walked away must not come back to a
    // changed workspace.
    let state = reduce(
      listening(),
      { kind: "confirm_needed", name: "atlas_prompt", question: "q", now: 0 },
      DEFAULT_VOICE,
    ).state;
    let action: ReturnType<typeof reduce>["action"] = { kind: "none" };
    for (let t = 0; t <= DEFAULT_VOICE.openTimeoutMs + 100; t += 20) {
      const r = reduce(state, { kind: "frame", speaking: false, now: t }, DEFAULT_VOICE);
      state = r.state;
      action = r.action;
      if (action.kind !== "none") break;
    }
    expect(action).toEqual({ kind: "drop_pending", name: "atlas_prompt" });
    expect(state.pending).toBeUndefined();
  });

  it("ignores a confirmation reply when nothing is pending", () => {
    const r = reduce(listening(), { kind: "confirmed", approved: true }, DEFAULT_VOICE);
    expect(r.action).toEqual({ kind: "none" });
  });
});

describe("push to talk", () => {
  const listening = () => reduce(initVoice(), { kind: "start", now: 0 }, DEFAULT_VOICE).state;

  it("takes the floor from playback", () => {
    const speaking = reduce(listening(), { kind: "speaking" }, DEFAULT_VOICE).state;
    const r = reduce(speaking, { kind: "ptt_down", now: 100 }, DEFAULT_VOICE);
    expect(r.action).toEqual({ kind: "barge_in" });
    expect(r.state.phase).toBe("listening");
    expect(r.state.held).toBe(true);
  });

  it("does not close the turn on a pause while the key is held", () => {
    // The whole point of holding a key: a pause is a pause, not the end.
    let state = reduce(listening(), { kind: "ptt_down", now: 0 }, DEFAULT_VOICE).state;
    for (let t = 0; t < 5_000; t += 20) {
      const r = reduce(state, { kind: "frame", speaking: false, now: t, partial: "still thinking" }, DEFAULT_VOICE);
      state = r.state;
      expect(r.action.kind).toBe("none");
    }
    expect(state.phase).toBe("listening");
  });

  it("commits what was captured on release", () => {
    let state = reduce(listening(), { kind: "ptt_down", now: 0 }, DEFAULT_VOICE).state;
    state = reduce(state, { kind: "frame", speaking: true, now: 100, partial: "open compare" }, DEFAULT_VOICE).state;
    const r = reduce(state, { kind: "ptt_up", now: 900 }, DEFAULT_VOICE);
    expect(r.action).toEqual({ kind: "transcribe", audio: "captured" });
    expect(r.state.held).toBe(false);
  });

  it("reopens rather than asking an empty question on release", () => {
    const state = reduce(listening(), { kind: "ptt_down", now: 0 }, DEFAULT_VOICE).state;
    const r = reduce(state, { kind: "ptt_up", now: 500 }, DEFAULT_VOICE);
    expect(r.action.kind).toBe("reopen");
  });

  it("ignores a release that was never a press", () => {
    expect(reduce(listening(), { kind: "ptt_up", now: 10 }, DEFAULT_VOICE).action).toEqual({
      kind: "none",
    });
  });
});
