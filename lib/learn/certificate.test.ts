import { describe, it, expect } from "vitest";
import {
  buildTranscript,
  hash32,
  mintCredential,
  verifyCredential,
} from "./certificate";
import { EMPTY_PROGRESS, type ProgressState } from "./progress";
import { TRACKS } from "./curriculum";
import type { Track } from "./types";

// The credential's whole value is that it is reproducible: the same work must
// mint the same id on any device, and a mistyped id must fail verification.

const T: Track = {
  id: "t",
  title: "Track",
  blurb: "",
  level: "beginner",
  accent: "cyan",
  lessons: [
    {
      id: "l1",
      trackId: "t",
      title: "One",
      summary: "",
      minutes: 10,
      difficulty: "beginner",
      objectives: [],
      blocks: [
        {
          type: "exercise",
          id: "e1",
          title: "",
          brief: "",
          rubric: [{ id: "r", label: "R", descriptor: "", weight: 1 }],
        },
      ],
    },
    {
      id: "l2",
      trackId: "t",
      title: "Two",
      summary: "",
      minutes: 20,
      difficulty: "beginner",
      objectives: [],
      blocks: [],
    },
  ],
};

const STATE: ProgressState = {
  ...EMPTY_PROGRESS,
  completedLessons: { l1: "2026-07-26T00:00:00.000Z", l2: "2026-07-26T00:00:00.000Z" },
  exercises: {
    e1: {
      percent: 91.4,
      letter: "A-",
      gradePoints: 3.7,
      attempts: 1,
      xp: 109,
      gradedAt: "",
    },
  },
  xp: 420,
  lastActiveDay: "2026-07-26",
};

describe("hash32", () => {
  it("is deterministic", () => {
    expect(hash32("atlas")).toBe(hash32("atlas"));
  });

  it("separates similar inputs", () => {
    expect(hash32("atlas")).not.toBe(hash32("atlaz"));
  });

  it("stays inside 32 bits", () => {
    for (const s of ["", "a", "the quick brown fox", "🛰️".repeat(50)]) {
      const h = hash32(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe("buildTranscript", () => {
  it("counts only completed lessons toward time studied", () => {
    const partial = { ...STATE, completedLessons: { l1: "x" } };
    expect(buildTranscript([T], partial).totalMinutes).toBe(10);
    expect(buildTranscript([T], STATE).totalMinutes).toBe(30);
  });

  it("reports a track's letter from its practicals", () => {
    expect(buildTranscript([T], STATE).rows[0].grade).toBe("A-");
  });

  it("shows an em dash for a track with no graded work", () => {
    const noGrades = { ...STATE, exercises: {} };
    expect(buildTranscript([T], noGrades).rows[0].grade).toBe("—");
    expect(buildTranscript([T], noGrades).overallLetter).toBe("—");
  });

  it("covers every real track", () => {
    expect(buildTranscript(TRACKS, EMPTY_PROGRESS).rows).toHaveLength(TRACKS.length);
  });
});

describe("mintCredential", () => {
  it("is stable for the same learner and the same work", () => {
    const a = mintCredential({ learner: "Ada", tracks: [T], state: STATE });
    const b = mintCredential({ learner: "Ada", tracks: [T], state: STATE });
    expect(a.id).toBe(b.id);
  });

  it("ignores name casing and surrounding whitespace", () => {
    const a = mintCredential({ learner: "Ada", tracks: [T], state: STATE });
    const b = mintCredential({ learner: "  ADA ", tracks: [T], state: STATE });
    expect(a.id).toBe(b.id);
  });

  it("ignores the insertion order of completions and grades", () => {
    const reordered: ProgressState = {
      ...STATE,
      completedLessons: { l2: STATE.completedLessons.l2, l1: STATE.completedLessons.l1 },
    };
    expect(mintCredential({ learner: "Ada", tracks: [T], state: STATE }).id).toBe(
      mintCredential({ learner: "Ada", tracks: [T], state: reordered }).id,
    );
  });

  it("ignores sub-percent grade differences", () => {
    // 91.4 and 91.44 are the same grade to a reader; they must be the same
    // credential, or two devices would disagree.
    const nudged: ProgressState = {
      ...STATE,
      exercises: { e1: { ...STATE.exercises.e1, percent: 91.44 } },
    };
    expect(mintCredential({ learner: "Ada", tracks: [T], state: STATE }).id).toBe(
      mintCredential({ learner: "Ada", tracks: [T], state: nudged }).id,
    );
  });

  it("changes when the learner changes", () => {
    expect(mintCredential({ learner: "Ada", tracks: [T], state: STATE }).id).not.toBe(
      mintCredential({ learner: "Grace", tracks: [T], state: STATE }).id,
    );
  });

  it("changes when the work changes", () => {
    const better: ProgressState = {
      ...STATE,
      exercises: { e1: { ...STATE.exercises.e1, percent: 99 } },
    };
    expect(mintCredential({ learner: "Ada", tracks: [T], state: STATE }).id).not.toBe(
      mintCredential({ learner: "Ada", tracks: [T], state: better }).id,
    );
  });

  it("formats the id predictably", () => {
    const c = mintCredential({ learner: "Ada", tracks: [T], state: STATE });
    expect(c.id).toMatch(/^ATLAS-LLM-[0-9A-Z]{1,6}-[0-9A-Z]{2}$/);
  });
});

describe("verifyCredential", () => {
  const c = mintCredential({ learner: "Ada", tracks: [T], state: STATE });

  it("accepts a genuine pair", () => {
    expect(verifyCredential(c.id, c.payload)).toBe(true);
  });

  it("is insensitive to case and padding in the typed id", () => {
    expect(verifyCredential(`  ${c.id.toLowerCase()} `, c.payload)).toBe(true);
  });

  it("rejects a payload that has been edited", () => {
    expect(verifyCredential(c.id, `${c.payload}|extra`)).toBe(false);
  });

  it("rejects a mistyped id", () => {
    const broken = c.id.slice(0, -1) + (c.id.endsWith("A") ? "B" : "A");
    expect(verifyCredential(broken, c.payload)).toBe(false);
  });
});
