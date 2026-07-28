/**
 * Atlas Learn — the assembled curriculum and its lookup indexes.
 *
 * Tracks are authored one file per track under `./content`. This module is the
 * only place that knows their order, and it precomputes every index the UI
 * needs so no component rebuilds a `Map` inside a render loop.
 */

import { FOUNDATIONS } from "./content/foundations";
import { PROMPTING } from "./content/prompting";
import { RETRIEVAL } from "./content/retrieval";
import { TOOLS } from "./content/tools";
import { AGENTS } from "./content/agents";
import { CONTEXT_ENGINEERING } from "./content/context-engineering";
import { EVALUATION } from "./content/evaluation";
import { PRODUCTION } from "./content/production";
import { CAPSTONE } from "./content/capstone";
import type { Block, Lesson, Reference, Track } from "./types";

export * from "./types";

/** Curriculum order — beginner to expert. This array is the course. */
export const TRACKS: Track[] = [
  FOUNDATIONS,
  PROMPTING,
  RETRIEVAL,
  TOOLS,
  AGENTS,
  CONTEXT_ENGINEERING,
  EVALUATION,
  PRODUCTION,
  CAPSTONE,
];

export const ALL_LESSONS: Lesson[] = TRACKS.flatMap((t) => t.lessons);

export const TOTAL_LESSONS = ALL_LESSONS.length;

export const TOTAL_MINUTES = ALL_LESSONS.reduce((n, l) => n + l.minutes, 0);

const LESSON_INDEX = new Map(ALL_LESSONS.map((l) => [l.id, l]));
const TRACK_INDEX = new Map(TRACKS.map((t) => [t.id, t]));

export function getLesson(id: string): Lesson | undefined {
  return LESSON_INDEX.get(id);
}

export function getTrack(id: string): Track | undefined {
  return TRACK_INDEX.get(id);
}

export function trackOf(lessonId: string): Track | undefined {
  const lesson = LESSON_INDEX.get(lessonId);
  return lesson ? TRACK_INDEX.get(lesson.trackId) : undefined;
}

/** Zero-based position in the flat curriculum order. */
const POSITION = new Map(ALL_LESSONS.map((l, i) => [l.id, i]));

export function lessonPosition(id: string): number {
  return POSITION.get(id) ?? -1;
}

/** The first lesson — the landing target when nothing has been started. */
export const FIRST_LESSON = ALL_LESSONS[0];

// ---------------------------------------------------------------------------
// Derived block collections
// ---------------------------------------------------------------------------

type QuizBlock = Extract<Block, { type: "quiz" }>;
type ExerciseBlock = Extract<Block, { type: "exercise" }>;
type PredictBlock = Extract<Block, { type: "predict" }>;
type SortBlock = Extract<Block, { type: "sort" }>;

/** The ungraded, instant-feedback drills. Both feed the Practice view. */
export type DrillBlock = PredictBlock | SortBlock;

export const ALL_QUIZZES: QuizBlock[] = ALL_LESSONS.flatMap(
  (l) => l.blocks.filter((b): b is QuizBlock => b.type === "quiz"),
);

export const ALL_EXERCISES: ExerciseBlock[] = ALL_LESSONS.flatMap(
  (l) => l.blocks.filter((b): b is ExerciseBlock => b.type === "exercise"),
);

export const ALL_DRILLS: DrillBlock[] = ALL_LESSONS.flatMap((l) =>
  l.blocks.filter(
    (b): b is DrillBlock => b.type === "predict" || b.type === "sort",
  ),
);

export const ALL_REFERENCES: Reference[] = ALL_LESSONS.flatMap(
  (l) => l.references ?? [],
);

const EXERCISE_LESSON = new Map<string, Lesson>();
/** Every assessable block id — quiz, drill, exercise — back to its lesson. */
const ITEM_LESSON = new Map<string, Lesson>();
for (const lesson of ALL_LESSONS) {
  for (const block of lesson.blocks) {
    if (block.type === "exercise") EXERCISE_LESSON.set(block.id, lesson);
    if (
      block.type === "exercise" ||
      block.type === "quiz" ||
      block.type === "predict" ||
      block.type === "sort"
    ) {
      ITEM_LESSON.set(block.id, lesson);
    }
  }
}

/** Which lesson an exercise belongs to — the grader prompt needs its title. */
export function lessonForExercise(exerciseId: string): Lesson | undefined {
  return EXERCISE_LESSON.get(exerciseId);
}

/**
 * Which lesson any assessed item came from.
 *
 * The Practice view pulls items out of their lessons and needs a way back —
 * a review card that can't say where the idea was taught is a dead end.
 */
export function lessonForItem(itemId: string): Lesson | undefined {
  return ITEM_LESSON.get(itemId);
}

export function getExercise(id: string): ExerciseBlock | undefined {
  return ALL_EXERCISES.find((e) => e.id === id);
}

// ---------------------------------------------------------------------------
// Course-level summary, for the roadmap header
// ---------------------------------------------------------------------------

export interface CourseStats {
  tracks: number;
  lessons: number;
  minutes: number;
  quizzes: number;
  practicals: number;
  liveCells: number;
  visualizations: number;
  figures: number;
  drills: number;
  references: number;
  words: number;
}

/** Rough learner-facing word count — prose, callouts, verdicts, briefs. */
function countWords(lesson: Lesson): number {
  let text = `${lesson.summary} ${lesson.objectives.join(" ")}`;
  for (const b of lesson.blocks) {
    switch (b.type) {
      case "p":
      case "h":
        text += ` ${b.text}`;
        break;
      case "callout":
        text += ` ${b.title} ${b.text}`;
        break;
      case "steps":
        text += ` ${b.steps.map((s) => `${s.title} ${s.text}`).join(" ")}`;
        break;
      case "compare":
        text += ` ${b.bad.label} ${b.bad.text} ${b.good.label} ${b.good.text} ${b.verdict}`;
        break;
      case "formula":
        text += ` ${b.where.map((w) => w.meaning).join(" ")} ${b.note ?? ""}`;
        break;
      case "annotated":
        text += ` ${b.notes.map((n) => `${n.label} ${n.text}`).join(" ")}`;
        break;
      case "quiz":
        text += ` ${b.question} ${b.explain}`;
        break;
      case "predict":
        text += ` ${b.question} ${b.reveal} ${b.explain}`;
        break;
      case "sort":
        text += ` ${b.title} ${b.explain}`;
        break;
      case "exercise":
        text += ` ${b.brief}`;
        break;
      case "figure":
      case "viz":
      case "table":
        text += ` ${b.caption ?? ""}`;
        break;
      default:
        break;
    }
  }
  for (const t of lesson.keyTerms ?? []) text += ` ${t.definition}`;
  return text.trim().split(/\s+/).length;
}

/** Prose words in a lesson. Exported so the integrity test can hold a floor. */
export function lessonWordCount(lesson: Lesson): number {
  return countWords(lesson);
}

const countBlocks = (type: Block["type"]) =>
  ALL_LESSONS.reduce(
    (n, l) => n + l.blocks.filter((b) => b.type === type).length,
    0,
  );

export const COURSE_STATS: CourseStats = {
  tracks: TRACKS.length,
  lessons: TOTAL_LESSONS,
  minutes: TOTAL_MINUTES,
  quizzes: ALL_QUIZZES.length,
  practicals: ALL_EXERCISES.length,
  liveCells: countBlocks("live"),
  visualizations: countBlocks("viz"),
  figures: countBlocks("figure"),
  drills: ALL_DRILLS.length,
  references: ALL_REFERENCES.length,
  words: ALL_LESSONS.reduce((n, l) => n + countWords(l), 0),
};
