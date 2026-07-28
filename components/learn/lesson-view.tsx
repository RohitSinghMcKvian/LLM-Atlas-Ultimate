"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  Clock,
  Target,
  NotebookPen,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BlockView, isWideBlock, headingId } from "./blocks";
import { LessonToc, type TocEntry } from "./lesson-toc";
import { ReadingPrefsMenu, MEASURE_CLASS, SIZE_CLASS } from "./reading-prefs";
import { ReferenceList } from "./references";
import { getTrack, lessonPosition } from "@/lib/learn/curriculum";
import { DIFFICULTY_LABEL, type Accent, type Lesson } from "@/lib/learn/types";
import { useLearnStore } from "@/lib/store/learn-store";
import { cn } from "@/lib/utils";

/**
 * The lesson reader.
 *
 * Two rules shape the layout. Prose stays at a reading measure, because a
 * full-bleed technical paragraph on a wide display is measurably harder to read
 * and this is a page people sit with for forty minutes. Diagrams do not — the
 * previous version squeezed a ten-column attention matrix into 68 characters,
 * which was the single worst thing about it. Blocks opt into the wider track via
 * `isWideBlock`, so the decision lives with the block type rather than here.
 */

const ACCENT_GLOW: Record<Accent, string> = {
  cyan: "from-cyan/[0.16]",
  violet: "from-violet/[0.16]",
  amber: "from-amber/[0.14]",
};

export function LessonView({
  lesson,
  done,
  bookmarked,
  note,
  prev,
  next,
  onComplete,
  onToggleBookmark,
  onNote,
  onNavigate,
}: {
  lesson: Lesson;
  done: boolean;
  bookmarked: boolean;
  note: string;
  prev?: Lesson;
  next?: Lesson;
  onComplete: () => void;
  onToggleBookmark: () => void;
  onNote: (text: string) => void;
  onNavigate: (lessonId: string) => void;
}) {
  const prefs = useLearnStore((s) => s.readingPrefs);
  const reduced = useReducedMotion();
  const track = getTrack(lesson.trackId);

  const entries: TocEntry[] = React.useMemo(
    () =>
      lesson.blocks
        .filter((b): b is Extract<typeof b, { type: "h" }> => b.type === "h")
        .map((b) => ({ id: b.id ?? headingId(b.text), text: b.text })),
    [lesson],
  );

  const indexInTrack = track
    ? track.lessons.findIndex((l) => l.id === lesson.id) + 1
    : 0;

  const topRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    // Changing lesson without scrolling back leaves the reader halfway down the
    // next lesson's body.
    topRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [lesson.id]);

  const measure = MEASURE_CLASS[prefs.measure];

  return (
    <>
      <StickyLessonBar
        lesson={lesson}
        done={done}
        next={next}
        onComplete={onComplete}
        onNavigate={onNavigate}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_16rem]">
        <div ref={topRef} className="min-w-0 scroll-mt-24">
          <article className="overflow-hidden rounded-3xl border border-border bg-surface/40">
            {/* Hero — the app's own aurora language, finally used here. */}
            <header className="relative overflow-hidden border-b border-border px-5 pb-6 pt-7 sm:px-8">
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent",
                  ACCENT_GLOW[track?.accent ?? "cyan"],
                )}
              />
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-grid-fade opacity-40"
              />

              <div className="relative">
                <nav
                  aria-label="Breadcrumb"
                  className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs"
                >
                  <span className="font-semibold uppercase tracking-[0.16em] text-cyan">
                    {track?.title}
                  </span>
                  {indexInTrack > 0 && (
                    <>
                      <span aria-hidden className="text-muted-foreground/50">
                        /
                      </span>
                      <span className="text-muted-foreground">
                        Lesson {indexInTrack} of {track?.lessons.length}
                      </span>
                    </>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    <ReadingPrefsMenu />
                    <button
                      onClick={onToggleBookmark}
                      aria-pressed={bookmarked}
                      aria-label={
                        bookmarked ? "Remove bookmark" : "Bookmark this lesson"
                      }
                      className="rounded-lg border border-border bg-surface-2/60 p-1.5 transition-colors hover:border-border-strong"
                    >
                      <Bookmark
                        className={cn(
                          "size-3.5",
                          bookmarked
                            ? "fill-amber text-amber"
                            : "text-muted-foreground",
                        )}
                      />
                    </button>
                  </span>
                </nav>

                <h1 className="font-display text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                  {lesson.title}
                </h1>
                <p className="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-muted-foreground">
                  {lesson.summary}
                </p>

                <ul className="mt-4 flex flex-wrap items-center gap-2 text-2xs">
                  <Chip>
                    <Clock className="size-3" />
                    {lesson.minutes} min
                  </Chip>
                  <Chip>{DIFFICULTY_LABEL[lesson.difficulty]}</Chip>
                  <Chip>
                    <Sparkles className="size-3 text-cyan" />
                    {
                      lesson.blocks.filter((b) =>
                        ["viz", "figure", "annotated", "live"].includes(b.type),
                      ).length
                    }{" "}
                    interactive
                  </Chip>
                  {done && (
                    <li className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 font-medium text-success">
                      <Check className="size-3" /> Complete
                    </li>
                  )}
                </ul>
              </div>
            </header>

            {/* Objectives */}
            <div className="px-5 pt-6 sm:px-8">
              <div
                className={cn(
                  "rounded-2xl border border-cyan/25 bg-gradient-primary-soft p-4",
                  measure,
                )}
              >
                <p className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.14em] text-cyan">
                  <Target className="size-3.5" />
                  By the end you can
                </p>
                <ul className="space-y-1.5">
                  {lesson.objectives.map((o) => (
                    <li
                      key={o}
                      className="flex gap-2 text-sm leading-relaxed text-foreground/90"
                    >
                      <Check className="mt-0.5 size-3.5 shrink-0 text-cyan" />
                      {o}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/*
             * The prose/breakout track. Every child is centred; prose children
             * are capped at the reading measure and wide children are allowed a
             * much larger one. One grid, no per-block wrappers.
             */}
            <div
              className={cn(
                "space-y-6 px-5 py-7 sm:px-8",
                SIZE_CLASS[prefs.size],
              )}
            >
              {lesson.blocks.map((block, i) => (
                <motion.div
                  key={i}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ duration: 0.3 }}
                  className={cn(
                    "mx-auto w-full",
                    isWideBlock(block)
                      ? "max-w-[min(100%,74rem)]"
                      : measure,
                  )}
                >
                  <BlockView
                    block={block}
                    keyTerms={lesson.keyTerms}
                    lessonId={lesson.id}
                  />
                </motion.div>
              ))}

              {lesson.references && lesson.references.length > 0 && (
                <div className={cn("mx-auto w-full", measure)}>
                  <ReferenceList references={lesson.references} />
                </div>
              )}
            </div>

            {/* Footer navigation */}
            <div className="flex flex-col gap-3 border-t border-border bg-surface-2/30 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
              <Button
                variant="ghost"
                size="sm"
                disabled={!prev}
                onClick={() => prev && onNavigate(prev.id)}
                className="justify-start"
              >
                <ArrowLeft className="size-4" />
                <span className="max-w-[12rem] truncate">
                  {prev?.title ?? "Start of course"}
                </span>
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  variant={done ? "secondary" : "primary"}
                  onClick={onComplete}
                  disabled={done}
                >
                  {done ? (
                    <>
                      <Check className="size-4" /> Completed
                    </>
                  ) : (
                    <>Mark complete</>
                  )}
                </Button>
                {next && (
                  <Button
                    variant={done ? "primary" : "secondary"}
                    onClick={() => onNavigate(next.id)}
                  >
                    <span className="max-w-[10rem] truncate">{next.title}</span>
                    <ArrowRight className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          </article>
        </div>

        <aside
          className={cn(
            "hidden transition-opacity xl:block",
            prefs.focus && "opacity-30 hover:opacity-100",
          )}
        >
          <div className="sticky top-20 space-y-3">
            <LessonToc entries={entries} />

            <div className="rounded-2xl border border-border bg-surface/50 p-3">
              <label
                htmlFor="lesson-note"
                className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                <NotebookPen className="size-3.5" /> Your notes
              </label>
              <textarea
                id="lesson-note"
                value={note}
                onChange={(e) => onNote(e.target.value)}
                rows={7}
                placeholder="Saved locally as you type…"
                className="w-full resize-y rounded-lg border border-border bg-surface-2/50 p-2 text-xs leading-relaxed outline-none transition-colors focus:border-cyan/40"
              />
            </div>

            <p className="px-1 text-[10px] leading-relaxed text-muted-foreground">
              Press{" "}
              <kbd className="rounded border border-border bg-surface-2 px-1">
                [
              </kbd>{" "}
              and{" "}
              <kbd className="rounded border border-border bg-surface-2 px-1">
                ]
              </kbd>{" "}
              to move between lessons.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <li className="inline-flex items-center gap-1 rounded-full border border-border bg-surface/70 px-2 py-0.5 text-muted-foreground">
      {children}
    </li>
  );
}

/**
 * A compact header that appears once the hero has scrolled away.
 *
 * In a long lesson the title, the completion action and "what's next" all
 * scroll out of reach within a screen or two, which turns finishing a lesson
 * into a scroll back to the top.
 */
function StickyLessonBar({
  lesson,
  done,
  next,
  onComplete,
  onNavigate,
}: {
  lesson: Lesson;
  done: boolean;
  next?: Lesson;
  onComplete: () => void;
  onNavigate: (id: string) => void;
}) {
  const [shown, setShown] = React.useState(false);

  React.useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setShown(window.scrollY > 320);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <motion.div
      aria-hidden={!shown}
      initial={false}
      animate={{ y: shown ? 0 : -64, opacity: shown ? 1 : 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 34 }}
      className="glass fixed inset-x-0 top-0 z-30 border-b border-border"
      style={{ pointerEvents: shown ? "auto" : "none" }}
    >
      <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-4 py-2 sm:px-6">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {lesson.title}
        </span>
        <span className="hidden shrink-0 font-mono text-2xs tnum text-muted-foreground sm:inline">
          {lessonPosition(lesson.id) + 1} · {lesson.minutes} min
        </span>
        {!done ? (
          <Button variant="primary" size="sm" onClick={onComplete}>
            <Check className="size-3.5" />
            <span className="hidden sm:inline">Mark complete</span>
          </Button>
        ) : next ? (
          <Button variant="primary" size="sm" onClick={() => onNavigate(next.id)}>
            <span className="max-w-[8rem] truncate">{next.title}</span>
            <ArrowRight className="size-3.5" />
          </Button>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-2xs text-success">
            <Check className="size-3" /> Done
          </span>
        )}
      </div>
    </motion.div>
  );
}

/** Thin progress bar that tracks how far down the lesson the reader is. */
export function ReadingProgress() {
  const [pct, setPct] = React.useState(0);

  React.useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      setPct(max > 0 ? Math.min(100, (doc.scrollTop / max) * 100) : 0);
    };
    const onScroll = () => {
      // Coalesce to one measurement per frame — scroll fires far more often
      // than the bar can usefully move.
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div className="fixed inset-x-0 top-0 z-40 h-0.5 bg-transparent">
      <div
        className="h-full bg-gradient-primary transition-[width] duration-100"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
