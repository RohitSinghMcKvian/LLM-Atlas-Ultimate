import { describe, it, expect } from "vitest";
import {
  BOX_COOLDOWN_DAYS,
  buildSession,
  lessonHasReview,
  reviewCounts,
  reviewPool,
  slugTerm,
  termId,
} from "./practice";
import {
  EMPTY_PROGRESS,
  MAX_BOX,
  nextBox,
  practiceXp,
  type PracticeRecord,
  type ProgressState,
} from "./progress";
import { PRACTICE_XP, type Lesson, type Track } from "./types";
import { TRACKS, ALL_LESSONS } from "./curriculum";

// The scheduler decides what a learner sees in review, so its two rules have to
// hold absolutely: nothing appears before it has been taught, and the things
// you got wrong come back before the things you got right.

const DAY = 86_400_000;
const NOW = Date.parse("2026-07-27T12:00:00.000Z");

function ago(days: number): string {
  return new Date(NOW - days * DAY).toISOString();
}

function record(patch: Partial<PracticeRecord> = {}): PracticeRecord {
  return {
    correct: true,
    attempts: 1,
    xp: PRACTICE_XP,
    box: 2,
    reviewedAt: ago(30),
    ...patch,
  };
}

function state(patch: Partial<ProgressState> = {}): ProgressState {
  return { ...EMPTY_PROGRESS, ...patch };
}

/** A tiny synthetic track, so ordering tests don't depend on real content. */
const LESSON_A: Lesson = {
  id: "l-a",
  trackId: "t",
  title: "Lesson A",
  summary: "First lesson",
  minutes: 5,
  difficulty: "beginner",
  objectives: ["one", "two"],
  keyTerms: [{ term: "Alpha", definition: "The first thing" }],
  blocks: [
    {
      type: "quiz",
      id: "q-a",
      question: "Question A?",
      options: ["yes", "no"],
      answer: 0,
      explain: "Because A.",
    },
    {
      type: "predict",
      id: "p-a",
      question: "Predict A?",
      reveal: "A happens",
      explain: "Because A.",
    },
    {
      type: "sort",
      id: "s-a",
      title: "Order A",
      items: [
        { id: "1", text: "one" },
        { id: "2", text: "two" },
        { id: "3", text: "three" },
      ],
      correct: ["1", "2", "3"],
      explain: "In that order.",
    },
  ],
};

const LESSON_B: Lesson = {
  ...LESSON_A,
  id: "l-b",
  title: "Lesson B",
  keyTerms: [{ term: "Beta", definition: "The second thing" }],
  blocks: [
    {
      type: "quiz",
      id: "q-b",
      question: "Question B?",
      options: ["yes", "no"],
      answer: 1,
      explain: "Because B.",
    },
  ],
};

const TRACK: Track = {
  id: "t",
  title: "Test track",
  blurb: "For tests",
  level: "beginner",
  accent: "ridge",
  lessons: [LESSON_A, LESSON_B],
};

// ---------------------------------------------------------------------------

describe("termId", () => {
  it("namespaces flashcards so they cannot collide with a block id", () => {
    expect(termId("l-a", "Alpha")).toBe("term:l-a:alpha");
    // A block id can never start with "term:" — it would have to contain a
    // colon, which no authored id does.
    expect(termId("l-a", "Alpha").startsWith("term:")).toBe(true);
  });

  it("slugs terms stably regardless of case and punctuation", () => {
    expect(slugTerm("Top-p")).toBe("top-p");
    expect(slugTerm("Query / Key / Value")).toBe("query-key-value");
    expect(slugTerm("  KV cache  ")).toBe("kv-cache");
    // Same term, same id, every time — a flashcard's history must survive a
    // reload.
    expect(termId("x", "KV cache")).toBe(termId("x", "kv   CACHE"));
  });
});

describe("eligibility", () => {
  it("shows nothing at all with no progress", () => {
    // The single most important rule: Practice must not be a spoiler machine
    // for lessons nobody has opened.
    expect(reviewPool([TRACK], state(), NOW)).toEqual([]);
  });

  it("admits a lesson's items once the lesson is complete", () => {
    const s = state({ completedLessons: { "l-a": ago(1) } });
    const ids = reviewPool([TRACK], s, NOW).map((i) => i.id);
    expect(ids).toContain("q-a");
    expect(ids).toContain("p-a");
    expect(ids).toContain("s-a");
    expect(ids).toContain(termId("l-a", "Alpha"));
    // Lesson B is untouched, so nothing from it appears.
    expect(ids).not.toContain("q-b");
  });

  it("admits an attempted item even when its lesson is incomplete", () => {
    // Answering a quiz in a lesson you didn't finish is not a spoiler — you've
    // already seen it.
    const s = state({ quizzes: { "q-b": { correct: false, attempts: 1, xp: 0 } } });
    const ids = reviewPool([TRACK], s, NOW).map((i) => i.id);
    expect(ids).toEqual(["q-b"]);
  });

  it("does not admit flashcards from an incomplete lesson", () => {
    // A definition is not a review until it has been an explanation.
    const s = state({ quizzes: { "q-a": { correct: true, attempts: 1, xp: 8 } } });
    const ids = reviewPool([TRACK], s, NOW).map((i) => i.id);
    expect(ids).not.toContain(termId("l-a", "Alpha"));
  });
});

describe("reasons", () => {
  const done = { completedLessons: { "l-a": ago(10) } };

  it("marks never-attempted items new", () => {
    const pool = reviewPool([TRACK], state(done), NOW);
    expect(pool.find((i) => i.id === "p-a")?.reason).toBe("new");
  });

  it("marks a wrong answer missed", () => {
    const s = state({
      ...done,
      practice: { "p-a": record({ correct: false, box: 1 }) },
    });
    expect(reviewPool([TRACK], s, NOW).find((i) => i.id === "p-a")?.reason).toBe(
      "missed",
    );
  });

  it("marks a correct-after-retries answer shaky", () => {
    const s = state({
      ...done,
      practice: { "p-a": record({ correct: true, attempts: 3, box: 2 }) },
    });
    expect(reviewPool([TRACK], s, NOW).find((i) => i.id === "p-a")?.reason).toBe(
      "shaky",
    );
  });

  it("marks a first-try correct answer due once its cooldown elapses", () => {
    const s = state({
      ...done,
      practice: { "p-a": record({ attempts: 1, box: 3, reviewedAt: ago(30) }) },
    });
    expect(reviewPool([TRACK], s, NOW).find((i) => i.id === "p-a")?.reason).toBe(
      "due",
    );
  });
});

describe("cooldown", () => {
  const done = { completedLessons: { "l-a": ago(10) } };

  it("hides an item that is resting", () => {
    // Box 4 rests 7 days; this was reviewed 2 days ago.
    const s = state({
      ...done,
      practice: { "p-a": record({ box: 4, reviewedAt: ago(2) }) },
    });
    const ids = reviewPool([TRACK], s, NOW).map((i) => i.id);
    expect(ids).not.toContain("p-a");
  });

  it("surfaces the same item once the rest period passes", () => {
    const s = state({
      ...done,
      practice: { "p-a": record({ box: 4, reviewedAt: ago(8) }) },
    });
    expect(reviewPool([TRACK], s, NOW).map((i) => i.id)).toContain("p-a");
  });

  it("never rests an item in box 1", () => {
    // Something you just got wrong should be answerable again immediately.
    const s = state({
      ...done,
      practice: {
        "p-a": record({ correct: false, box: 1, reviewedAt: ago(0) }),
      },
    });
    expect(reviewPool([TRACK], s, NOW).map((i) => i.id)).toContain("p-a");
  });

  it("treats a corrupt timestamp as due rather than hiding the card forever", () => {
    const s = state({
      ...done,
      practice: { "p-a": record({ box: 5, reviewedAt: "not-a-date" }) },
    });
    expect(reviewPool([TRACK], s, NOW).map((i) => i.id)).toContain("p-a");
  });

  it("has a cooldown for every box, rising monotonically", () => {
    for (let box = 2; box <= MAX_BOX; box++) {
      expect(BOX_COOLDOWN_DAYS[box]).toBeGreaterThanOrEqual(
        BOX_COOLDOWN_DAYS[box - 1],
      );
    }
    expect(BOX_COOLDOWN_DAYS[1]).toBe(0);
    expect(BOX_COOLDOWN_DAYS[MAX_BOX]).toBeGreaterThan(0);
  });
});

describe("box promotion", () => {
  it("promotes on a correct answer and saturates at the top", () => {
    expect(nextBox(1, true)).toBe(2);
    expect(nextBox(4, true)).toBe(5);
    expect(nextBox(MAX_BOX, true)).toBe(MAX_BOX);
  });

  it("resets to box 1 on a wrong answer, from any box", () => {
    for (let box = 1; box <= MAX_BOX; box++) {
      expect(nextBox(box, false)).toBe(1);
    }
  });

  it("treats a corrupt box value as box 1 rather than going negative", () => {
    expect(nextBox(0, true)).toBe(2);
    expect(nextBox(-7, true)).toBe(2);
  });
});

describe("practice XP", () => {
  it("pays a flat amount for a correct answer and nothing otherwise", () => {
    expect(practiceXp(true)).toBe(PRACTICE_XP);
    expect(practiceXp(false)).toBe(0);
  });

  it("does not penalise a later attempt", () => {
    // Drills exist to be repeated. A first-try premium would push a learner
    // away from the items they are worst at.
    expect(practiceXp(true)).toBe(practiceXp(true));
  });

  it("respects a per-block override", () => {
    expect(practiceXp(true, 20)).toBe(20);
    expect(practiceXp(false, 20)).toBe(0);
  });

  it("stays well below the quiz award so drills cannot outrun the course", () => {
    expect(PRACTICE_XP).toBeLessThan(20);
  });
});

describe("session ordering", () => {
  const done = { completedLessons: { "l-a": ago(10), "l-b": ago(10) } };

  it("puts missed items before new ones, and new before shaky", () => {
    const s = state({
      ...done,
      practice: {
        "s-a": record({ correct: true, attempts: 4, box: 2 }),        // shaky
        "p-a": record({ correct: false, box: 1 }),                     // missed
        // q-a left untouched -> new
      },
    });
    const order = buildSession([TRACK], s, 10, NOW).map((i) => i.id);
    expect(order.indexOf("p-a")).toBeLessThan(order.indexOf("q-a"));
    expect(order.indexOf("q-a")).toBeLessThan(order.indexOf("s-a"));
  });

  it("puts the longest-unseen item first within a reason", () => {
    const s = state({
      ...done,
      practice: {
        "p-a": record({ correct: false, box: 1, reviewedAt: ago(2) }),
        "s-a": record({ correct: false, box: 1, reviewedAt: ago(40) }),
      },
    });
    const order = buildSession([TRACK], s, 10, NOW).map((i) => i.id);
    expect(order.indexOf("s-a")).toBeLessThan(order.indexOf("p-a"));
  });

  it("caps the session at the requested size", () => {
    const s = state(done);
    expect(buildSession([TRACK], s, 2, NOW)).toHaveLength(2);
    expect(buildSession([TRACK], s, 0, NOW)).toHaveLength(0);
    // A negative limit is a caller bug, not a reason to throw.
    expect(buildSession([TRACK], s, -5, NOW)).toHaveLength(0);
  });

  it("returns an empty session rather than throwing when nothing is due", () => {
    expect(buildSession([TRACK], state(), 12, NOW)).toEqual([]);
  });

  it("carries the lesson back-reference on every item", () => {
    // A review card that can't say where the idea was taught is a dead end.
    for (const item of buildSession([TRACK], state(done), 12, NOW)) {
      expect(item.lessonId).toBeTruthy();
      expect(item.lessonTitle).toBeTruthy();
      expect(item.trackId).toBe("t");
    }
  });
});

describe("counts", () => {
  it("totals the pool by reason", () => {
    const s = state({
      completedLessons: { "l-a": ago(10) },
      practice: { "p-a": record({ correct: false, box: 1 }) },
    });
    const counts = reviewCounts([TRACK], s, NOW);
    expect(counts.missed).toBe(1);
    expect(counts.total).toBe(reviewPool([TRACK], s, NOW).length);
    expect(counts.missed + counts.new + counts.shaky + counts.due).toBe(
      counts.total,
    );
  });

  it("reports zero across the board with no progress", () => {
    const counts = reviewCounts([TRACK], state(), NOW);
    expect(counts.total).toBe(0);
    expect(counts.new).toBe(0);
  });
});

describe("lessonHasReview", () => {
  it("reports unattempted blocks as reviewable", () => {
    // This helper answers "does this lesson still have anything to drill?" for
    // a lesson the learner is already looking at, so unattempted blocks count.
    // The has-it-been-taught gate lives in reviewPool, not here.
    expect(lessonHasReview(LESSON_A, state(), NOW)).toBe(true);
  });

  it("is false once everything is answered and resting", () => {
    const s = state({
      completedLessons: { "l-a": ago(1) },
      quizzes: { "q-a": { correct: true, attempts: 1, xp: 20 } },
      practice: {
        "q-a": record({ box: 5, reviewedAt: ago(1) }),
        "p-a": record({ box: 5, reviewedAt: ago(1) }),
        "s-a": record({ box: 5, reviewedAt: ago(1) }),
      },
    });
    expect(lessonHasReview(LESSON_A, s, NOW)).toBe(false);
  });
});

describe("the real curriculum", () => {
  it("shows nothing to a learner who has just arrived", () => {
    expect(reviewCounts(TRACKS, state(), NOW).total).toBe(0);
  });

  it("fills the pool as lessons are completed", () => {
    const completedLessons: Record<string, string> = {};
    for (const lesson of ALL_LESSONS.slice(0, 3)) {
      completedLessons[lesson.id] = ago(1);
    }
    const counts = reviewCounts(TRACKS, state({ completedLessons }), NOW);
    expect(counts.total).toBeGreaterThan(0);
    // Everything is unattempted, so it should all be "new".
    expect(counts.new).toBe(counts.total);
  });

  it("can build a full session from a partly-finished course", () => {
    const completedLessons: Record<string, string> = {};
    for (const lesson of ALL_LESSONS.slice(0, 8)) {
      completedLessons[lesson.id] = ago(1);
    }
    const session = buildSession(TRACKS, state({ completedLessons }), 12, NOW);
    expect(session).toHaveLength(12);
    // Every item resolves to a lesson the learner actually finished.
    for (const item of session) {
      expect(completedLessons[item.lessonId]).toBeDefined();
    }
  });

  it("never yields an item whose id is empty", () => {
    const completedLessons = Object.fromEntries(
      ALL_LESSONS.map((l) => [l.id, ago(2)]),
    );
    for (const item of reviewPool(TRACKS, state({ completedLessons }), NOW)) {
      expect(item.id.length).toBeGreaterThan(0);
      expect(item.block ?? item.term).toBeDefined();
    }
  });
});
