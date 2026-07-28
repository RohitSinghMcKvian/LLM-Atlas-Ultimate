"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { debouncedLocalStorage } from "./debounced-storage";
import {
  EMPTY_PROGRESS,
  dayKey,
  exerciseXp,
  lessonXp,
  nextBox,
  practiceXp,
  quizXp,
  touchStreak,
  trackBonusXp,
  type ExerciseRecord,
  type PracticeRecord,
  type ProgressState,
  type QuizRecord,
} from "@/lib/learn/progress";
import type { GradeResult, Lesson, Track } from "@/lib/learn/types";

/**
 * Learn progress, persisted locally.
 *
 * Deliberately **not** a Supabase-backed repo like chat/playground. Progress is
 * per-device study state, useful with zero configuration, and nothing here is
 * worth a round trip on every quiz answer. The certificate is derived from this
 * state and re-derivable from its printed transcript, so a device change costs
 * the learner nothing they can't restore.
 *
 * The invariant every award path upholds: **XP is paid once**. Each record
 * stores the XP it was awarded, and a re-award pays only the positive
 * difference. Without that, re-answering a quiz or re-submitting a practical
 * would print money and the level would stop meaning anything.
 */

/** A transient "you just earned something" event the HUD animates. */
export interface RewardEvent {
  id: number;
  kind:
    | "lesson"
    | "quiz"
    | "exercise"
    | "practice"
    | "track"
    | "level"
    | "streak";
  label: string;
  xp: number;
}

/** How the reader is set up. Personal comfort, not progress. */
export interface ReadingPrefs {
  size: "s" | "m" | "l";
  /** `wide` lets prose run past the default 68ch measure. */
  measure: "comfortable" | "wide";
  /** Dims the side rails so only the lesson is lit. */
  focus: boolean;
}

export const DEFAULT_READING_PREFS: ReadingPrefs = {
  size: "m",
  measure: "comfortable",
  focus: false,
};

interface LearnState extends ProgressState {
  /** Printed on the certificate. Empty until the learner sets it. */
  learnerName: string;
  currentLessonId: string;
  bookmarks: string[];
  /** lessonId → free-text notes. */
  notes: Record<string, string>;
  readingPrefs: ReadingPrefs;
  /** Newest-last; the HUD consumes and clears these. */
  rewards: RewardEvent[];

  setLearnerName: (name: string) => void;
  setCurrentLesson: (id: string) => void;
  toggleBookmark: (lessonId: string) => void;
  setNote: (lessonId: string, text: string) => void;
  setReadingPrefs: (patch: Partial<ReadingPrefs>) => void;

  completeLesson: (lesson: Lesson, track?: Track) => void;
  uncompleteLesson: (lessonId: string) => void;
  answerQuiz: (blockId: string, correct: boolean, basePoints?: number) => void;
  recordPractice: (
    itemId: string,
    correct: boolean,
    basePoints?: number,
  ) => void;
  recordGrade: (
    exerciseId: string,
    result: GradeResult,
    basePoints?: number,
  ) => void;

  clearRewards: () => void;
  resetProgress: () => void;
}

let rewardSeq = 0;
function reward(
  kind: RewardEvent["kind"],
  label: string,
  xp: number,
): RewardEvent {
  return { id: ++rewardSeq, kind, label, xp };
}

export const useLearnStore = create<LearnState>()(
  persist(
    (set, get) => ({
      ...EMPTY_PROGRESS,
      learnerName: "",
      currentLessonId: "",
      bookmarks: [],
      notes: {},
      readingPrefs: DEFAULT_READING_PREFS,
      rewards: [],

      setLearnerName: (name) => set({ learnerName: name.slice(0, 60) }),
      setCurrentLesson: (id) => set({ currentLessonId: id }),

      setReadingPrefs: (patch) =>
        set((s) => ({ readingPrefs: { ...s.readingPrefs, ...patch } })),

      toggleBookmark: (lessonId) =>
        set((s) => ({
          bookmarks: s.bookmarks.includes(lessonId)
            ? s.bookmarks.filter((x) => x !== lessonId)
            : [...s.bookmarks, lessonId],
        })),

      setNote: (lessonId, text) =>
        set((s) => ({ notes: { ...s.notes, [lessonId]: text } })),

      completeLesson: (lesson, track) =>
        set((s) => {
          if (s.completedLessons[lesson.id]) return {};

          const completedLessons = {
            ...s.completedLessons,
            [lesson.id]: new Date().toISOString(),
          };
          const earned = lessonXp(lesson);
          const rewards = [
            ...s.rewards,
            reward("lesson", lesson.title, earned),
          ];
          let xp = s.xp + earned;
          let trackBonuses = s.trackBonuses;

          // The bonus lands on the lesson that finishes the track, so the
          // celebration happens at the moment it's earned rather than the
          // next time the roadmap is opened.
          if (
            track &&
            !s.trackBonuses.includes(track.id) &&
            track.lessons.every((l) => completedLessons[l.id])
          ) {
            const bonus = trackBonusXp();
            xp += bonus;
            trackBonuses = [...s.trackBonuses, track.id];
            rewards.push(reward("track", `${track.title} complete`, bonus));
          }

          const streak = touchStreak(s, dayKey());
          if (streak.advanced && streak.streak > 1) {
            rewards.push(reward("streak", `${streak.streak}-day streak`, 0));
          }

          return {
            completedLessons,
            xp,
            trackBonuses,
            rewards,
            streak: streak.streak,
            longestStreak: streak.longestStreak,
            lastActiveDay: streak.lastActiveDay,
          };
        }),

      /**
       * Un-completing reclaims the lesson's XP so the two actions are
       * symmetric. It does not reclaim a track bonus — that would let a
       * complete/uncomplete cycle farm the bonus repeatedly, and the id stays
       * in `trackBonuses` precisely to make the award one-time.
       */
      uncompleteLesson: (lessonId) =>
        set((s) => {
          if (!s.completedLessons[lessonId]) return {};
          const completedLessons = { ...s.completedLessons };
          delete completedLessons[lessonId];
          return { completedLessons };
        }),

      answerQuiz: (blockId, correct, basePoints) =>
        set((s) => {
          const prior: QuizRecord = s.quizzes[blockId] ?? {
            correct: false,
            attempts: 0,
            xp: 0,
          };
          const attempts = prior.attempts + 1;
          const earnable = quizXp(attempts, correct, basePoints);
          // Only the increase is paid — a second correct answer after a first
          // one adds nothing.
          const delta = Math.max(0, earnable - prior.xp);

          const streak = touchStreak(s, dayKey());
          return {
            quizzes: {
              ...s.quizzes,
              [blockId]: {
                correct: prior.correct || correct,
                attempts,
                xp: Math.max(prior.xp, earnable),
              },
            },
            xp: s.xp + delta,
            rewards: delta > 0 ? [...s.rewards, reward("quiz", "Correct", delta)] : s.rewards,
            streak: streak.streak,
            longestStreak: streak.longestStreak,
            lastActiveDay: streak.lastActiveDay,
          };
        }),

      /**
       * A drill or flashcard answered — in a lesson or in the review session.
       *
       * Same paid-once rule as the quizzes, and the same reason for it. The
       * extra job here is the Leitner box: a correct answer promotes the item
       * so it rests longer, a wrong one drops it to box 1 so it comes straight
       * back round.
       */
      recordPractice: (itemId, correct, basePoints) =>
        set((s) => {
          const prior: PracticeRecord = s.practice[itemId] ?? {
            correct: false,
            attempts: 0,
            xp: 0,
            box: 1,
            reviewedAt: "",
          };
          const earnable = practiceXp(correct, basePoints);
          const delta = Math.max(0, earnable - prior.xp);

          const record: PracticeRecord = {
            correct,
            attempts: prior.attempts + 1,
            xp: Math.max(prior.xp, earnable),
            box: nextBox(prior.box, correct),
            reviewedAt: new Date().toISOString(),
          };

          const streak = touchStreak(s, dayKey());
          return {
            practice: { ...s.practice, [itemId]: record },
            xp: s.xp + delta,
            rewards:
              delta > 0
                ? [...s.rewards, reward("practice", "Drill cleared", delta)]
                : s.rewards,
            streak: streak.streak,
            longestStreak: streak.longestStreak,
            lastActiveDay: streak.lastActiveDay,
          };
        }),

      recordGrade: (exerciseId, result, basePoints) =>
        set((s) => {
          const prior = s.exercises[exerciseId];
          const attempts = (prior?.attempts ?? 0) + 1;
          const earnable = exerciseXp(result.percent, basePoints);
          const delta = Math.max(0, earnable - (prior?.xp ?? 0));

          // The transcript keeps the *best* attempt. Resubmitting after
          // feedback is the intended workflow, and a worse retry should not
          // erase a better grade.
          const keepPrior = prior && prior.percent >= result.percent;
          const record: ExerciseRecord = {
            percent: keepPrior ? prior.percent : result.percent,
            letter: keepPrior ? prior.letter : result.letter,
            gradePoints: keepPrior ? prior.gradePoints : result.gradePoints,
            attempts,
            xp: Math.max(prior?.xp ?? 0, earnable),
            gradedAt: new Date().toISOString(),
            gradedBy: result.gradedBy ?? prior?.gradedBy,
          };

          const streak = touchStreak(s, dayKey());
          return {
            exercises: { ...s.exercises, [exerciseId]: record },
            xp: s.xp + delta,
            rewards:
              delta > 0
                ? [...s.rewards, reward("exercise", `Graded ${result.letter}`, delta)]
                : s.rewards,
            streak: streak.streak,
            longestStreak: streak.longestStreak,
            lastActiveDay: streak.lastActiveDay,
          };
        }),

      clearRewards: () => set({ rewards: [] }),

      resetProgress: () =>
        set({
          ...EMPTY_PROGRESS,
          rewards: [],
          // Name, bookmarks and notes are the learner's own content, not
          // progress — resetting the course keeps them.
          currentLessonId: get().currentLessonId,
        }),
    }),
    {
      name: "atlas-learn",
      version: 2,
      storage: debouncedLocalStorage(400),
      /**
       * v1 → v2 adds spaced-review records and reader preferences.
       *
       * Additive only. Every v1 key is carried through untouched, because the
       * alternative — a learner opening the app to find their completed lessons
       * and graded practicals gone — is the worst bug this feature could ship.
       */
      migrate: (persisted, version) => {
        const prior = (persisted ?? {}) as Partial<LearnState>;
        if (version >= 2) return prior as LearnState;
        return {
          ...prior,
          practice: prior.practice ?? {},
          readingPrefs: prior.readingPrefs ?? DEFAULT_READING_PREFS,
        } as LearnState;
      },
      partialize: (s) => ({
        completedLessons: s.completedLessons,
        quizzes: s.quizzes,
        exercises: s.exercises,
        practice: s.practice,
        xp: s.xp,
        streak: s.streak,
        longestStreak: s.longestStreak,
        lastActiveDay: s.lastActiveDay,
        trackBonuses: s.trackBonuses,
        learnerName: s.learnerName,
        currentLessonId: s.currentLessonId,
        bookmarks: s.bookmarks,
        notes: s.notes,
        readingPrefs: s.readingPrefs,
      }),
    },
  ),
);
