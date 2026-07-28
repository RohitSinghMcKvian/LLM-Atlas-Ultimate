/**
 * Atlas Learn — spaced review.
 *
 * Builds a practice session out of material the learner has already met. The
 * scheduling is Leitner, not SM-2: five buckets, a fixed cooldown per bucket,
 * right answers promote and wrong answers reset to one. SM-2's ease factors
 * need a decade of reviews to say anything useful, and this is a course
 * somebody finishes in a fortnight — the extra machinery would be decoration.
 *
 * Pure module: no React, no browser globals, and `now` is always a parameter so
 * the schedule is testable without mocking the clock.
 */

import type { Block, KeyTerm, Lesson, Track } from "./types";
import { MAX_BOX, type PracticeRecord, type ProgressState } from "./progress";

export type ReviewKind = "quiz" | "predict" | "sort" | "term";

/**
 * Why an item surfaced. Shown on the card, because "you got this wrong in
 * March" is more motivating than an unexplained question.
 */
export type ReviewReason = "missed" | "new" | "shaky" | "due";

export interface ReviewItem {
  /** The block id, or `term:<lessonId>:<slug>` for a key-term flashcard. */
  id: string;
  kind: ReviewKind;
  lessonId: string;
  lessonTitle: string;
  trackId: string;
  /** The authored block, rendered by the same component the lesson uses. */
  block?: Block;
  /** Set when `kind` is `"term"`. */
  term?: KeyTerm;
  reason: ReviewReason;
  record?: PracticeRecord;
}

/**
 * Days an item rests before it is due again, indexed by Leitner box.
 *
 * Index 0 is unused — boxes are 1-based. Box 1 has no cooldown at all: an item
 * you just got wrong should be answerable again in the same session.
 */
export const BOX_COOLDOWN_DAYS = [0, 0, 1, 3, 7, 14];

/** Ordering weight per reason. Lower comes first. */
const REASON_ORDER: Record<ReviewReason, number> = {
  missed: 0,
  new: 1,
  shaky: 2,
  due: 3,
};

const DAY_MS = 86_400_000;

export function slugTerm(term: string): string {
  return term
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** Stable flashcard id. Namespaced so it can never collide with a block id. */
export function termId(lessonId: string, term: string): string {
  return `term:${lessonId}:${slugTerm(term)}`;
}

function isDue(record: PracticeRecord, now: number): boolean {
  const box = Math.min(MAX_BOX, Math.max(1, record.box));
  const rest = BOX_COOLDOWN_DAYS[box] ?? 0;
  if (rest === 0) return true;
  const last = Date.parse(record.reviewedAt);
  // An unparseable timestamp is corrupt state, not a reason to hide the card.
  if (Number.isNaN(last)) return true;
  return now - last >= rest * DAY_MS;
}

/**
 * Everything the learner is eligible to review.
 *
 * Eligibility is the important rule: an item only enters the pool once its
 * lesson is complete, or once the learner has already attempted it in place.
 * Without that, Practice becomes a spoiler generator for lessons nobody has
 * opened yet.
 */
export function reviewPool(
  tracks: Track[],
  state: ProgressState,
  now = Date.now(),
): ReviewItem[] {
  const pool: ReviewItem[] = [];

  for (const track of tracks) {
    for (const lesson of track.lessons) {
      const lessonDone = Boolean(state.completedLessons[lesson.id]);

      for (const block of lesson.blocks) {
        const kind = reviewKindOf(block);
        if (!kind) continue;

        const id = (block as { id: string }).id;
        const record =
          kind === "quiz"
            ? quizAsPractice(state, id)
            : state.practice[id];
        const attempted = Boolean(record?.attempts);
        if (!lessonDone && !attempted) continue;

        const reason = reasonFor(record, now);
        if (!reason) continue;

        pool.push({
          id,
          kind,
          lessonId: lesson.id,
          lessonTitle: lesson.title,
          trackId: track.id,
          block,
          reason,
          record,
        });
      }

      // Flashcards only come from lessons that have actually been read — a
      // definition is not a review until it has been an explanation.
      if (!lessonDone) continue;
      for (const term of lesson.keyTerms ?? []) {
        const id = termId(lesson.id, term.term);
        const record = state.practice[id];
        const reason = reasonFor(record, now);
        if (!reason) continue;
        pool.push({
          id,
          kind: "term",
          lessonId: lesson.id,
          lessonTitle: lesson.title,
          trackId: track.id,
          term,
          reason,
          record,
        });
      }
    }
  }

  return pool;
}

/**
 * Order the pool weakest-first and cut it to a session.
 *
 * The pool arrives in curriculum order, and `Array.prototype.sort` is stable,
 * so ties resolve to "whichever the course taught first" — which is also the
 * order the ideas build in.
 */
export function buildSession(
  tracks: Track[],
  state: ProgressState,
  limit = 12,
  now = Date.now(),
): ReviewItem[] {
  const pool = reviewPool(tracks, state, now);
  const ordered = [...pool].sort((a, b) => {
    const byReason = REASON_ORDER[a.reason] - REASON_ORDER[b.reason];
    if (byReason !== 0) return byReason;
    return lastSeen(a) - lastSeen(b);
  });
  return ordered.slice(0, Math.max(0, limit));
}

/** How many items are waiting, by reason — drives the Practice view's header. */
export function reviewCounts(
  tracks: Track[],
  state: ProgressState,
  now = Date.now(),
): Record<ReviewReason, number> & { total: number } {
  const counts = { missed: 0, new: 0, shaky: 0, due: 0, total: 0 };
  for (const item of reviewPool(tracks, state, now)) {
    counts[item.reason] += 1;
    counts.total += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------

function reviewKindOf(block: Block): ReviewKind | null {
  if (block.type === "quiz") return "quiz";
  if (block.type === "predict") return "predict";
  if (block.type === "sort") return "sort";
  return null;
}

/**
 * Quizzes are answered in lessons and stored in `quizzes`, but reviewed here.
 * Projecting the older record into the practice shape keeps one scheduler
 * rather than two, and avoids migrating historical quiz answers.
 */
function quizAsPractice(
  state: ProgressState,
  id: string,
): PracticeRecord | undefined {
  const q = state.quizzes[id];
  if (!q) return state.practice[id];
  const p = state.practice[id];
  // A quiz answered in the lesson and later drilled in review has two records;
  // the review one carries the schedule, so it wins where present.
  return {
    correct: p?.correct ?? q.correct,
    attempts: (p?.attempts ?? 0) + q.attempts,
    xp: q.xp,
    box: p?.box ?? (q.correct ? (q.attempts <= 1 ? 2 : 1) : 1),
    reviewedAt: p?.reviewedAt ?? "",
  };
}

function reasonFor(
  record: PracticeRecord | undefined,
  now: number,
): ReviewReason | null {
  if (!record || record.attempts === 0) return "new";
  if (!record.correct) return "missed";
  if (!isDue(record, now)) return null;
  return record.attempts > 1 ? "shaky" : "due";
}

function lastSeen(item: ReviewItem): number {
  const at = item.record?.reviewedAt;
  if (!at) return 0;
  const t = Date.parse(at);
  return Number.isNaN(t) ? 0 : t;
}

/** Convenience for the UI: does this lesson still have anything to drill? */
export function lessonHasReview(
  lesson: Lesson,
  state: ProgressState,
  now = Date.now(),
): boolean {
  for (const block of lesson.blocks) {
    const kind = reviewKindOf(block);
    if (!kind) continue;
    const id = (block as { id: string }).id;
    const record =
      kind === "quiz" ? quizAsPractice(state, id) : state.practice[id];
    if (reasonFor(record, now)) return true;
  }
  return false;
}
