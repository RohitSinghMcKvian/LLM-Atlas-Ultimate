/**
 * Atlas Learn — the curriculum type system.
 *
 * Pure data only: no React, no browser globals. The curriculum is authored as
 * typed structures so the reader, the roadmap, the grader, and the transcript
 * all read the *same* source of truth — a lesson can never be listed in the
 * roadmap but missing from the reader.
 */

/** Course level. Drives XP weighting, gating, and roadmap ordering. */
export type Difficulty = "beginner" | "intermediate" | "advanced" | "expert";

export const DIFFICULTY_ORDER: Difficulty[] = [
  "beginner",
  "intermediate",
  "advanced",
  "expert",
];

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  expert: "Expert",
};

/**
 * XP multiplier per level. Advanced work is worth more, but not so much more
 * that a beginner who finishes the whole foundations track feels unrewarded.
 */
export const DIFFICULTY_XP_MULTIPLIER: Record<Difficulty, number> = {
  beginner: 1,
  intermediate: 1.25,
  advanced: 1.6,
  expert: 2,
};

/** Accent token shared with `lib/modules.ts`, so tracks look native to the app. */
export type Accent = "cyan" | "violet" | "amber";

/**
 * Keys of the interactive visualizations in `components/learn/viz`.
 *
 * A lesson references a viz by key rather than importing a component, which
 * keeps this module free of JSX and lets the renderer code-split the whole
 * viz bundle away from the curriculum text.
 */
export type VizKey =
  | "tokenizer"
  | "embeddings"
  | "attention"
  | "sampling"
  | "context-window"
  | "transformer"
  | "rag"
  | "chunking"
  | "tool-loop"
  | "agent-loop"
  | "memory-tiers"
  | "eval-matrix"
  | "reasoning"
  | "scaling"
  | "latency"
  | "cost-frontier";

/** A single rubric line. Weights across a rubric are normalized, not summed to 1. */
export interface RubricCriterion {
  id: string;
  /** Short label shown on the score card, e.g. "Correctness". */
  label: string;
  /** What full marks looks like — also handed verbatim to the grader. */
  descriptor: string;
  /** Relative weight. Any positive number; the grader normalizes. */
  weight: number;
}

/**
 * Callout treatments.
 *
 * `plain` is the "In plain English" card — the jargon-free restatement that
 * opens every lesson. It is a separate tone rather than an ordinary `info`
 * because a reader skimming for the simple version needs to be able to find it
 * by shape alone, without reading the title.
 */
export type Tone = "info" | "insight" | "warn" | "success" | "plain";

/** Where a reference points. Drives the icon and badge on the reading list. */
export type RefKind =
  | "paper"
  | "docs"
  | "article"
  | "video"
  | "course"
  | "repo"
  | "spec";

/**
 * A piece of further reading.
 *
 * Every lesson carries at least four. The `note` is the point of the whole
 * type: a bare link asks the reader to gamble half an hour on a title, and
 * most won't.
 */
export interface Reference {
  title: string;
  /** https only — enforced by the curriculum integrity test. */
  href: string;
  /** Publisher, as a reader would name it: "arXiv", "Anthropic", "Pinecone". */
  source: string;
  kind: RefKind;
  year?: number;
  /** Why this is worth the reader's time. Not a restated abstract. */
  note: string;
}

// ---------------------------------------------------------------------------
// Figures — declarative diagrams
// ---------------------------------------------------------------------------

/**
 * A diagram described as data rather than drawn as a component.
 *
 * The curriculum needs roughly forty diagrams. Forty components would be forty
 * files to keep visually consistent; five layout kinds rendered by one module
 * stay consistent by construction, and lessons remain pure data with no JSX.
 */
export type FigureSpec =
  | {
      kind: "flow";
      nodes: FlowNode[];
      edges: FlowEdge[];
      /** Optional column headers, drawn above the node columns. */
      lanes?: string[];
    }
  | {
      kind: "stack";
      layers: { label: string; note?: string; accent?: Accent }[];
    }
  | {
      kind: "quadrant";
      /** Axis end labels, `[low, high]`. */
      xAxis: [string, string];
      yAxis: [string, string];
      /** `x`/`y` in 0-1. */
      points: { label: string; x: number; y: number; accent?: Accent }[];
    }
  | {
      kind: "timeline";
      items: { at: string; label: string; note?: string }[];
    }
  | {
      kind: "bars";
      unit?: string;
      items: { label: string; value: number; note?: string; accent?: Accent }[];
    };

export interface FlowNode {
  id: string;
  label: string;
  note?: string;
  /** Column index, left to right. Nodes sharing a column stack vertically. */
  column: number;
  accent?: Accent;
  /** Draws as a decision diamond rather than a box. */
  shape?: "box" | "decision";
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  /** A loop-back or error path — drawn dashed, in amber. */
  back?: boolean;
}

/** The authored content units a lesson is made of. */
export type Block =
  | { type: "p"; text: string }
  | { type: "h"; text: string; id?: string }
  | { type: "callout"; tone?: Tone; title: string; text: string }
  | { type: "code"; lang: string; code: string; caption?: string }
  | { type: "table"; head: string[]; rows: string[][]; caption?: string }
  | { type: "steps"; title?: string; steps: { title: string; text: string }[] }
  | { type: "viz"; viz: VizKey; caption?: string }
  | { type: "figure"; figure: FigureSpec; caption?: string }
  /** The wrong way and the right way, side by side, with the reason. */
  | {
      type: "compare";
      title?: string;
      bad: CompareSide;
      good: CompareSide;
      /** The takeaway. Without it this is two boxes and an opinion. */
      verdict: string;
    }
  /** Real math, with every symbol glossed. */
  | {
      type: "formula";
      /** Plain text, not LaTeX — KaTeX costs ~90 kB to typeset one line. */
      expr: string;
      where: { sym: string; meaning: string }[];
      note?: string;
    }
  /** A prompt or output whose parts explain themselves when clicked. */
  | {
      type: "annotated";
      lang?: string;
      text: string;
      /** `match` must occur verbatim in `text` — checked by the test suite. */
      notes: { match: string; label: string; text: string }[];
    }
  | { type: "keyterms" }
  /**
   * Commit to an answer, then reveal.
   *
   * Making a prediction before seeing the answer is the difference between
   * reading a result and learning one, so the reveal is gated on a choice.
   */
  | {
      type: "predict";
      id: string;
      question: string;
      /** Omit for a free "think about it, then reveal" prompt. */
      options?: string[];
      reveal: string;
      explain: string;
      /** Base XP. Defaults to `PRACTICE_XP`. */
      points?: number;
    }
  /** Put the stages back in order. Checked in the browser, retried freely. */
  | {
      type: "sort";
      id: string;
      title: string;
      /** Presented shuffled; `correct` is the answer as a list of ids. */
      items: { id: string; text: string }[];
      correct: string[];
      explain: string;
      points?: number;
    }
  /** Streams a real completion through the Atlas Router on the active model. */
  | { type: "live"; prompt: string; note: string; system?: string }
  | {
      type: "quiz";
      id: string;
      question: string;
      options: string[];
      /** Index for single-answer; array of indices for multi-select. */
      answer: number | number[];
      explain: string;
      /** Base XP. Defaults to `QUIZ_XP`. */
      points?: number;
    }
  | {
      type: "exercise";
      id: string;
      title: string;
      /** The task, in the student's voice: "Write a prompt that…". */
      brief: string;
      /** Pre-filled starting point in the editor. */
      starter?: string;
      /** Graded against these criteria by an LLM judge. */
      rubric: RubricCriterion[];
      hint?: string;
      /** Base XP at 100%. Defaults to `EXERCISE_XP`. */
      points?: number;
    };

export interface CompareSide {
  /** Short header, e.g. "Underspecified" / "Specified". */
  label: string;
  text: string;
  /** Rendered monospace when present — a prompt, schema, or snippet. */
  code?: string;
}

export interface KeyTerm {
  term: string;
  definition: string;
}

export interface Lesson {
  id: string;
  trackId: string;
  title: string;
  /** One line, shown in the roadmap and the lesson list. */
  summary: string;
  minutes: number;
  difficulty: Difficulty;
  /** "By the end of this lesson you can…" — 2-4 items. */
  objectives: string[];
  keyTerms?: KeyTerm[];
  blocks: Block[];
  /** Further reading. At least four per lesson, enforced by the test suite. */
  references?: Reference[];
}

export interface Track {
  id: string;
  title: string;
  blurb: string;
  level: Difficulty;
  accent: Accent;
  /** Track ids that should be finished first. Advisory, not a hard lock. */
  prereqs?: string[];
  lessons: Lesson[];
}

// ---------------------------------------------------------------------------
// Reward economy
// ---------------------------------------------------------------------------

/** XP for reading a lesson through to "mark complete", before the multiplier. */
export const LESSON_XP = 40;
/** XP for a quiz answered correctly on the first attempt. */
export const QUIZ_XP = 20;
/** Half credit once you've already seen the answer — trying again still counts. */
export const QUIZ_RETRY_XP = 8;
/**
 * XP for an inline drill — predict, sort, flashcard.
 *
 * Deliberately small. Drills are meant to be attempted freely and often; if
 * they paid like quizzes, grinding the easiest one would outrun reading the
 * course, and the level would stop describing what anyone knows.
 */
export const PRACTICE_XP = 8;
/** XP for a perfect graded practical, scaled by the awarded percentage. */
export const EXERCISE_XP = 120;
/** Bonus for finishing every lesson in a track. */
export const TRACK_BONUS_XP = 150;

// ---------------------------------------------------------------------------
// Grading — an MIT-style weighted rubric on a 4.0 scale
// ---------------------------------------------------------------------------

/** Per-criterion score band. 0-4, matching the grade-point scale. */
export const MAX_CRITERION_SCORE = 4;

export interface CriterionScore {
  id: string;
  /** 0-4. Clamped on parse. */
  score: number;
  comment: string;
}

export interface GradeResult {
  /** 0-100, weighted across the rubric. */
  percent: number;
  /** Letter grade, MIT-style with pluses and minuses. */
  letter: string;
  /** 0.0-5.0 grade points (5.0 only for a flawless A+). */
  gradePoints: number;
  criteria: CriterionScore[];
  feedback: string;
  strengths: string[];
  improvements: string[];
  /** Model that produced the assessment, for the transcript. */
  gradedBy?: string;
  gradedAt?: string;
}
