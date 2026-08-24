import { describe, expect, it } from "vitest";
import {
  DEFAULT_VAD,
  frameEnergy,
  initVad,
  levelOf,
  processBuffer,
  processFrame,
  zeroCrossingRate,
} from "./vad";

const RATE = 16_000;

/** A voiced-sounding tone: low ZCR, real energy. */
function tone(ms: number, amplitude = 0.3, hz = 180): number[] {
  const n = Math.round((ms / 1000) * RATE);
  return Array.from({ length: n }, (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / RATE));
}

/** Room tone: very quiet broadband noise. */
function quiet(ms: number, amplitude = 0.0004): number[] {
  const n = Math.round((ms / 1000) * RATE);
  // Deterministic pseudo-noise, so a flaky test cannot hide here.
  return Array.from({ length: n }, (_, i) => amplitude * Math.sin(i * 12.9898) * (i % 7 === 0 ? -1 : 1));
}

/** Loud broadband hiss: speech-like energy, non-speech ZCR. */
function hiss(ms: number, amplitude = 0.35): number[] {
  const n = Math.round((ms / 1000) * RATE);
  return Array.from({ length: n }, (_, i) => amplitude * (i % 2 === 0 ? 1 : -1));
}

describe("frame maths", () => {
  it("energy is RMS", () => {
    expect(frameEnergy([1, -1, 1, -1])).toBeCloseTo(1, 6);
    expect(frameEnergy([0, 0, 0])).toBe(0);
    expect(frameEnergy([])).toBe(0);
  });

  it("zero-crossing rate counts sign changes", () => {
    expect(zeroCrossingRate([1, -1, 1, -1])).toBeCloseTo(1, 6);
    expect(zeroCrossingRate([1, 1, 1, 1])).toBe(0);
    expect(zeroCrossingRate([1])).toBe(0);
  });
});

describe("processBuffer", () => {
  it("finds one utterance in silence-speech-silence", () => {
    const { events } = processBuffer([...quiet(400), ...tone(700), ...quiet(600)]);
    expect(events.map((e) => e.event)).toEqual(["speech_start", "speech_end"]);
    expect(events[0].atMs).toBeGreaterThan(300);
    expect(events[0].atMs).toBeLessThan(600);
  });

  it("does not end the turn on the gap between two words", () => {
    // 60ms of quiet is shorter than the 120ms hangover.
    const { events } = processBuffer([
      ...quiet(400),
      ...tone(300),
      ...quiet(60),
      ...tone(300),
      ...quiet(600),
    ]);
    expect(events.map((e) => e.event)).toEqual(["speech_start", "speech_end"]);
  });

  it("finds two utterances when the gap is a real pause", () => {
    const { events } = processBuffer([
      ...quiet(400),
      ...tone(300),
      ...quiet(500),
      ...tone(300),
      ...quiet(600),
    ]);
    expect(events.map((e) => e.event)).toEqual([
      "speech_start",
      "speech_end",
      "speech_start",
      "speech_end",
    ]);
  });

  it("hears nothing in an empty room", () => {
    expect(processBuffer(quiet(3_000)).events).toEqual([]);
  });

  it("rejects loud broadband noise that is not voice", () => {
    // Same energy as speech, ZCR at the ceiling: a fan, not a person.
    expect(processBuffer([...quiet(400), ...hiss(800), ...quiet(400)]).events).toEqual([]);
  });

  it("ignores a click too short to be a word", () => {
    expect(processBuffer([...quiet(400), ...tone(20), ...quiet(400)]).events).toEqual([]);
  });

  it("keeps hearing through a long utterance instead of going deaf", () => {
    // The regression this pins: adapting the noise floor during speech makes the
    // floor climb to meet the voice, and the detector stops mid-sentence.
    const { events } = processBuffer([...quiet(400), ...tone(6_000), ...quiet(600)]);
    expect(events.map((e) => e.event)).toEqual(["speech_start", "speech_end"]);
  });

  it("adapts to a noisier room rather than triggering constantly", () => {
    const loudRoom = quiet(4_000, 0.004);
    expect(processBuffer(loudRoom).events).toEqual([]);
  });
});

describe("processFrame", () => {
  it("returns a new state rather than mutating", () => {
    const before = initVad();
    const after = processFrame(before, tone(20)).state;
    expect(before.energy).toBe(0);
    expect(after).not.toBe(before);
  });

  it("seeds the floor above zero, so the first frame is not a false start", () => {
    expect(initVad().noiseFloor).toBeGreaterThan(0);
    const { event } = processFrame(initVad(), quiet(20));
    expect(event).toBeNull();
  });

  it("counts frames of an utterance in progress", () => {
    let state = initVad();
    for (const chunk of [quiet(400), tone(200)]) {
      const frames = Math.floor(chunk.length / ((DEFAULT_VAD.frameMs / 1000) * RATE));
      for (let f = 0; f < frames; f++) {
        const size = (DEFAULT_VAD.frameMs / 1000) * RATE;
        state = processFrame(state, chunk.slice(f * size, (f + 1) * size)).state;
      }
    }
    expect(state.speaking).toBe(true);
    expect(state.speechFrames).toBeGreaterThan(0);
  });
});

describe("levelOf", () => {
  it("reads zero in silence and rises with loudness", () => {
    const silent = processFrame(initVad(), quiet(20)).state;
    expect(levelOf(silent)).toBe(0);

    let loud = initVad();
    for (let i = 0; i < 10; i++) loud = processFrame(loud, tone(20)).state;
    expect(levelOf(loud)).toBeGreaterThan(0.3);
  });

  it("never leaves 0..1, however loud the input", () => {
    let clipped = initVad();
    for (let i = 0; i < 10; i++) clipped = processFrame(clipped, tone(20, 1)).state;
    const level = levelOf(clipped);
    expect(level).toBeGreaterThanOrEqual(0);
    expect(level).toBeLessThanOrEqual(1);
  });
});
