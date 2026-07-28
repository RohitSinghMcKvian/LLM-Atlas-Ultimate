import { describe, it, expect } from "vitest";
import {
  CERT_MIN_GPA,
  EMPTY_PROGRESS,
  LEVELS,
  certificateStatus,
  courseCoverage,
  dayKey,
  earnedAchievements,
  exerciseXp,
  isTrackUnlocked,
  lessonSequence,
  lessonXp,
  levelFor,
  neighbors,
  nextLesson,
  quizXp,
  touchStreak,
  trackCoverage,
  trackMastery,
  type ExerciseRecord,
  type ProgressState,
} from "./progress";
import { EXERCISE_XP, QUIZ_XP, type Lesson, type Track } from "./types";
import { TRACKS } from "./curriculum";

// The progression rules are the product's reward economy. A bug here either
// pays XP twice (levels stop meaning anything) or gates a credential someone
// has earned.

function lesson(id: string, trackId: string, over: Partial<Lesson> = {}): Lesson {
  return {
    id,
    trackId,
    title: id,
    summary: "",
    minutes: 10,
    difficulty: "beginner",
    objectives: [],
    blocks: [],
    ...over,
  };
}

const T1: Track = {
  id: "t1",
  title: "One",
  blurb: "",
  level: "beginner",
  accent: "cyan",
  lessons: [lesson("a", "t1"), lesson("b", "t1"), lesson("c", "t1")],
};

const T2: Track = {
  id: "t2",
  title: "Two",
  blurb: "",
  level: "intermediate",
  accent: "violet",
  prereqs: ["t1"],
  lessons: [
    lesson("d", "t2", {
      blocks: [
        {
          type: "quiz",
          id: "q1",
          question: "",
          options: ["a", "b"],
          answer: 0,
          explain: "",
        },
        {
          type: "exercise",
          id: "e1",
          title: "",
          brief: "",
          rubric: [{ id: "r", label: "R", descriptor: "", weight: 1 }],
        },
      ],
    }),
  ],
};

const FIXTURE = [T1, T2];

function withState(over: Partial<ProgressState> = {}): ProgressState {
  return { ...EMPTY_PROGRESS, ...over };
}

function done(...ids: string[]): Record<string, string> {
  return Object.fromEntries(ids.map((id) => [id, "2026-07-26T00:00:00.000Z"]));
}

describe("levelFor", () => {
  it("starts at level 1 with no XP", () => {
    const l = levelFor(0);
    expect(l.level).toBe(1);
    expect(l.into).toBe(0);
  });

  it("lands exactly on a threshold", () => {
    expect(levelFor(LEVELS[1].minXp).level).toBe(2);
    expect(levelFor(LEVELS[1].minXp - 1).level).toBe(1);
  });

  it("reports progress through the current level", () => {
    const mid = (LEVELS[0].minXp + LEVELS[1].minXp) / 2;
    const l = levelFor(mid);
    expect(l.fraction).toBeCloseTo(0.5, 5);
    expect(l.toNext).toBe(LEVELS[1].minXp - mid);
  });

  it("saturates at the top level instead of overflowing", () => {
    const l = levelFor(999_999);
    expect(l.isMax).toBe(true);
    expect(l.level).toBe(LEVELS[LEVELS.length - 1].level);
    expect(l.fraction).toBe(1);
    expect(l.toNext).toBe(0);
  });

  it("treats negative XP as zero", () => {
    expect(levelFor(-500).level).toBe(1);
  });
});

describe("XP awards", () => {
  it("scales lesson XP by difficulty", () => {
    expect(lessonXp(lesson("x", "t", { difficulty: "expert" }))).toBeGreaterThan(
      lessonXp(lesson("y", "t", { difficulty: "beginner" })),
    );
  });

  it("pays full marks only on the first quiz attempt", () => {
    expect(quizXp(1, true)).toBe(QUIZ_XP);
    expect(quizXp(2, true)).toBeLessThan(QUIZ_XP);
    expect(quizXp(2, true)).toBeGreaterThan(0);
  });

  it("pays nothing for a wrong answer", () => {
    expect(quizXp(1, false)).toBe(0);
  });

  it("pays nothing for a failed practical, and scales above the pass mark", () => {
    expect(exerciseXp(69)).toBe(0);
    expect(exerciseXp(70)).toBeGreaterThan(0);
    expect(exerciseXp(100)).toBe(EXERCISE_XP);
    expect(exerciseXp(85)).toBeLessThan(exerciseXp(95));
  });
});

describe("touchStreak", () => {
  it("starts a streak on the first day of activity", () => {
    const r = touchStreak(withState(), "2026-07-26");
    expect(r.streak).toBe(1);
    expect(r.advanced).toBe(true);
  });

  it("is idempotent within the same day", () => {
    const state = withState({ streak: 4, lastActiveDay: "2026-07-26" });
    const r = touchStreak(state, "2026-07-26");
    expect(r.streak).toBe(4);
    expect(r.advanced).toBe(false);
  });

  it("continues on consecutive days", () => {
    const state = withState({ streak: 4, lastActiveDay: "2026-07-26" });
    expect(touchStreak(state, "2026-07-27").streak).toBe(5);
  });

  it("resets after a missed day", () => {
    const state = withState({ streak: 9, lastActiveDay: "2026-07-26" });
    expect(touchStreak(state, "2026-07-29").streak).toBe(1);
  });

  it("crosses a month boundary correctly", () => {
    const state = withState({ streak: 2, lastActiveDay: "2026-07-31" });
    expect(touchStreak(state, "2026-08-01").streak).toBe(3);
  });

  it("does not credit a day when the clock moves backwards", () => {
    const state = withState({ streak: 6, lastActiveDay: "2026-07-26" });
    expect(touchStreak(state, "2026-07-20").streak).toBe(1);
  });

  it("keeps the longest streak once it is beaten", () => {
    const state = withState({
      streak: 4,
      longestStreak: 12,
      lastActiveDay: "2026-07-26",
    });
    expect(touchStreak(state, "2026-07-27").longestStreak).toBe(12);
  });
});

describe("dayKey", () => {
  it("formats a local date as YYYY-MM-DD", () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("coverage", () => {
  it("counts lessons per track", () => {
    const c = trackCoverage(T1, withState({ completedLessons: done("a", "b") }));
    expect(c).toMatchObject({ done: 2, total: 3, percent: 67, complete: false });
  });

  it("reports completion only when every lesson is done", () => {
    expect(
      trackCoverage(T1, withState({ completedLessons: done("a", "b", "c") })).complete,
    ).toBe(true);
  });

  it("aggregates across the course", () => {
    const c = courseCoverage(FIXTURE, withState({ completedLessons: done("a") }));
    expect(c).toMatchObject({ done: 1, total: 4, percent: 25 });
  });
});

describe("trackMastery", () => {
  it("caps a read-only track below full mastery", () => {
    const state = withState({ completedLessons: done("d") });
    // Everything read, nothing demonstrated: completion is only 60% of mastery.
    expect(trackMastery(T2, state)).toBe(60);
  });

  it("reaches 100 only with quizzes and practicals as well", () => {
    const state = withState({
      completedLessons: done("d"),
      quizzes: { q1: { correct: true, attempts: 1, xp: 20 } },
      exercises: {
        e1: {
          percent: 100,
          letter: "A+",
          gradePoints: 5,
          attempts: 1,
          xp: 120,
          gradedAt: "",
        },
      },
    });
    expect(trackMastery(T2, state)).toBe(100);
  });

  it("gives a track with no assessments full credit for reading it", () => {
    const state = withState({ completedLessons: done("a", "b", "c") });
    expect(trackMastery(T1, state)).toBe(100);
  });
});

describe("isTrackUnlocked", () => {
  it("always opens a track with no prerequisites", () => {
    expect(isTrackUnlocked(T1, FIXTURE, withState())).toBe(true);
  });

  it("stays gated below the two-thirds threshold", () => {
    expect(
      isTrackUnlocked(T2, FIXTURE, withState({ completedLessons: done("a") })),
    ).toBe(false);
  });

  it("opens at two-thirds, before the prerequisite is finished", () => {
    expect(
      isTrackUnlocked(T2, FIXTURE, withState({ completedLessons: done("a", "b") })),
    ).toBe(true);
  });

  it("ignores a prerequisite id that no longer exists", () => {
    const orphan: Track = { ...T2, prereqs: ["gone"] };
    expect(isTrackUnlocked(orphan, FIXTURE, withState())).toBe(true);
  });
});

describe("navigation", () => {
  it("returns the first incomplete lesson in curriculum order", () => {
    expect(nextLesson(FIXTURE, withState({ completedLessons: done("a") }))?.id).toBe("b");
  });

  it("returns undefined once everything is done", () => {
    expect(
      nextLesson(FIXTURE, withState({ completedLessons: done("a", "b", "c", "d") })),
    ).toBeUndefined();
  });

  it("walks neighbours across a track boundary", () => {
    expect(neighbors(FIXTURE, "c").next?.id).toBe("d");
    expect(neighbors(FIXTURE, "d").prev?.id).toBe("c");
  });

  it("has no neighbours off either end", () => {
    expect(neighbors(FIXTURE, "a").prev).toBeUndefined();
    expect(neighbors(FIXTURE, "d").next).toBeUndefined();
    expect(neighbors(FIXTURE, "nope")).toEqual({});
  });

  it("flattens in track order", () => {
    expect(lessonSequence(FIXTURE).map((l) => l.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("certificateStatus", () => {
  const pass: ExerciseRecord = {
    percent: 95,
    letter: "A",
    gradePoints: 4,
    attempts: 1,
    xp: 114,
    gradedAt: "",
  };

  it("is ineligible with nothing done, and says why", () => {
    const s = certificateStatus(FIXTURE, withState());
    expect(s.eligible).toBe(false);
    expect(s.requirements).toHaveLength(3);
    expect(s.requirements.every((r) => !r.met)).toBe(true);
  });

  it("reports all requirements, not just the first failure", () => {
    const s = certificateStatus(
      FIXTURE,
      withState({ completedLessons: done("a", "b", "c", "d") }),
    );
    expect(s.requirements.find((r) => r.id === "lessons")!.met).toBe(true);
    expect(s.requirements.find((r) => r.id === "practicals")!.met).toBe(false);
  });

  it("is eligible with every lesson done and a passing GPA", () => {
    const s = certificateStatus(
      FIXTURE,
      withState({
        completedLessons: done("a", "b", "c", "d"),
        exercises: { e1: pass },
      }),
    );
    expect(s.eligible).toBe(true);
    expect(s.gpa).toBeGreaterThanOrEqual(CERT_MIN_GPA);
  });

  it("refuses a graded-but-failing practical", () => {
    const s = certificateStatus(
      FIXTURE,
      withState({
        completedLessons: done("a", "b", "c", "d"),
        exercises: {
          e1: { ...pass, percent: 55, letter: "F", gradePoints: 0 },
        },
      }),
    );
    expect(s.eligible).toBe(false);
    expect(s.requirements.find((r) => r.id === "practicals")!.met).toBe(false);
  });
});

describe("earnedAchievements", () => {
  it("awards nothing on an empty slate", () => {
    expect(earnedAchievements(FIXTURE, withState())).toHaveLength(0);
  });

  it("awards first contact after one lesson", () => {
    const earned = earnedAchievements(FIXTURE, withState({ completedLessons: done("a") }));
    expect(earned.map((a) => a.id)).toContain("first-steps");
  });

  it("awards the streak badge from the longest run, not the current one", () => {
    const earned = earnedAchievements(
      FIXTURE,
      withState({ streak: 1, longestStreak: 9 }),
    );
    expect(earned.map((a) => a.id)).toContain("week-streak");
  });
});

describe("the real curriculum", () => {
  it("has a first lesson that is reachable with no progress", () => {
    expect(nextLesson(TRACKS, EMPTY_PROGRESS)?.id).toBe(TRACKS[0].lessons[0].id);
  });

  it("can be completed to eligibility", () => {
    const all = Object.fromEntries(
      TRACKS.flatMap((t) => t.lessons).map((l) => [l.id, "2026-07-26T00:00:00.000Z"]),
    );
    const exercises = Object.fromEntries(
      TRACKS.flatMap((t) => t.lessons)
        .flatMap((l) => l.blocks)
        .filter((b) => b.type === "exercise")
        .map((b) => [
          (b as { id: string }).id,
          {
            percent: 92,
            letter: "A-",
            gradePoints: 3.7,
            attempts: 1,
            xp: 110,
            gradedAt: "",
          } satisfies ExerciseRecord,
        ]),
    );
    expect(
      certificateStatus(TRACKS, withState({ completedLessons: all, exercises })).eligible,
    ).toBe(true);
  });
});
