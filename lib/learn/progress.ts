/**
 * Atlas Learn — the reward economy and progression rules.
 *
 * Every number the learner sees (XP, level, streak, mastery, eligibility) is
 * derived here from a plain state object. The store owns persistence; this
 * module owns the arithmetic, so the rules are unit-tested rather than spread
 * across components.
 *
 * Pure module: no React, no browser globals, no `Date.now()` in the branching
 * paths — callers pass "today" so streak logic is testable.
 */

import {
  DIFFICULTY_XP_MULTIPLIER,
  LESSON_XP,
  QUIZ_XP,
  QUIZ_RETRY_XP,
  EXERCISE_XP,
  PRACTICE_XP,
  TRACK_BONUS_XP,
  type Lesson,
  type Track,
} from "./types";
import { isPassing, gpa as computeGpa } from "./grading";

// ---------------------------------------------------------------------------
// Persisted shape
// ---------------------------------------------------------------------------

export interface QuizRecord {
  correct: boolean;
  attempts: number;
  /** XP actually awarded — recorded so re-answering can never double-pay. */
  xp: number;
}

export interface ExerciseRecord {
  percent: number;
  letter: string;
  gradePoints: number;
  attempts: number;
  /** Highest XP awarded so far for this exercise. */
  xp: number;
  gradedAt: string;
  gradedBy?: string;
}

/**
 * An inline drill or flashcard, plus the spacing state the Practice view reads.
 *
 * `box` is a Leitner bucket: right answers promote, wrong answers reset to 1,
 * and the bucket sets how long the item rests before it comes back round.
 */
export interface PracticeRecord {
  correct: boolean;
  attempts: number;
  xp: number;
  /** 1-5. Higher means better known, and a longer cooldown. */
  box: number;
  /** ISO timestamp of the last review. */
  reviewedAt: string;
}

export interface ProgressState {
  /** lessonId → ISO timestamp. */
  completedLessons: Record<string, string>;
  /** quiz block id → record. */
  quizzes: Record<string, QuizRecord>;
  /** exercise block id → best graded result. */
  exercises: Record<string, ExerciseRecord>;
  /** drill or flashcard id → record. Written by lessons and the Practice view. */
  practice: Record<string, PracticeRecord>;
  xp: number;
  streak: number;
  longestStreak: number;
  /** `YYYY-MM-DD` of the last day the learner did anything. */
  lastActiveDay: string;
  /** Track ids whose completion bonus has already been paid. */
  trackBonuses: string[];
}

export const EMPTY_PROGRESS: ProgressState = {
  completedLessons: {},
  quizzes: {},
  exercises: {},
  practice: {},
  xp: 0,
  streak: 0,
  longestStreak: 0,
  lastActiveDay: "",
  trackBonuses: [],
};

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

export interface LevelDef {
  level: number;
  minXp: number;
  title: string;
}

/**
 * Nine ranks. The curve is roughly quadratic so early levels arrive quickly —
 * the first two are reachable inside one sitting — while the last one is a
 * genuine course-long commitment.
 */
export const LEVELS: LevelDef[] = [
  { level: 1, minXp: 0, title: "Explorer" },
  { level: 2, minXp: 150, title: "Navigator" },
  { level: 3, minXp: 400, title: "Cartographer" },
  { level: 4, minXp: 800, title: "Prompt Engineer" },
  { level: 5, minXp: 1400, title: "Context Architect" },
  { level: 6, minXp: 2200, title: "Retrieval Specialist" },
  { level: 7, minXp: 3200, title: "Agent Wrangler" },
  { level: 8, minXp: 4500, title: "Systems Engineer" },
  { level: 9, minXp: 6000, title: "Atlas Master" },
];

export interface LevelInfo {
  level: number;
  title: string;
  /** XP earned inside the current level. */
  into: number;
  /** XP the current level spans. `0` at max level. */
  span: number;
  /** XP still needed for the next level. `0` at max level. */
  toNext: number;
  /** 0-1 progress through the current level. `1` at max level. */
  fraction: number;
  isMax: boolean;
}

export function levelFor(xp: number): LevelInfo {
  const safe = Math.max(0, Math.floor(xp));
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (safe >= LEVELS[i].minXp) idx = i;
  }
  const current = LEVELS[idx];
  const next = LEVELS[idx + 1];
  if (!next) {
    return {
      level: current.level,
      title: current.title,
      into: safe - current.minXp,
      span: 0,
      toNext: 0,
      fraction: 1,
      isMax: true,
    };
  }
  const span = next.minXp - current.minXp;
  const into = safe - current.minXp;
  return {
    level: current.level,
    title: current.title,
    into,
    span,
    toNext: next.minXp - safe,
    fraction: span > 0 ? into / span : 0,
    isMax: false,
  };
}

// ---------------------------------------------------------------------------
// XP awards
// ---------------------------------------------------------------------------

export function lessonXp(lesson: Lesson): number {
  return Math.round(LESSON_XP * DIFFICULTY_XP_MULTIPLIER[lesson.difficulty]);
}

/** First-try answers are worth full marks; a corrected answer still pays. */
export function quizXp(attempts: number, correct: boolean, base = QUIZ_XP): number {
  if (!correct) return 0;
  return attempts <= 1 ? base : Math.round((QUIZ_RETRY_XP / QUIZ_XP) * base);
}

/**
 * Drills pay a flat, small amount for a correct answer regardless of attempt
 * count.
 *
 * No first-try premium here on purpose: drills exist to be repeated, and
 * penalising the second attempt would push a learner to stop practising the
 * things they're worst at — the exact opposite of the point.
 */
export function practiceXp(correct: boolean, base = PRACTICE_XP): number {
  return correct ? base : 0;
}

/** Leitner bucket after an answer. Right promotes by one, wrong resets. */
export function nextBox(box: number, correct: boolean): number {
  if (!correct) return 1;
  return Math.min(MAX_BOX, Math.max(1, box) + 1);
}

/** Highest Leitner bucket. Box 5 rests for two weeks — effectively "known". */
export const MAX_BOX = 5;

/**
 * Graded practicals pay proportionally to the grade, with a floor at the pass
 * mark — a 71% is a real accomplishment and should feel like one — and nothing
 * at all below it, so the pass line means something.
 */
export function exerciseXp(percent: number, base = EXERCISE_XP): number {
  if (!isPassing(percent)) return 0;
  return Math.round(base * (percent / 100));
}

export const trackBonusXp = () => TRACK_BONUS_XP;

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

/** Local-time `YYYY-MM-DD`. Local, not UTC: a streak is a human day. */
export function dayKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  if ([ay, am, ad, by, bm, bd].some((n) => !Number.isFinite(n))) return Infinity;
  // UTC midnights for the diff so a DST shift can't make a day 23h and break
  // the "exactly 1" test that continues a streak.
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86_400_000);
}

export interface StreakUpdate {
  streak: number;
  longestStreak: number;
  lastActiveDay: string;
  /** True when this call started a new day — the UI celebrates on that edge. */
  advanced: boolean;
}

/** Applies a day of activity. Idempotent within the same day. */
export function touchStreak(state: ProgressState, today = dayKey()): StreakUpdate {
  const last = state.lastActiveDay;
  if (last === today) {
    return {
      streak: state.streak || 1,
      longestStreak: Math.max(state.longestStreak, state.streak || 1),
      lastActiveDay: today,
      advanced: false,
    };
  }
  const gap = last ? daysBetween(last, today) : Infinity;
  // Exactly one day later continues the run; anything else restarts it. A
  // *negative* gap (clock moved backwards) also restarts rather than crediting
  // a day that never happened.
  const streak = gap === 1 ? state.streak + 1 : 1;
  return {
    streak,
    longestStreak: Math.max(state.longestStreak, streak),
    lastActiveDay: today,
    advanced: true,
  };
}

// ---------------------------------------------------------------------------
// Completion & mastery
// ---------------------------------------------------------------------------

export interface Coverage {
  done: number;
  total: number;
  /** 0-100, rounded. */
  percent: number;
  complete: boolean;
}

export function trackCoverage(track: Track, state: ProgressState): Coverage {
  const total = track.lessons.length;
  const done = track.lessons.filter((l) => state.completedLessons[l.id]).length;
  return {
    done,
    total,
    percent: total ? Math.round((done / total) * 100) : 0,
    complete: total > 0 && done === total,
  };
}

export function courseCoverage(tracks: Track[], state: ProgressState): Coverage {
  const lessons = tracks.flatMap((t) => t.lessons);
  const done = lessons.filter((l) => state.completedLessons[l.id]).length;
  return {
    done,
    total: lessons.length,
    percent: lessons.length ? Math.round((done / lessons.length) * 100) : 0,
    complete: lessons.length > 0 && done === lessons.length,
  };
}

/**
 * Mastery is deliberately *not* the same as completion.
 *
 * Reading every page of a track gets you 60%. The remaining 40% comes from
 * demonstrated recall (quizzes) and demonstrated skill (graded practicals), so
 * the roadmap can distinguish "I've seen this" from "I can do this".
 */
export function trackMastery(track: Track, state: ProgressState): number {
  const coverage = trackCoverage(track, state).percent / 100;

  const quizIds = blockIds(track, "quiz");
  const quizScore = quizIds.length
    ? quizIds.filter((id) => state.quizzes[id]?.correct).length / quizIds.length
    : 1;

  const exerciseIds = blockIds(track, "exercise");
  const exerciseScore = exerciseIds.length
    ? exerciseIds.reduce((n, id) => n + (state.exercises[id]?.percent ?? 0) / 100, 0) /
      exerciseIds.length
    : 1;

  return Math.round((coverage * 0.6 + quizScore * 0.2 + exerciseScore * 0.2) * 100);
}

function blockIds(track: Track, type: "quiz" | "exercise"): string[] {
  const ids: string[] = [];
  for (const lesson of track.lessons) {
    for (const block of lesson.blocks) {
      if (block.type === type) ids.push(block.id);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Navigation & gating
// ---------------------------------------------------------------------------

/**
 * A track opens once its prerequisites are *mostly* done (⅔), not entirely.
 *
 * Hard locks punish the learner who already knows the first three lessons and
 * wants to skip ahead; a soft gate still communicates the intended order. The
 * first track in the curriculum is always open.
 */
export const UNLOCK_THRESHOLD = 2 / 3;

export function isTrackUnlocked(
  track: Track,
  tracks: Track[],
  state: ProgressState,
): boolean {
  if (!track.prereqs?.length) return true;
  return track.prereqs.every((id) => {
    const prereq = tracks.find((t) => t.id === id);
    if (!prereq) return true;
    const { done, total } = trackCoverage(prereq, state);
    return total === 0 || done / total >= UNLOCK_THRESHOLD;
  });
}

/** The next lesson to do: first incomplete lesson in curriculum order. */
export function nextLesson(tracks: Track[], state: ProgressState): Lesson | undefined {
  for (const track of tracks) {
    for (const lesson of track.lessons) {
      if (!state.completedLessons[lesson.id]) return lesson;
    }
  }
  return undefined;
}

/** Flat curriculum order — powers prev/next and keyboard navigation. */
export function lessonSequence(tracks: Track[]): Lesson[] {
  return tracks.flatMap((t) => t.lessons);
}

export function neighbors(
  tracks: Track[],
  lessonId: string,
): { prev?: Lesson; next?: Lesson } {
  const all = lessonSequence(tracks);
  const i = all.findIndex((l) => l.id === lessonId);
  if (i === -1) return {};
  return { prev: all[i - 1], next: all[i + 1] };
}

// ---------------------------------------------------------------------------
// Certification
// ---------------------------------------------------------------------------

export const CERT_MIN_GPA = 3.0;

export interface Requirement {
  id: string;
  label: string;
  met: boolean;
  /** Human-readable progress, e.g. "18 / 24". */
  detail: string;
}

export interface CertificateStatus {
  eligible: boolean;
  requirements: Requirement[];
  gpa: number;
  /** 0-100 — how close to eligibility, for the progress ring. */
  percent: number;
  gradedCount: number;
  gradedTotal: number;
}

/**
 * Certification is earned, not accumulated: every lesson read, every practical
 * graded at or above the pass mark, and a GPA of 3.0 across them. The
 * requirement list is returned in full (not short-circuited) so the UI can show
 * a checklist rather than a single locked button.
 */
export function certificateStatus(
  tracks: Track[],
  state: ProgressState,
): CertificateStatus {
  const coverage = courseCoverage(tracks, state);

  const exerciseIds = tracks.flatMap((t) => blockIds(t, "exercise"));
  const graded = exerciseIds
    .map((id) => state.exercises[id])
    .filter((r): r is ExerciseRecord => Boolean(r));
  const passed = graded.filter((r) => isPassing(r.percent));
  const currentGpa = computeGpa(graded);

  const requirements: Requirement[] = [
    {
      id: "lessons",
      label: "Complete every lesson",
      met: coverage.complete,
      detail: `${coverage.done} / ${coverage.total}`,
    },
    {
      id: "practicals",
      label: "Pass every graded practical",
      met: exerciseIds.length > 0 && passed.length === exerciseIds.length,
      detail: `${passed.length} / ${exerciseIds.length}`,
    },
    {
      id: "gpa",
      label: `Hold a ${CERT_MIN_GPA.toFixed(1)} grade-point average`,
      met: graded.length > 0 && currentGpa >= CERT_MIN_GPA,
      detail: `${currentGpa.toFixed(2)} GPA`,
    },
  ];

  const met = requirements.filter((r) => r.met).length;
  return {
    eligible: requirements.every((r) => r.met),
    requirements,
    gpa: currentGpa,
    percent: Math.round((met / requirements.length) * 100),
    gradedCount: graded.length,
    gradedTotal: exerciseIds.length,
  };
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

export interface AchievementDef {
  id: string;
  label: string;
  description: string;
  /** Lucide icon name, resolved by the UI. */
  icon: string;
  earned: (ctx: AchievementContext) => boolean;
}

export interface AchievementContext {
  state: ProgressState;
  tracks: Track[];
  coverage: Coverage;
  gpa: number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: "first-steps",
    label: "First Contact",
    description: "Finish your first lesson.",
    icon: "Sparkles",
    earned: (c) => c.coverage.done >= 1,
  },
  {
    id: "quiz-streak",
    label: "Perfect Recall",
    description: "Answer five quizzes correctly on the first attempt.",
    icon: "Brain",
    earned: (c) =>
      Object.values(c.state.quizzes).filter((q) => q.correct && q.attempts <= 1)
        .length >= 5,
  },
  {
    id: "first-grade",
    label: "Under Review",
    description: "Submit a practical for grading.",
    icon: "ClipboardCheck",
    earned: (c) => Object.keys(c.state.exercises).length >= 1,
  },
  {
    id: "honour-roll",
    label: "Honour Roll",
    description: "Earn an A on a graded practical.",
    icon: "Medal",
    earned: (c) =>
      Object.values(c.state.exercises).some((e) => e.percent >= 93),
  },
  {
    id: "week-streak",
    label: "Seven Days",
    description: "Practise seven days in a row.",
    icon: "Flame",
    earned: (c) => c.state.longestStreak >= 7,
  },
  {
    id: "track-clear",
    label: "Track Cleared",
    description: "Complete every lesson in a track.",
    icon: "Route",
    earned: (c) => c.tracks.some((t) => trackCoverage(t, c.state).complete),
  },
  {
    id: "halfway",
    label: "Halfway There",
    description: "Reach 50% course completion.",
    icon: "Compass",
    earned: (c) => c.coverage.percent >= 50,
  },
  {
    id: "graduate",
    label: "Atlas Certified",
    description: "Complete the course and earn the certificate.",
    icon: "GraduationCap",
    earned: (c) => c.coverage.complete && c.gpa >= CERT_MIN_GPA,
  },
];

export function earnedAchievements(
  tracks: Track[],
  state: ProgressState,
): AchievementDef[] {
  const ctx: AchievementContext = {
    state,
    tracks,
    coverage: courseCoverage(tracks, state),
    gpa: computeGpa(Object.values(state.exercises)),
  };
  return ACHIEVEMENTS.filter((a) => a.earned(ctx));
}
