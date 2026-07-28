"use client";

import * as React from "react";
import { Check, Lock, Bookmark } from "lucide-react";
import { TRACKS } from "@/lib/learn/curriculum";
import {
  isTrackUnlocked,
  trackCoverage,
  type ProgressState,
} from "@/lib/learn/progress";
import { cn } from "@/lib/utils";

/**
 * The curriculum navigator.
 *
 * Only the active track is expanded. With 24 lessons across 9 tracks a fully
 * expanded list is taller than the viewport and the current position gets lost
 * in it — collapsing keeps "where am I" answerable at a glance.
 */
export function LessonRail({
  currentLessonId,
  progress,
  bookmarks,
  onOpenLesson,
}: {
  currentLessonId: string;
  progress: ProgressState;
  bookmarks: string[];
  onOpenLesson: (id: string) => void;
}) {
  const activeTrackId = React.useMemo(
    () =>
      TRACKS.find((t) => t.lessons.some((l) => l.id === currentLessonId))?.id ??
      TRACKS[0].id,
    [currentLessonId],
  );
  const [openTrack, setOpenTrack] = React.useState(activeTrackId);

  // Following prev/next across a track boundary should open the new track.
  React.useEffect(() => setOpenTrack(activeTrackId), [activeTrackId]);

  const bookmarkSet = React.useMemo(() => new Set(bookmarks), [bookmarks]);

  return (
    <nav
      aria-label="Curriculum"
      className="rounded-2xl border border-border bg-surface/50 p-1.5"
    >
      {TRACKS.map((track, i) => {
        const coverage = trackCoverage(track, progress);
        const unlocked = isTrackUnlocked(track, TRACKS, progress);
        const isOpen = openTrack === track.id;

        return (
          <div key={track.id} className="mb-0.5 last:mb-0">
            <button
              onClick={() => setOpenTrack(isOpen ? "" : track.id)}
              aria-expanded={isOpen}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2/60",
                isOpen && "bg-surface-2/40",
              )}
            >
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded text-[10px] font-semibold",
                  coverage.complete
                    ? "bg-success/15 text-success"
                    : coverage.done > 0
                      ? "bg-cyan/15 text-cyan"
                      : unlocked
                        ? "bg-surface-3 text-muted-foreground"
                        : "bg-surface-3 text-muted-foreground/50",
                )}
              >
                {coverage.complete ? (
                  <Check className="size-3" />
                ) : unlocked ? (
                  i + 1
                ) : (
                  <Lock className="size-2.5" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                {track.title}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {coverage.done}/{coverage.total}
              </span>
            </button>

            {isOpen && (
              <ul className="ml-[0.65rem] border-l border-border pl-1.5">
                {track.lessons.map((lesson) => {
                  const done = Boolean(progress.completedLessons[lesson.id]);
                  const current = lesson.id === currentLessonId;
                  return (
                    <li key={lesson.id}>
                      <button
                        onClick={() => onOpenLesson(lesson.id)}
                        aria-current={current ? "page" : undefined}
                        className={cn(
                          "flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                          current
                            ? "bg-surface-2 font-medium text-foreground"
                            : "text-muted-foreground hover:bg-surface-2/50 hover:text-foreground",
                        )}
                      >
                        <span
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            done
                              ? "bg-success"
                              : current
                                ? "bg-cyan"
                                : "bg-border-strong",
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {lesson.title}
                        </span>
                        {bookmarkSet.has(lesson.id) && (
                          <Bookmark className="size-3 shrink-0 fill-amber text-amber" />
                        )}
                        <span className="shrink-0 text-[10px] opacity-60">
                          {lesson.minutes}m
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}
