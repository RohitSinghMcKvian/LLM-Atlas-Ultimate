"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Lock,
  Play,
  Trophy,
  Sparkles,
  Brain,
  ClipboardCheck,
  Medal,
  Flame,
  Route,
  Compass,
  GraduationCap,
  Search,
  X,
  BookMarked,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ALL_LESSONS, COURSE_STATS, TRACKS } from "@/lib/learn/curriculum";
import {
  ACHIEVEMENTS,
  courseCoverage,
  isTrackUnlocked,
  levelFor,
  nextLesson,
  trackCoverage,
  trackMastery,
  type ProgressState,
} from "@/lib/learn/progress";
import {
  DIFFICULTY_LABEL,
  type Accent,
  type Difficulty,
  type Lesson,
  type Track,
} from "@/lib/learn/types";
import { cn } from "@/lib/utils";

/**
 * The learning roadmap.
 *
 * A vertical spine rather than a horizontal rail: nine tracks with expandable
 * lesson lists do not fit across a viewport at a readable size, and the spine
 * degrades to a single column on mobile without a separate layout.
 */

const ACCENT_RING: Record<Accent, string> = {
  cyan: "border-cyan/45 bg-cyan/[0.07]",
  violet: "border-violet/45 bg-violet/[0.07]",
  amber: "border-amber/45 bg-amber/[0.07]",
};

const ACCENT_STRIP: Record<Accent, string> = {
  cyan: "from-cyan/25 via-cyan/[0.06]",
  violet: "from-violet/25 via-violet/[0.06]",
  amber: "from-amber/25 via-amber/[0.06]",
};

const ACCENT_VAR: Record<Accent, string> = {
  cyan: "var(--cyan)",
  violet: "var(--violet)",
  amber: "var(--amber)",
};

const ACHIEVEMENT_ICONS: Record<string, LucideIcon> = {
  Sparkles,
  Brain,
  ClipboardCheck,
  Medal,
  Flame,
  Route,
  Compass,
  GraduationCap,
};

type FilterFlag = "incomplete" | "graded" | "interactive" | "bookmarked";

export function Roadmap({
  progress,
  bookmarks,
  onOpenLesson,
}: {
  progress: ProgressState;
  bookmarks: string[];
  onOpenLesson: (lessonId: string) => void;
}) {
  const coverage = courseCoverage(TRACKS, progress);
  const next = nextLesson(TRACKS, progress);
  const [expanded, setExpanded] = React.useState<string | null>(
    next ? next.trackId : TRACKS[0].id,
  );
  const [query, setQuery] = React.useState("");
  const [flags, setFlags] = React.useState<FilterFlag[]>([]);
  const [level, setLevel] = React.useState<Difficulty | "all">("all");

  const filtering = query.trim().length > 0 || flags.length > 0 || level !== "all";

  const matches = React.useMemo(() => {
    if (!filtering) return null;
    const q = query.trim().toLowerCase();
    return ALL_LESSONS.filter((l) => {
      if (q && !`${l.title} ${l.summary}`.toLowerCase().includes(q)) return false;
      if (level !== "all" && l.difficulty !== level) return false;
      for (const f of flags) {
        if (f === "incomplete" && progress.completedLessons[l.id]) return false;
        if (f === "graded" && !l.blocks.some((b) => b.type === "exercise")) {
          return false;
        }
        if (
          f === "interactive" &&
          !l.blocks.some((b) => b.type === "viz" || b.type === "figure")
        ) {
          return false;
        }
        if (f === "bookmarked" && !bookmarks.includes(l.id)) return false;
      }
      return true;
    });
  }, [filtering, query, level, flags, progress.completedLessons, bookmarks]);

  return (
    <div className="space-y-7">
      <CourseHero
        progress={progress}
        coverage={coverage}
        next={next}
        onOpenLesson={onOpenLesson}
      />

      <LessonFilter
        query={query}
        onQuery={setQuery}
        flags={flags}
        onFlags={setFlags}
        level={level}
        onLevel={setLevel}
        resultCount={matches?.length}
      />

      {matches ? (
        <SearchResults
          lessons={matches}
          progress={progress}
          onOpenLesson={onOpenLesson}
          onClear={() => {
            setQuery("");
            setFlags([]);
            setLevel("all");
          }}
        />
      ) : (
        <div>
          <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">
            The path
          </h2>
          <ol className="relative space-y-2.5">
            {/* The spine. Absolute so it spans the whole list, behind the nodes. */}
            <span
              aria-hidden
              className="absolute left-[1.375rem] top-3 bottom-3 w-px bg-border"
            />
            <motion.span
              aria-hidden
              className="absolute left-[1.375rem] top-3 w-px origin-top bg-gradient-to-b from-cyan to-violet"
              initial={false}
              animate={{ height: `${coverage.percent}%` }}
              style={{ maxHeight: "calc(100% - 1.5rem)" }}
              transition={{ type: "spring", stiffness: 120, damping: 26 }}
            />

            {TRACKS.map((track, i) => (
              <TrackNode
                key={track.id}
                track={track}
                index={i}
                progress={progress}
                expanded={expanded === track.id}
                onToggle={() =>
                  setExpanded((cur) => (cur === track.id ? null : track.id))
                }
                onOpenLesson={onOpenLesson}
                currentLessonId={next?.id}
              />
            ))}
          </ol>
        </div>
      )}

      <Achievements progress={progress} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

/**
 * The top of the roadmap.
 *
 * Answers the only three questions a returning learner has — where am I, what's
 * next, and how far in am I — before they scroll. The aurora and grid backdrop
 * are the app's own hero tokens, which this page previously didn't use at all.
 */
function CourseHero({
  progress,
  coverage,
  next,
  onOpenLesson,
}: {
  progress: ProgressState;
  coverage: { done: number; total: number; percent: number };
  next?: Lesson;
  onOpenLesson: (id: string) => void;
}) {
  const level = levelFor(progress.xp);
  const finished = !next;

  return (
    <div className="gradient-border overflow-hidden p-[1px]">
      <div className="relative overflow-hidden rounded-[calc(var(--radius)-1px)] bg-surface/85">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-aurora"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-grid-fade opacity-50"
        />

        <div className="relative grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-cyan">
              {finished
                ? "Course complete"
                : coverage.done === 0
                  ? "Start here"
                  : "Pick up where you left off"}
            </p>
            <h2 className="mt-1.5 font-display text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              {finished ? "Every lesson done" : next.title}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              {finished
                ? "Head to the transcript to review your grades and mint the credential."
                : next.summary}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              {!finished && (
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => onOpenLesson(next.id)}
                >
                  <Play className="size-4" />
                  {coverage.done === 0 ? "Begin the course" : "Continue"}
                </Button>
              )}
              {finished && (
                <Badge variant="success">
                  <Trophy className="size-3.5" /> Ready for certification
                </Badge>
              )}
              {!finished && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="size-3.5" />
                  {next.minutes} min read
                </span>
              )}
              {progress.streak > 1 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber/40 bg-amber/10 px-2 py-0.5 text-xs font-medium text-amber">
                  <Flame className="size-3.5" /> {progress.streak}-day streak
                </span>
              )}
            </div>

            <div className="mt-5 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                <motion.div
                  className="h-full rounded-full bg-gradient-primary"
                  initial={false}
                  animate={{ width: `${coverage.percent}%` }}
                  transition={{ type: "spring", stiffness: 180, damping: 28 }}
                />
              </div>
              <span className="shrink-0 font-mono text-2xs tnum text-muted-foreground">
                {coverage.done}/{coverage.total} lessons · {coverage.percent}%
              </span>
            </div>
          </div>

          {/* Level ring + course scale. */}
          <div className="flex items-center gap-5 lg:flex-col lg:items-end">
            <div className="flex items-center gap-3">
              <MasteryRing value={Math.round(level.fraction * 100)} size={58} />
              <div>
                <p className="font-display text-lg font-semibold leading-none tracking-tight">
                  {level.title}
                </p>
                <p className="mt-1 font-mono text-2xs tnum text-muted-foreground">
                  {progress.xp.toLocaleString()} XP
                  {!level.isMax && ` · ${level.toNext} to next`}
                </p>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-x-5 gap-y-1.5 text-right sm:grid-cols-4 lg:grid-cols-2">
              <Stat label="lessons" value={COURSE_STATS.lessons} />
              <Stat label="hours" value={(COURSE_STATS.minutes / 60).toFixed(1)} />
              <Stat label="interactives" value={COURSE_STATS.visualizations + COURSE_STATS.figures} />
              <Stat label="graded" value={COURSE_STATS.practicals} />
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dd className="font-display text-base font-semibold leading-none tnum">
        {value}
      </dd>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
    </div>
  );
}

/** A progress arc. Used for level and per-track mastery. */
function MasteryRing({
  value,
  size = 40,
  label,
}: {
  value: number;
  size?: number;
  label?: string;
}) {
  const stroke = size >= 50 ? 4 : 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const reduced = useReducedMotion();

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0 -rotate-90"
      role="img"
      aria-label={label ?? `${value}% complete`}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="rgb(var(--surface-3))"
        strokeWidth={stroke}
      />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="url(#mastery-gradient)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        initial={reduced ? false : { strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - Math.min(100, Math.max(0, value)) / 100) }}
        transition={{ type: "spring", stiffness: 90, damping: 22 }}
      />
      <defs>
        <linearGradient id="mastery-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(var(--cyan))" />
          <stop offset="100%" stopColor="rgb(var(--violet))" />
        </linearGradient>
      </defs>
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        transform={`rotate(90 ${size / 2} ${size / 2})`}
        className="fill-[rgb(var(--foreground))] font-mono font-semibold"
        style={{ fontSize: size >= 50 ? 13 : 10 }}
      >
        {value}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

const FLAG_META: { id: FilterFlag; label: string; icon: LucideIcon }[] = [
  { id: "incomplete", label: "Not done", icon: Route },
  { id: "graded", label: "Graded", icon: ClipboardCheck },
  { id: "interactive", label: "Interactive", icon: Wand2 },
  { id: "bookmarked", label: "Saved", icon: BookMarked },
];

const LEVELS: (Difficulty | "all")[] = [
  "all",
  "beginner",
  "intermediate",
  "advanced",
  "expert",
];

/**
 * Find a lesson.
 *
 * At thirty-one lessons across nine collapsed tracks, "where was the bit about
 * re-ranking" is a real question the spine cannot answer.
 */
function LessonFilter({
  query,
  onQuery,
  flags,
  onFlags,
  level,
  onLevel,
  resultCount,
}: {
  query: string;
  onQuery: (v: string) => void;
  flags: FilterFlag[];
  onFlags: (v: FilterFlag[]) => void;
  level: Difficulty | "all";
  onLevel: (v: Difficulty | "all") => void;
  resultCount?: number;
}) {
  const active = query.trim().length > 0 || flags.length > 0 || level !== "all";

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-surface/40 p-3 sm:flex-row sm:items-center">
      <div className="relative min-w-0 flex-1">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search all lessons…"
          aria-label="Search lessons"
          className="w-full rounded-lg border border-border bg-surface-2/50 py-1.5 pl-8 pr-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-cyan/45"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <div
          role="radiogroup"
          aria-label="Difficulty"
          className="inline-flex rounded-lg border border-border bg-surface-2/60 p-0.5"
        >
          {LEVELS.map((l) => (
            <button
              key={l}
              role="radio"
              aria-checked={level === l}
              onClick={() => onLevel(l)}
              className={cn(
                "rounded-md px-2 py-1 text-2xs font-medium transition-colors",
                level === l
                  ? "bg-surface text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {l === "all" ? "All" : DIFFICULTY_LABEL[l].slice(0, 3)}
            </button>
          ))}
        </div>

        {FLAG_META.map((f) => {
          const on = flags.includes(f.id);
          const Icon = f.icon;
          return (
            <button
              key={f.id}
              aria-pressed={on}
              onClick={() =>
                onFlags(on ? flags.filter((x) => x !== f.id) : [...flags, f.id])
              }
              className={cn(
                "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-2xs font-medium transition-colors",
                on
                  ? "border-cyan/50 bg-cyan/10 text-cyan"
                  : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
              )}
            >
              <Icon className="size-3" />
              {f.label}
            </button>
          );
        })}

        {active && (
          <button
            onClick={() => {
              onQuery("");
              onFlags([]);
              onLevel("all");
            }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-2xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3" /> Clear
            {resultCount !== undefined && (
              <span className="font-mono tnum">({resultCount})</span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function SearchResults({
  lessons,
  progress,
  onOpenLesson,
  onClear,
}: {
  lessons: Lesson[];
  progress: ProgressState;
  onOpenLesson: (id: string) => void;
  onClear: () => void;
}) {
  if (lessons.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface/40 px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          No lesson matches that.
        </p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={onClear}>
          Clear filters
        </Button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">
        {lessons.length} lesson{lessons.length === 1 ? "" : "s"}
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {lessons.map((l) => (
          <li key={l.id}>
            <LessonRow
              lesson={l}
              done={Boolean(progress.completedLessons[l.id])}
              onOpen={() => onOpenLesson(l.id)}
              showTrack
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Track node
// ---------------------------------------------------------------------------

function TrackNode({
  track,
  index,
  progress,
  expanded,
  onToggle,
  onOpenLesson,
  currentLessonId,
}: {
  track: Track;
  index: number;
  progress: ProgressState;
  expanded: boolean;
  onToggle: () => void;
  onOpenLesson: (id: string) => void;
  currentLessonId?: string;
}) {
  const coverage = trackCoverage(track, progress);
  const mastery = trackMastery(track, progress);
  const unlocked = isTrackUnlocked(track, TRACKS, progress);
  const minutes = track.lessons.reduce((n, l) => n + l.minutes, 0);
  const graded = track.lessons.filter((l) =>
    l.blocks.some((b) => b.type === "exercise"),
  ).length;

  return (
    <li className="relative pl-12">
      <span
        className={cn(
          "absolute left-0 top-3 grid size-11 place-items-center rounded-full border-2 bg-background transition-colors",
          coverage.complete
            ? "border-cyan bg-gradient-primary text-primary-foreground"
            : coverage.done > 0
              ? "border-cyan/50 text-cyan"
              : unlocked
                ? "border-border-strong text-muted-foreground"
                : "border-border text-muted-foreground/50",
        )}
        style={
          currentLessonId &&
          track.lessons.some((l) => l.id === currentLessonId) &&
          !coverage.complete
            ? { boxShadow: "0 0 0 5px rgb(var(--cyan) / 0.12)" }
            : undefined
        }
      >
        {coverage.complete ? (
          <Check className="size-5" />
        ) : !unlocked ? (
          <Lock className="size-4" />
        ) : (
          <span className="font-display text-sm font-bold">{index + 1}</span>
        )}
      </span>

      <div
        className={cn(
          "overflow-hidden rounded-2xl border transition-colors",
          coverage.complete
            ? ACCENT_RING[track.accent]
            : "border-border bg-surface/50 hover:border-border-strong",
        )}
      >
        <button
          onClick={onToggle}
          aria-expanded={expanded}
          className="relative flex w-full items-start gap-3 px-4 py-3.5 text-left"
        >
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b to-transparent",
              ACCENT_STRIP[track.accent],
            )}
          />

          <div className="relative min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-base font-semibold tracking-tight">
                {track.title}
              </h3>
              <span className="rounded-full border border-border bg-surface/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {DIFFICULTY_LABEL[track.level]}
              </span>
              {!unlocked && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="rounded-full border border-amber/30 bg-amber/10 px-1.5 py-0.5 text-[10px] text-amber">
                      suggested later
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    Finish about two-thirds of{" "}
                    {track.prereqs?.join(" and ") ?? "the earlier tracks"} first.
                    You can still open it.
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {track.blurb}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] tnum text-muted-foreground">
              <span>
                {coverage.done}/{coverage.total} lessons
              </span>
              <span aria-hidden>·</span>
              <span>{minutes}m</span>
              {graded > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span className="text-amber">{graded} graded</span>
                </>
              )}
            </div>
          </div>

          <div className="relative flex shrink-0 items-center gap-2">
            {coverage.done > 0 ? (
              <MasteryRing
                value={mastery}
                label={`${track.title}: ${mastery}% mastery`}
              />
            ) : (
              <span
                className="size-2 rounded-full"
                style={{
                  background: `rgb(${ACCENT_VAR[track.accent]} / 0.4)`,
                }}
              />
            )}
            <ChevronDown
              className={cn(
                "size-4 text-muted-foreground transition-transform",
                !expanded && "-rotate-90",
              )}
            />
          </div>
        </button>

        {expanded && (
          <ul className="border-t border-border px-2 py-1.5">
            {track.lessons.map((lesson) => (
              <li key={lesson.id}>
                <LessonRow
                  lesson={lesson}
                  done={Boolean(progress.completedLessons[lesson.id])}
                  current={lesson.id === currentLessonId}
                  onOpen={() => onOpenLesson(lesson.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function LessonRow({
  lesson,
  done,
  current,
  showTrack,
  onOpen,
}: {
  lesson: Lesson;
  done: boolean;
  current?: boolean;
  showTrack?: boolean;
  onOpen: () => void;
}) {
  const graded = lesson.blocks.some((b) => b.type === "exercise");
  const interactive = lesson.blocks.some(
    (b) => b.type === "viz" || b.type === "figure",
  );
  const drill = lesson.blocks.some(
    (b) => b.type === "predict" || b.type === "sort",
  );
  const track = showTrack ? TRACKS.find((t) => t.id === lesson.trackId) : null;

  return (
    <button
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-surface-2/60",
        current && "bg-surface-2/70",
        showTrack && "border border-border bg-surface/40",
      )}
    >
      <span
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-full border",
          done
            ? "border-success bg-success/20 text-success"
            : current
              ? "border-cyan text-cyan"
              : "border-border-strong",
        )}
      >
        {done && <Check className="size-2.5" />}
        {!done && current && <span className="size-1.5 rounded-full bg-cyan" />}
      </span>

      <span className="min-w-0 flex-1">
        {track && (
          <span className="block text-[10px] uppercase tracking-wider text-cyan">
            {track.title}
          </span>
        )}
        <span
          className={cn(
            "block truncate text-sm",
            done ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {lesson.title}
        </span>
        <span className="block truncate text-2xs text-muted-foreground">
          {lesson.summary}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-1">
        {interactive && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="grid size-4 place-items-center rounded bg-cyan/15 text-cyan">
                <Wand2 className="size-2.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent>Interactive visualization</TooltipContent>
          </Tooltip>
        )}
        {drill && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="grid size-4 place-items-center rounded bg-violet/15 text-violet">
                <Brain className="size-2.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent>Self-check drill</TooltipContent>
          </Tooltip>
        )}
        {graded && (
          <span className="rounded bg-amber/15 px-1 text-[9px] font-semibold uppercase text-amber">
            graded
          </span>
        )}
      </span>

      <span className="shrink-0 font-mono text-[10px] tnum text-muted-foreground">
        {lesson.minutes}m
      </span>
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

function Achievements({ progress }: { progress: ProgressState }) {
  const ctx = React.useMemo(
    () => ({
      state: progress,
      tracks: TRACKS,
      coverage: courseCoverage(TRACKS, progress),
      gpa: (() => {
        const graded = Object.values(progress.exercises);
        return graded.length
          ? graded.reduce((n, r) => n + r.gradePoints, 0) / graded.length
          : 0;
      })(),
    }),
    [progress],
  );

  const earnedCount = ACHIEVEMENTS.filter((a) => a.earned(ctx)).length;

  return (
    <div>
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
        Achievements
        <span className="rounded-full border border-border px-2 py-0.5 font-mono text-2xs font-normal tnum text-muted-foreground">
          {earnedCount}/{ACHIEVEMENTS.length}
        </span>
      </h2>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ACHIEVEMENTS.map((a) => {
          const earned = a.earned(ctx);
          const Icon = ACHIEVEMENT_ICONS[a.icon] ?? Sparkles;
          return (
            <li
              key={a.id}
              className={cn(
                "relative flex items-start gap-2.5 overflow-hidden rounded-xl border px-3 py-2.5 transition-colors",
                earned
                  ? "border-cyan/35 bg-cyan/[0.06]"
                  : "border-border bg-surface/40",
              )}
            >
              {earned && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-gradient-primary-soft opacity-60"
                />
              )}
              <span
                className={cn(
                  "relative grid size-8 shrink-0 place-items-center rounded-lg",
                  earned
                    ? "bg-gradient-primary text-primary-foreground"
                    : "bg-surface-3 text-muted-foreground/60",
                )}
              >
                {earned ? <Icon className="size-4" /> : <Lock className="size-3" />}
              </span>
              <span className="relative min-w-0">
                <span
                  className={cn(
                    "block text-xs font-semibold",
                    !earned && "text-muted-foreground",
                  )}
                >
                  {a.label}
                </span>
                <span className="block text-2xs leading-snug text-muted-foreground">
                  {a.description}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
