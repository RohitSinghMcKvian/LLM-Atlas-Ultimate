// Atlas Compare — the shapes a comparison run is made of.
//
// One question, up to six models, one shared body of evidence. The whole point
// of the module is that the *only* variable between lanes is the model, so
// almost everything here is per-run and only `LaneState` is per-model.
//
// Deliberately free of React, IndexedDB and `fetch`: the planner, the budget
// arithmetic, the resume rule and every analysis are pure functions over these
// types, which is what lets `npm run verify` cover the parts that can be wrong.

import type { WebSource } from "@/lib/chat/types";

/**
 * A run is five bounded stages, not one long request.
 *
 * The old `/api/v1/compare` did research, fan-out and synthesis inside a single
 * SSE response, which cannot fit inside a 300s function and lost everything on
 * a reload. Each stage is now its own request, checkpointed on the way out, so
 * "resume" is just "re-issue the stages that never finished".
 */
export type Stage = "brief" | "evidence" | "lanes" | "analyse" | "synthesis";

export const STAGES: readonly Stage[] = [
  "brief",
  "evidence",
  "lanes",
  "analyse",
  "synthesis",
] as const;

/** `skipped` is a success: the brief decided the stage was not needed. */
export type StageStatus = "pending" | "running" | "done" | "error" | "skipped";

/** Settled in the sense that resume must not re-run it. */
export function stageSettled(s: StageStatus): boolean {
  return s === "done" || s === "skipped";
}

export type LaneStatus =
  | "queued"
  | "streaming"
  | "done"
  | "error"
  /** The user stopped this lane specifically. Resume leaves it alone. */
  | "stopped";

export function laneSettled(s: LaneStatus): boolean {
  return s === "done" || s === "stopped";
}

/**
 * How hard the run tries. One control, because the individual knobs
 * (research rounds, judge on/off, claim extraction, output ceiling) are not
 * independently meaningful to anyone who has not read the code.
 */
export type Depth = "quick" | "standard" | "deep";

/**
 * What kind of task this is, decided once by the brief.
 *
 * `build` is the one that changes the UI rather than just the prompt: it turns
 * on the per-lane artifact gallery and adds "does it actually render" to the
 * rubric.
 */
export type TaskShape = "answer" | "research" | "build" | "transform";

/**
 * A band of the elevation ramp — the lane's identity everywhere in the UI.
 *
 * Terrain's rule is that plural colour is data and data draws from `--elev-0..5`
 * in order. Lanes are the most plural thing in the product, so they take the
 * ramp, and the ramp's length is why a run caps at six lanes.
 */
export type Band = 0 | 1 | 2 | 3 | 4 | 5;

export const MAX_LANES = 6;

/**
 * How the shared evidence pack is fitted into one model's context window.
 *
 * Decided per lane, because a 1M-context model and a 32k one should not be
 * given different *evidence* — only a different way of carrying it.
 */
export type ContextFit =
  /** The whole pack fits. The default, and the only one with no quality cost. */
  | "stuff"
  /** Retrieve the relevant slice per `lib/chat/rag.ts`. */
  | "rag"
  /** Summarise the pack in passes, then answer. Last resort. */
  | "map-reduce";

/** One rubric criterion. Weights are normalised to sum to 1 by `normalizeRubric`. */
export interface Criterion {
  id: string;
  name: string;
  /** What a high score means. Shown to the user and given to the judge. */
  description: string;
  weight: number;
}

export interface Rubric {
  criteria: Criterion[];
  /** Format/length constraints, turned into deterministic checks by `analysis/compliance.ts`. */
  groundRules: string[];
}

/** The brief stage's structured output. */
export interface Brief {
  /** The question, restated unambiguously. This is what lanes actually receive. */
  task: string;
  shape: TaskShape;
  rubric: Rubric;
  /** Sub-questions for the evidence stage. Empty means no retrieval needed. */
  researchQueries: string[];
  /** Model that wrote the brief, for the trace. */
  modelId?: string;
}

/**
 * The shared evidence every lane answers from.
 *
 * `sources` is ordered and its indices are authoritative: `formatResearchContext`
 * numbers citations from it and `lib/research/citations.ts` validates answer
 * markers against those numbers. Nothing downstream may renumber.
 */
export interface EvidencePack {
  sources: WebSource[];
  /** Text of user attachments, already parsed by `lib/chat/attachments.ts`. */
  documents: EvidenceDocument[];
  queriesRun: string[];
  rounds: number;
  /**
   * Searches that errored rather than returning nothing.
   *
   * The distinction matters more than it looks. A backend that is blocking us
   * and a topic with no coverage both produce an empty pack, and only one of
   * them is worth retrying — or worth telling the user about before they read
   * three ungrounded answers.
   */
  failedQueries: number;
  /** Non-null when a budget stopped the search rather than the planner finishing. */
  stoppedBy: string | null;
}

export interface EvidenceDocument {
  name: string;
  text: string;
  tokens: number;
}

export const EMPTY_EVIDENCE: EvidencePack = {
  sources: [],
  documents: [],
  queriesRun: [],
  rounds: 0,
  failedQueries: 0,
  stoppedBy: null,
};

/** What the planner decided about one model, before it runs. */
export interface LanePlan {
  /** Stable within a run. Equal to `modelId`, since a model appears at most once. */
  id: string;
  modelId: string;
  band: Band;
  fit: ContextFit;
  /** Output ceiling, clamped to the model's own `maxOutput`. */
  maxTokens: number;
  /** Dollars this lane may spend before it is cut off. */
  budgetUsd: number;
  /**
   * Set when the lane cannot run at all (no key, no route). It is still planned
   * and still rendered — a lane that is missing is far more confusing than a
   * lane that says why it is empty.
   */
  blocked?: { code: string; message: string };
}

/** Everything measured about a lane while it ran. */
export interface LaneMeters {
  /** Request start → first content token. The number people actually feel. */
  ttftMs?: number;
  totalMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  imageTokens?: number;
  costUsd?: number;
  /** Continuations stitched after a `finish_reason: "length"`. */
  continuations?: number;
  /** The router moved to another provider mid-run. */
  failovers?: number;
  /** The answer was cut short and could not be stitched. */
  truncated?: boolean;
}

export interface LaneState extends LanePlan {
  status: LaneStatus;
  text: string;
  reasoning: string;
  /** The provider that actually served it, which may differ from the pre-flight route. */
  provider?: string;
  error?: string;
  errorCode?: string;
  finishReason?: string;
  meters: LaneMeters;
  startedAt?: number;
  finishedAt?: number;
  /** Artifact paths this lane produced, addressed under `runId:laneId`. */
  artifactPaths?: string[];
}

export function emptyLane(plan: LanePlan): LaneState {
  return {
    ...plan,
    status: plan.blocked ? "error" : "queued",
    text: "",
    reasoning: "",
    error: plan.blocked?.message,
    errorCode: plan.blocked?.code,
    meters: {},
  };
}

/** One atomic assertion pulled out of an answer. */
export interface Claim {
  id: string;
  text: string;
  /** Lanes that assert it. */
  asserts: string[];
  /** Lanes that assert something incompatible with it. */
  contradicts: string[];
  /** Source numbers (1-based into `EvidencePack.sources`) supporting it. */
  citations: number[];
  /** How much the answer changes if this claim is wrong. Drives ordering. */
  materiality: "high" | "medium" | "low";
}

export interface JudgeScore {
  laneId: string;
  /** criterionId to a 0-10 score. */
  scores: Record<string, number>;
  /** Rubric-weighted total, 0-10. Computed by `judge.ts`, never by the model. */
  total: number;
  justification: string;
  /** Claims the judge could not find support for in the evidence pack. */
  unsupported: string[];
}

/** One pairwise comparison, Deep depth only. */
export interface HeadToHead {
  a: string;
  b: string;
  /** Lane id, or null for a genuine tie. */
  winner: string | null;
}

export interface Verdict {
  /** Highest rubric-weighted score. */
  bestOverall?: string;
  /** Best score per dollar. */
  bestValue?: string;
  /** Fastest lane still clearing the quality floor. */
  fastestAcceptable?: string;
  /** One line per award, keyed by lane id. */
  reasons: Record<string, string>;
}

export interface Synthesis {
  /** The merged answer, with citation markers into the evidence pack. */
  answer: string;
  agreements: string[];
  divergences: string[];
  /** Where the synthesizer itself was unsure. Honest, and cheap to ask for. */
  caveats: string[];
  modelId?: string;
  /**
   * The merge ran out of output budget and was recovered from partial JSON.
   *
   * The answer is real but incomplete, and the lists are missing rather than
   * empty — a distinction the reader needs.
   */
  truncated?: boolean;
}

/** The user's own call, which is the only score that is not a model's opinion. */
export interface Vote {
  winner: string | null;
  /** Recorded so an Elo table can be rebuilt from votes alone. */
  laneIds: string[];
  blind: boolean;
  at: number;
}

/**
 * Everything the deterministic tier measured.
 *
 * Computed from the run alone — no model call, no cost, no latency — so it is
 * present on every depth and is never a reason a run is slower. Stored on the
 * run so the panels render from one object rather than each recomputing.
 */
export interface Analysis {
  /** Per lane, keyed by lane id. */
  lanes: Record<string, LaneAnalysis>;
  /** Pairwise similarity, clustering and the outlier. */
  similarity: import("./analysis/similarity").SimilarityReport;
  /** Which lanes cited which source, and what nobody read. */
  coverage: import("./analysis/citations").CoverageReport;
  /** Cost against quality, dominated points marked. Empty without a judge. */
  frontier: import("./analysis/metrics").FrontierPoint[];
  computedAt: number;
}

export interface LaneAnalysis {
  text: import("./analysis/text").TextProfile;
  citations: import("./analysis/citations").CitationProfile;
  compliance: import("./analysis/compliance").ComplianceReport;
  metrics: import("./analysis/metrics").LaneMetrics;
}

export interface StageState {
  status: StageStatus;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  /** One line for the run spine, e.g. "12 sources across 3 rounds". */
  note?: string;
  /**
   * What this stage itself spent.
   *
   * The brief, judge and synthesis are real model calls and the judge in
   * particular re-reads every answer, which regularly makes it the most
   * expensive call in the run. Leaving them out of the total — as the old cost
   * preview did — understates a Deep run by more than it reports.
   */
  modelId?: string;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
}

/** Settings a run was started with. Frozen once it starts. */
export interface RunConfig {
  question: string;
  modelIds: string[];
  depth: Depth;
  /** Explicit override; otherwise chosen outside the lane set. */
  judgeModelId?: string;
  synthesisModelId?: string;
  temperature?: number;
  systemPrompt?: string;
  /** Force retrieval on or off instead of letting the brief decide. */
  web?: boolean;
}

export interface CompareRun {
  id: string;
  createdAt: number;
  updatedAt: number;
  /**
   * The session this run is a turn of.
   *
   * Optional so every run stored before sessions existed still loads. A run
   * without one is a single-turn comparison and is shown as a session of one.
   */
  sessionId?: string;
  /** Position in the session, 0-based. */
  turnIndex?: number;
  /**
   * Lane the user marked as the keeper for this turn.
   *
   * Feeds the best-of transcript and the local Elo table. Distinct from
   * `verdict.bestOverall`, which is the judge's opinion — this one is the
   * user's, and the two disagreeing is a finding worth keeping.
   */
  kept?: string;
  /**
   * This turn re-ran research rather than inheriting the session's pack.
   *
   * Recorded because it changes what the citation numbers mean from here on:
   * every later turn inherits *this* pack, not the original one.
   */
  refreshedEvidence?: boolean;
  config: RunConfig;
  stages: Record<Stage, StageState>;
  brief?: Brief;
  evidence?: EvidencePack;
  lanes: LaneState[];
  claims?: Claim[];
  analysis?: Analysis;
  scores?: JudgeScore[];
  headToHead?: HeadToHead[];
  verdict?: Verdict;
  synthesis?: Synthesis;
  vote?: Vote;
  /** Set when the whole run failed rather than an individual stage. */
  error?: string;
}

export function emptyStages(): Record<Stage, StageState> {
  return {
    brief: { status: "pending" },
    evidence: { status: "pending" },
    lanes: { status: "pending" },
    analyse: { status: "pending" },
    synthesis: { status: "pending" },
  };
}

/* -------------------------------------------------------------------------- */
/* Wire events                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The lanes stage's SSE frames.
 *
 * Typed, unlike the old route's `switch (ev.type)` over `any` — which is how
 * `model_start` and `done` ended up emitted by the server and silently ignored
 * by the client for the life of the feature.
 */
export type LaneEvent =
  | { type: "lane_start"; id: string; modelId: string }
  | { type: "lane_meta"; id: string; provider: string }
  | { type: "lane_delta"; id: string; text: string }
  | { type: "lane_reasoning"; id: string; text: string }
  | {
      type: "lane_usage";
      id: string;
      promptTokens?: number;
      completionTokens?: number;
      imageTokens?: number;
    }
  | { type: "lane_capability"; id: string; capability: "tools"; supported: false }
  | { type: "lane_continue"; id: string }
  | {
      type: "lane_done";
      id: string;
      finishReason?: string;
      ms: number;
      ttftMs?: number;
      /** Times the router moved to a backup provider. A reliability signal. */
      failovers?: number;
      /** Continuations stitched after the provider cut the answer short. */
      continuations?: number;
    }
  | { type: "lane_error"; id: string; message: string; code?: string }
  | { type: "stage_done" };

/** The evidence stage's SSE frames. */
export type EvidenceEvent =
  | { type: "round"; round: number; queries: string[]; newSources: number; failures: string[] }
  | { type: "sources"; sources: WebSource[] }
  | { type: "evidence_done"; pack: EvidencePack }
  | { type: "evidence_error"; message: string };

/** The synthesis stage's SSE frames. */
export type SynthesisEvent =
  | { type: "synthesis_delta"; text: string }
  | { type: "synthesis_done"; synthesis: Synthesis }
  | { type: "synthesis_error"; message: string };

export type CompareEvent = LaneEvent | EvidenceEvent | SynthesisEvent;
