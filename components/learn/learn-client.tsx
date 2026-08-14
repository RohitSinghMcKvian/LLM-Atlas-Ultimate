"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import {
  Map,
  BookOpen,
  Award,
  Dumbbell,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Roadmap } from "./roadmap";
import { LessonRail } from "./lesson-rail";
import { LessonView, ReadingProgress } from "./lesson-view";
import { XpHud, RewardToasts } from "./xp-hud";

/**
 * The roadmap is the landing view, so it stays in the initial bundle. Practice,
 * the transcript and the certificate are all reachable only by a click, and
 * each carries its own component tree — there is no reason to make the first
 * paint pay for them.
 */
const ViewSkeleton = () => (
  <div
    className="h-96 w-full animate-pulse rounded-2xl border border-border bg-surface-2/40"
    aria-hidden
  />
);

const PracticeView = dynamic(
  () => import("./practice-view").then((m) => m.PracticeView),
  { loading: ViewSkeleton },
);

const TranscriptView = dynamic(
  () => import("./certificate").then((m) => m.TranscriptView),
  { loading: ViewSkeleton },
);

const CertificateDialog = dynamic(
  () => import("./certificate").then((m) => m.CertificateDialog),
);
import {
  FIRST_LESSON,
  TRACKS,
  getLesson,
  getTrack,
  TOTAL_LESSONS,
} from "@/lib/learn/curriculum";
import {
  courseCoverage,
  neighbors,
  type ProgressState,
} from "@/lib/learn/progress";
import { reviewCounts } from "@/lib/learn/practice";
import { useLearnStore } from "@/lib/store/learn-store";
import { announce } from "@/lib/atlas-events";
import { cn } from "@/lib/utils";

type View = "roadmap" | "lesson" | "practice" | "transcript";

const VIEWS: { id: View; label: string; icon: typeof Map }[] = [
  { id: "roadmap", label: "Roadmap", icon: Map },
  { id: "lesson", label: "Lesson", icon: BookOpen },
  { id: "practice", label: "Practice", icon: Dumbbell },
  { id: "transcript", label: "Transcript", icon: Award },
];

/**
 * Atlas Learn.
 *
 * Four views over one persisted progress store: the roadmap (where am I, what
 * next), the reader (the actual work), practice (spaced review of what's already
 * been taught), and the transcript (what I've earned). Everything derived — XP,
 * mastery, review scheduling, eligibility — comes from the pure helpers in
 * `lib/learn/progress` and `lib/learn/practice`, so this component only
 * orchestrates.
 */
export function LearnClient() {
  const [view, setView] = React.useState<View>("roadmap");
  const [railOpen, setRailOpen] = React.useState(true);

  // Subscribing field-by-field rather than to the whole store keeps a keystroke
  // in the notes box from re-rendering the reader's block tree.
  const completedLessons = useLearnStore((s) => s.completedLessons);
  const quizzes = useLearnStore((s) => s.quizzes);
  const exercises = useLearnStore((s) => s.exercises);
  const practice = useLearnStore((s) => s.practice);
  const xp = useLearnStore((s) => s.xp);
  const streak = useLearnStore((s) => s.streak);
  const longestStreak = useLearnStore((s) => s.longestStreak);
  const lastActiveDay = useLearnStore((s) => s.lastActiveDay);
  const trackBonuses = useLearnStore((s) => s.trackBonuses);
  const bookmarks = useLearnStore((s) => s.bookmarks);
  const notes = useLearnStore((s) => s.notes);
  const focus = useLearnStore((s) => s.readingPrefs.focus);
  const storedLessonId = useLearnStore((s) => s.currentLessonId);

  const setCurrentLesson = useLearnStore((s) => s.setCurrentLesson);
  const completeLesson = useLearnStore((s) => s.completeLesson);
  const toggleBookmark = useLearnStore((s) => s.toggleBookmark);
  const setNote = useLearnStore((s) => s.setNote);

  const progress: ProgressState = React.useMemo(
    () => ({
      completedLessons,
      quizzes,
      exercises,
      practice,
      xp,
      streak,
      longestStreak,
      lastActiveDay,
      trackBonuses,
    }),
    [
      completedLessons,
      quizzes,
      exercises,
      practice,
      xp,
      streak,
      longestStreak,
      lastActiveDay,
      trackBonuses,
    ],
  );

  // A persisted id can name a lesson that no longer exists after a curriculum
  // edit; fall back to the first lesson rather than rendering nothing.
  const lesson = getLesson(storedLessonId) ?? FIRST_LESSON;
  const { prev, next } = React.useMemo(
    () => neighbors(TRACKS, lesson.id),
    [lesson.id],
  );
  const coverage = courseCoverage(TRACKS, progress);

  // Only the count that needs a badge — the full pool is rebuilt inside the
  // practice view when a session actually starts.
  const dueCount = React.useMemo(
    () => reviewCounts(TRACKS, progress).missed,
    [progress],
  );

  const openLesson = React.useCallback(
    (id: string) => {
      setCurrentLesson(id);
      setView("lesson");
    },
    [setCurrentLesson],
  );

  // `[` and `]` move between lessons — chosen over the arrow keys, which the
  // reader needs for scrolling, and over j/k, which collide with the palette.
  React.useEffect(() => {
    if (view !== "lesson") return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
      ) {
        return;
      }
      if (e.key === "[" && prev) {
        e.preventDefault();
        openLesson(prev.id);
      } else if (e.key === "]" && next) {
        e.preventDefault();
        openLesson(next.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, prev, next, openLesson]);

  function onComplete() {
    completeLesson(lesson, getTrack(lesson.trackId));
    announce(`${lesson.title} marked complete.`);
  }

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:py-10">
      {view === "lesson" && <ReadingProgress />}
      <RewardToasts />

      <header
        className={cn(
          "mb-6 flex flex-col gap-4 transition-opacity lg:flex-row lg:items-end lg:justify-between",
          view === "lesson" && focus && "opacity-40 hover:opacity-100",
        )}
      >
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            Learn
          </h1>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Beginner to expert in applied LLM engineering — interactive lessons,
            live models, graduate-level graded practicals, and a credential you
            earn.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <XpHud />
          <div
            role="tablist"
            aria-label="Learn views"
            className="inline-flex rounded-xl border border-border bg-surface-2/60 p-0.5"
          >
            {VIEWS.map((v) => {
              const Icon = v.icon;
              return (
                <button
                  key={v.id}
                  role="tab"
                  aria-selected={view === v.id}
                  onClick={() => setView(v.id)}
                  className={cn(
                    "relative inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    view === v.id
                      ? "bg-surface text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  <span className="hidden sm:inline">{v.label}</span>
                  {v.id === "practice" && dueCount > 0 && (
                    <span
                      aria-label={`${dueCount} items to review`}
                      className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-danger text-2xs font-bold text-white"
                    >
                      {dueCount > 9 ? "9+" : dueCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <CertificateDialog
            progress={progress}
            trigger={
              <Button variant="secondary" size="sm">
                <Award className="size-4" />
                <span className="hidden sm:inline">Certificate</span>
              </Button>
            }
          />
        </div>
      </header>

      {view !== "practice" && (
        <div
          className={cn(
            "mb-6 flex items-center gap-3 transition-opacity",
            view === "lesson" && focus && "opacity-40 hover:opacity-100",
          )}
        >
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
            <motion.div
              className="h-full rounded-full bg-action"
              initial={false}
              animate={{ width: `${coverage.percent}%` }}
              transition={{ type: "spring", stiffness: 200, damping: 30 }}
            />
          </div>
          <span className="shrink-0 font-mono text-xs tnum text-muted-foreground">
            {coverage.done} / {TOTAL_LESSONS} · {coverage.percent}%
          </span>
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
        >
          {view === "roadmap" && (
            <Roadmap
              progress={progress}
              bookmarks={bookmarks}
              onOpenLesson={openLesson}
            />
          )}

          {view === "practice" && (
            <PracticeView progress={progress} onOpenLesson={openLesson} />
          )}

          {view === "transcript" && <TranscriptView progress={progress} />}

          {view === "lesson" && (
            <div
              className={cn(
                "grid gap-6",
                railOpen ? "lg:grid-cols-[16rem_minmax(0,1fr)]" : "lg:grid-cols-1",
              )}
            >
              {railOpen && (
                <div
                  className={cn(
                    "hidden transition-opacity lg:block",
                    focus && "opacity-30 hover:opacity-100",
                  )}
                >
                  <div className="sticky top-20 space-y-2">
                    <LessonRail
                      currentLessonId={lesson.id}
                      progress={progress}
                      bookmarks={bookmarks}
                      onOpenLesson={openLesson}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => setRailOpen(false)}
                    >
                      <PanelLeftClose className="size-3.5" /> Hide contents
                    </Button>
                  </div>
                </div>
              )}

              <div className="min-w-0">
                {!railOpen && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mb-3 hidden lg:inline-flex"
                    onClick={() => setRailOpen(true)}
                  >
                    <PanelLeft className="size-3.5" /> Show contents
                  </Button>
                )}
                <LessonView
                  lesson={lesson}
                  done={Boolean(completedLessons[lesson.id])}
                  bookmarked={bookmarks.includes(lesson.id)}
                  note={notes[lesson.id] ?? ""}
                  prev={prev}
                  next={next}
                  onComplete={onComplete}
                  onToggleBookmark={() => toggleBookmark(lesson.id)}
                  onNote={(text) => setNote(lesson.id, text)}
                  onNavigate={openLesson}
                />
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
