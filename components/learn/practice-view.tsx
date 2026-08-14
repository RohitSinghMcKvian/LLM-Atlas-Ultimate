"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  Check,
  CircleCheck,
  CircleX,
  Dumbbell,
  Flame,
  Play,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RichText } from "./rich-text";
import { PredictBlock, SortBlock } from "./practice-blocks";
import {
  buildSession,
  reviewCounts,
  type ReviewItem,
  type ReviewReason,
} from "@/lib/learn/practice";
import { TRACKS } from "@/lib/learn/curriculum";
import type { ProgressState } from "@/lib/learn/progress";
import { useLearnStore } from "@/lib/store/learn-store";
import { announce } from "@/lib/atlas-events";
import { cn } from "@/lib/utils";

/**
 * The review session.
 *
 * Everything here has already been taught — nothing enters the pool until its
 * lesson is complete or the learner has attempted it in place. That rule is the
 * difference between a practice surface and a spoiler machine.
 *
 * Items you got wrong come back first, then things you've never tried, then
 * things you got right on the second attempt, then everything else on a
 * cooldown. Ordering by weakness is the entire value; a random shuffle would
 * spend most of a session on the cards you already know.
 */

const REASON_META: Record<
  ReviewReason,
  { label: string; tint: string; ring: string }
> = {
  missed: {
    label: "Missed",
    tint: "text-danger",
    ring: "border-danger/40 bg-danger/[0.07]",
  },
  new: {
    label: "New",
    tint: "text-action",
    ring: "border-action/40 bg-action/[0.07]",
  },
  shaky: {
    label: "Shaky",
    tint: "text-amber",
    ring: "border-amber/40 bg-amber/[0.07]",
  },
  due: {
    label: "Due",
    tint: "text-muted-foreground",
    ring: "border-border bg-surface-2/50",
  },
};

const SESSION_SIZE = 12;

export function PracticeView({
  progress,
  onOpenLesson,
}: {
  progress: ProgressState;
  onOpenLesson: (lessonId: string) => void;
}) {
  const [session, setSession] = React.useState<ReviewItem[] | null>(null);
  const [at, setAt] = React.useState(0);
  const [results, setResults] = React.useState<Record<string, boolean>>({});

  const counts = React.useMemo(
    () => reviewCounts(TRACKS, progress),
    [progress],
  );

  function start() {
    // Snapshot the session once. Rebuilding it from live progress on every
    // answer would reorder the deck underneath the learner as their records
    // change — the card they just cleared would jump out of the queue mid-run.
    const next = buildSession(TRACKS, progress, SESSION_SIZE);
    setSession(next);
    setAt(0);
    setResults({});
    announce(`Review session started, ${next.length} items.`);
  }

  if (!session) {
    return (
      <PracticeStart counts={counts} onStart={start} />
    );
  }

  if (session.length === 0) {
    return (
      <Empty onBack={() => setSession(null)}>
        Nothing is due. Finish a lesson or two and this fills up on its own.
      </Empty>
    );
  }

  if (at >= session.length) {
    return (
      <SessionSummary
        session={session}
        results={results}
        onAgain={start}
        onExit={() => setSession(null)}
        onOpenLesson={onOpenLesson}
      />
    );
  }

  const item = session[at];
  const streak = (() => {
    let n = 0;
    for (let i = at - 1; i >= 0; i--) {
      if (results[session[i].id]) n += 1;
      else break;
    }
    return n;
  })();

  return (
    <div className="mx-auto max-w-2xl">
      {/* Session chrome */}
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={() => setSession(null)}
          aria-label="Leave the session"
          className="rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>

        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
          <motion.div
            className="h-full rounded-full bg-action"
            animate={{ width: `${(at / session.length) * 100}%` }}
            transition={{ type: "spring", stiffness: 200, damping: 28 }}
          />
        </div>

        <span className="shrink-0 font-mono text-2xs tnum text-muted-foreground">
          {at + 1}/{session.length}
        </span>

        {streak >= 2 && (
          <motion.span
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber/40 bg-amber/10 px-2 py-0.5 text-2xs font-semibold text-amber"
          >
            <Flame className="size-3" /> {streak}
          </motion.span>
        )}
      </div>

      {/* Provenance — a review card that can't say where it came from is a dead end. */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-2xs">
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 font-semibold",
            REASON_META[item.reason].ring,
            REASON_META[item.reason].tint,
          )}
        >
          {REASON_META[item.reason].label}
        </span>
        <button
          onClick={() => onOpenLesson(item.lessonId)}
          className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-action"
        >
          <BookOpen className="size-3" />
          {item.lessonTitle}
        </button>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={item.id}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.22 }}
        >
          <PracticeCard
            item={item}
            onDone={(correct) => {
              setResults((r) => ({ ...r, [item.id]: correct }));
              setAt((n) => n + 1);
            }}
          />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PracticeCard({
  item,
  onDone,
}: {
  item: ReviewItem;
  onDone: (correct: boolean) => void;
}) {
  if (item.kind === "term" && item.term) {
    return <ReviewTerm item={item} onDone={onDone} />;
  }
  if (item.kind === "quiz" && item.block?.type === "quiz") {
    return <ReviewQuiz block={item.block} onDone={onDone} />;
  }
  // Predict and sort already own their checking and their store writes, so the
  // review session reuses them wholesale rather than reimplementing both.
  if (item.block?.type === "predict") {
    return (
      <div>
        <PredictBlock block={item.block} />
        <Button
          variant="secondary"
          size="sm"
          className="mt-3 w-full"
          onClick={() => onDone(true)}
        >
          Next <ArrowRight className="size-3.5" />
        </Button>
      </div>
    );
  }
  if (item.block?.type === "sort") {
    return (
      <div>
        <SortBlock block={item.block} />
        <Button
          variant="secondary"
          size="sm"
          className="mt-3 w-full"
          onClick={() => onDone(true)}
        >
          Next <ArrowRight className="size-3.5" />
        </Button>
      </div>
    );
  }
  return null;
}

/**
 * A quiz, in review.
 *
 * Not the lesson's `QuizBlock`: that one writes to the quiz ledger, which has no
 * Leitner box, so a card answered there would never advance its cooldown. This
 * writes to the practice ledger and adds the keyboard handling a deck of twelve
 * cards actually needs.
 */
function ReviewQuiz({
  block,
  onDone,
}: {
  block: Extract<NonNullable<ReviewItem["block"]>, { type: "quiz" }>;
  onDone: (correct: boolean) => void;
}) {
  const recordPractice = useLearnStore((s) => s.recordPractice);
  const answerQuiz = useLearnStore((s) => s.answerQuiz);
  const [picked, setPicked] = React.useState<number[]>([]);
  const [checked, setChecked] = React.useState(false);

  const answers = React.useMemo(
    () => (Array.isArray(block.answer) ? block.answer : [block.answer]),
    [block.answer],
  );
  const multi = answers.length > 1;

  const correct =
    picked.length === answers.length && picked.every((i) => answers.includes(i));

  const toggle = React.useCallback(
    (i: number) => {
      if (checked) return;
      setPicked((p) =>
        multi
          ? p.includes(i)
            ? p.filter((x) => x !== i)
            : [...p, i]
          : [i],
      );
    },
    [checked, multi],
  );

  const check = React.useCallback(() => {
    if (picked.length === 0) return;
    setChecked(true);
    // Recorded in both ledgers: the practice one carries the review schedule,
    // and the quiz one is what the lesson page and mastery figures read.
    recordPractice(block.id, correct);
    answerQuiz(block.id, correct, block.points);
    announce(correct ? "Correct." : "Not correct.");
  }, [picked.length, correct, block.id, block.points, recordPractice, answerQuiz]);

  // Number keys pick, Enter checks then advances. Twelve cards with a mouse is
  // a chore; twelve cards on the home row is a drill.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
      ) {
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (checked) onDone(correct);
        else check();
        return;
      }
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= block.options.length) {
        e.preventDefault();
        toggle(n - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [checked, correct, check, onDone, toggle, block.options.length]);

  return (
    <div className="rounded-2xl border border-border bg-surface/60 p-4 sm:p-5">
      <p className="text-base font-medium leading-relaxed">{block.question}</p>
      {multi && (
        <p className="mt-1 text-2xs text-muted-foreground">
          Select all that apply.
        </p>
      )}

      <ul className="mt-3 space-y-1.5">
        {block.options.map((opt, i) => {
          const isPicked = picked.includes(i);
          const isAnswer = answers.includes(i);
          return (
            <li key={opt}>
              <button
                onClick={() => toggle(i)}
                disabled={checked}
                aria-pressed={isPicked}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors",
                  !checked &&
                    (isPicked
                      ? "border-action/50 bg-action/[0.08]"
                      : "border-border bg-surface-2/40 hover:border-border-strong"),
                  checked &&
                    isAnswer &&
                    "border-success/45 bg-success/[0.08]",
                  checked &&
                    !isAnswer &&
                    isPicked &&
                    "border-danger/45 bg-danger/[0.08]",
                  checked && !isAnswer && !isPicked && "border-border opacity-60",
                )}
              >
                <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded border border-border-strong font-mono text-2xs font-bold text-muted-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 leading-snug">{opt}</span>
                {checked && isAnswer && (
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
                )}
                {checked && !isAnswer && isPicked && (
                  <CircleX className="mt-0.5 size-4 shrink-0 text-danger" />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {!checked ? (
        <Button
          variant="primary"
          size="sm"
          className="mt-3 w-full"
          disabled={picked.length === 0}
          onClick={check}
        >
          <Check className="size-3.5" /> Check
        </Button>
      ) : (
        <>
          <div
            className={cn(
              "mt-3 rounded-xl border px-3 py-2.5",
              correct
                ? "border-success/35 bg-success/[0.06]"
                : "border-danger/35 bg-danger/[0.06]",
            )}
          >
            <p
              className={cn(
                "mb-1 text-2xs font-semibold uppercase tracking-wider",
                correct ? "text-success" : "text-danger",
              )}
            >
              {correct ? "Correct" : "Not this time"}
            </p>
            <RichText className="text-xs leading-relaxed text-foreground/85">
              {block.explain}
            </RichText>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3 w-full"
            onClick={() => onDone(correct)}
          >
            Next <ArrowRight className="size-3.5" />
          </Button>
        </>
      )}

      <p className="mt-2 text-center text-2xs text-muted-foreground">
        <kbd className="rounded border border-border bg-surface-2 px-1">1</kbd>–
        <kbd className="rounded border border-border bg-surface-2 px-1">
          {block.options.length}
        </kbd>{" "}
        to pick ·{" "}
        <kbd className="rounded border border-border bg-surface-2 px-1">
          Enter
        </kbd>{" "}
        to {checked ? "continue" : "check"}
      </p>
    </div>
  );
}

function ReviewTerm({
  item,
  onDone,
}: {
  item: ReviewItem;
  onDone: (correct: boolean) => void;
}) {
  const recordPractice = useLearnStore((s) => s.recordPractice);
  const [flipped, setFlipped] = React.useState(false);
  const term = item.term!;

  function score(knew: boolean) {
    recordPractice(item.id, knew);
    onDone(knew);
  }

  return (
    <div className="rounded-2xl border border-border bg-surface/60 p-4 sm:p-5">
      <p className="mb-3 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        Define this term
      </p>

      <button
        onClick={() => setFlipped((f) => !f)}
        aria-expanded={flipped}
        className="grid min-h-[9rem] w-full place-items-center rounded-2xl border border-accent/30 bg-action/10 px-4 py-6 text-center transition-colors hover:border-accent/50"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={flipped ? "back" : "front"}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
            className="block"
          >
            {flipped ? (
              <span className="text-sm leading-relaxed text-foreground/90">
                {term.definition}
              </span>
            ) : (
              <>
                <span className="block font-mono text-xl font-semibold text-action">
                  {term.term}
                </span>
                <span className="mt-1.5 block text-2xs text-muted-foreground">
                  say it out loud, then reveal
                </span>
              </>
            )}
          </motion.span>
        </AnimatePresence>
      </button>

      {flipped && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="ghost" size="sm" onClick={() => score(false)}>
            <CircleX className="size-3.5 text-danger" /> Not yet
          </Button>
          <Button variant="primary" size="sm" onClick={() => score(true)}>
            <CircleCheck className="size-3.5" /> Knew it
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function PracticeStart({
  counts,
  onStart,
}: {
  counts: Record<ReviewReason, number> & { total: number };
  onStart: () => void;
}) {
  const ready = counts.total > 0;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="gradient-border overflow-hidden p-[1px]">
        <div className="relative overflow-hidden rounded-[calc(var(--radius)-1px)] bg-surface/80 p-6 sm:p-8">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-70"
          />
          <div className="relative text-center">
            <span className="mx-auto mb-3 grid size-11 place-items-center rounded-2xl bg-action text-action-foreground">
              <Dumbbell className="size-5" />
            </span>
            <h2 className="font-display text-2xl font-semibold tracking-tight text-balance">
              {ready ? "Ready to review" : "Nothing due yet"}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              {ready
                ? "Everything below has already been taught. Weakest items first — the ones you missed come back before the ones you nailed."
                : "Complete a lesson and its quizzes, drills and key terms enter the review pool automatically."}
            </p>

            {ready && (
              <>
                <ul className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(["missed", "new", "shaky", "due"] as ReviewReason[]).map(
                    (r) => (
                      <li
                        key={r}
                        className={cn(
                          "rounded-xl border px-3 py-2",
                          REASON_META[r].ring,
                        )}
                      >
                        <p
                          className={cn(
                            "font-display text-xl font-bold tnum",
                            REASON_META[r].tint,
                          )}
                        >
                          {counts[r]}
                        </p>
                        <p className="text-2xs text-muted-foreground">
                          {REASON_META[r].label}
                        </p>
                      </li>
                    ),
                  )}
                </ul>

                <Button
                  variant="primary"
                  size="lg"
                  className="mt-5"
                  onClick={onStart}
                >
                  <Play className="size-4" />
                  Start {Math.min(SESSION_SIZE, counts.total)}-card session
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <p className="mt-4 flex items-start gap-2 rounded-xl border border-border bg-surface-2/40 px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground">
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-action" />
        <span>
          Cards you get right rest longer before returning — one day, then three,
          then a week, then a fortnight. Cards you miss come straight back.
        </span>
      </p>
    </div>
  );
}

function SessionSummary({
  session,
  results,
  onAgain,
  onExit,
  onOpenLesson,
}: {
  session: ReviewItem[];
  results: Record<string, boolean>;
  onAgain: () => void;
  onExit: () => void;
  onOpenLesson: (id: string) => void;
}) {
  const right = session.filter((i) => results[i.id]).length;
  const missed = session.filter((i) => results[i.id] === false);
  const pct = Math.round((right / session.length) * 100);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="overflow-hidden rounded-3xl border border-border bg-surface/50">
        <div className="relative overflow-hidden border-b border-border px-6 py-7 text-center">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-60"
          />
          <div className="relative">
            <p className="font-display text-5xl font-bold tnum">
              {right}
              <span className="text-2xl text-muted-foreground">
                /{session.length}
              </span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {pct === 100
                ? "Clean run. Every one of these rests longer now."
                : pct >= 70
                  ? "Solid. The misses come back sooner than the rest."
                  : "Worth re-reading the lessons below before the next run."}
            </p>
          </div>
        </div>

        {missed.length > 0 && (
          <div className="border-b border-border px-5 py-4">
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-amber">
              Revisit these
            </p>
            <ul className="space-y-1">
              {[...new Set(missed.map((m) => m.lessonId))].map((lessonId) => {
                const first = missed.find((m) => m.lessonId === lessonId)!;
                const n = missed.filter((m) => m.lessonId === lessonId).length;
                return (
                  <li key={lessonId}>
                    <button
                      onClick={() => onOpenLesson(lessonId)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface-2/60"
                    >
                      <BookOpen className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        {first.lessonTitle}
                      </span>
                      <span className="shrink-0 font-mono text-2xs tnum text-amber">
                        {n} missed
                      </span>
                      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-2 px-5 py-4">
          <Button variant="primary" size="sm" onClick={onAgain}>
            <RotateCcw className="size-3.5" /> Another session
          </Button>
          <Button variant="ghost" size="sm" onClick={onExit}>
            Done for now
          </Button>
        </div>
      </div>
    </div>
  );
}

function Empty({
  children,
  onBack,
}: {
  children: React.ReactNode;
  onBack: () => void;
}) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-border bg-surface/50 px-6 py-10 text-center">
      <p className="text-sm text-muted-foreground">{children}</p>
      <Button variant="ghost" size="sm" className="mt-3" onClick={onBack}>
        Back
      </Button>
    </div>
  );
}
