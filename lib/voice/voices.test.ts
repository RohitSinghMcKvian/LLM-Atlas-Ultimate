import { describe, expect, it } from "vitest";
import {
  DEFAULT_RATE,
  KEEPALIVE_MS,
  MAX_RATE,
  MIN_RATE,
  bestVoice,
  clampRate,
  nudgeRate,
  rankVoices,
  scoreVoice,
  type VoiceLike,
} from "./voices";

const v = (name: string, lang: string, localService = true, extra: Partial<VoiceLike> = {}): VoiceLike => ({
  name,
  lang,
  localService,
  ...extra,
});

/** A realistic Windows + Chrome list: the case this module exists for. */
const WINDOWS_CHROME = [
  v("Microsoft David - English (United States)", "en-US"),
  v("Microsoft Zira - English (United States)", "en-US"),
  v("Google US English", "en-US", false),
  v("Microsoft Mark - English (United States)", "en-US"),
];

describe("scoreVoice", () => {
  it("ranks a modern engine above the platform default", () => {
    const google = scoreVoice(v("Google US English", "en-US", false), "en-US");
    const david = scoreVoice(v("Microsoft David - English (United States)", "en-US"), "en-US");
    expect(google).toBeGreaterThan(david);
  });

  it("prefers an exact language tag over the same primary language", () => {
    expect(scoreVoice(v("Google UK English Female", "en-GB"), "en-GB")).toBeGreaterThan(
      scoreVoice(v("Google UK English Female", "en-US"), "en-GB"),
    );
  });

  it("pushes a wrong-language voice well below any right-language one", () => {
    expect(scoreVoice(v("Google Deutsch", "de-DE"), "en-US")).toBeLessThan(
      scoreVoice(v("Microsoft David - English (United States)", "en-US"), "en-US"),
    );
  });

  it("scores a neural voice highest of all", () => {
    const natural = scoreVoice(v("Microsoft Aria Online (Natural) - English", "en-US"), "en-US");
    for (const other of WINDOWS_CHROME) {
      expect(natural).toBeGreaterThan(scoreVoice(other, "en-US"));
    }
  });
});

describe("rankVoices", () => {
  it("puts Google US English ahead of David on the list this module exists for", () => {
    expect(rankVoices(WINDOWS_CHROME, "en-US")[0].name).toBe("Google US English");
  });

  it("is stable for equally scored voices", () => {
    const a = v("Alpha", "en-US");
    const b = v("Beta", "en-US");
    expect(rankVoices([a, b], "en-US").map((x) => x.name)).toEqual(["Alpha", "Beta"]);
  });

  it("returns everything it was given", () => {
    expect(rankVoices(WINDOWS_CHROME, "en-US")).toHaveLength(WINDOWS_CHROME.length);
  });
});

describe("bestVoice", () => {
  it("honours a stored choice over its own ranking", () => {
    const chosen = bestVoice(WINDOWS_CHROME, "en-US", "Microsoft Zira - English (United States)");
    expect(chosen?.name).toBe("Microsoft Zira - English (United States)");
  });

  it("falls back to the ranking when the stored voice is gone", () => {
    expect(bestVoice(WINDOWS_CHROME, "en-US", "A Voice That Was Uninstalled")?.name).toBe(
      "Google US English",
    );
  });

  it("matches a stored choice by voiceURI when there is one", () => {
    const list = [v("One", "en-US", true, { voiceURI: "uri-one" }), v("Two", "en-US", true, { voiceURI: "uri-two" })];
    expect(bestVoice(list, "en-US", "uri-two")?.name).toBe("Two");
  });

  it("is null with nothing installed", () => {
    expect(bestVoice([], "en-US")).toBeNull();
  });
});

describe("rate", () => {
  it("clamps to a range that stays intelligible", () => {
    expect(clampRate(5)).toBe(MAX_RATE);
    expect(clampRate(0.1)).toBe(MIN_RATE);
    expect(clampRate(Number.NaN)).toBe(DEFAULT_RATE);
  });

  it("steps up and down without escaping the range", () => {
    let rate = DEFAULT_RATE;
    for (let i = 0; i < 20; i++) rate = nudgeRate(rate, "faster");
    expect(rate).toBe(MAX_RATE);
    for (let i = 0; i < 40; i++) rate = nudgeRate(rate, "slower");
    expect(rate).toBe(MIN_RATE);
  });
});

describe("keepalive", () => {
  it("fires comfortably before Chrome's ~15s cutoff", () => {
    expect(KEEPALIVE_MS).toBeLessThan(14_000);
  });
});
