// What a comparison run costs — before it runs, and what it actually cost after.
//
// The number this replaces was fiction. `compare-client.tsx` assumed every model
// would emit exactly 500 output tokens, ignored the evidence a lane carries, and
// left out the synthesis pass entirely — the pass that re-reads every answer and
// is routinely the most expensive call in the run. On a three-lane Deep run that
// understated the bill by more than it reported.
//
// Two rules here:
//   1. Nothing is free that costs money. Every model call in the run is priced,
//      including the brief, the judge and the synthesizer.
//   2. An estimate is a range, not a point. Output length is the dominant term
//      and it is genuinely unknown before the fact, so both ends are reported
//      and the UI leads with the expected value.

import { messageCostUsd } from "@/lib/chat/cost";
import { estimateTokens } from "@/lib/engine/context";
import { DEPTH_PRESETS, PROMPT_OVERHEAD_TOKENS, type DepthPreset, type LaneModel } from "./lanes";
import type { CompareRun, Depth, LanePlan, LaneState, Stage } from "./types";

/**
 * Share of its ceiling a lane is assumed to actually use.
 *
 * Models stop when they are done, not when they hit `max_tokens`. Measured
 * loosely across the existing chat traffic; wrong in both directions, which is
 * why the ceiling is reported alongside it.
 */
export const EXPECTED_OUTPUT_RATIO = 0.6;

/** Output sizes for the non-lane passes. Small, bounded by their JSON schemas. */
const ARBITER_OUTPUT_TOKENS: Record<"brief" | "claims" | "judge" | "synthesis", number> = {
  brief: 400,
  claims: 700,
  judge: 500,
  synthesis: 900,
};

export interface CostRange {
  /** Nothing but the input, if every model answered in one word. */
  low: number;
  expected: number;
  /** Every lane running to its ceiling. */
  high: number;
}

export interface CostBreakdown extends CostRange {
  /** Per lane id, the expected cost. */
  perLane: Record<string, number>;
  /** Expected cost of the brief, claims, judge and synthesis passes combined. */
  arbiters: number;
}

const ZERO: CostBreakdown = { low: 0, expected: 0, high: 0, perLane: {}, arbiters: 0 };

function priceOf(model: Pick<LaneModel, "pricing"> | undefined, inTok: number, outTok: number): number {
  if (!model) return 0;
  return (inTok / 1e6) * (model.pricing.inputPerM || 0) + (outTok / 1e6) * (model.pricing.outputPerM || 0);
}

export interface EstimateInput {
  question: string;
  lanes: LanePlan[];
  depth: Depth;
  /** Tokens of shared evidence. Lanes that stuff it pay for all of it. */
  evidenceTokens?: number;
  lookup: (id: string) => LaneModel | undefined;
  /** Resolved judge/synthesizer. Falls back to the priciest lane, which is the honest guess. */
  arbiterModelId?: string;
  systemPrompt?: string;
}

/**
 * What this run will cost, before it runs.
 *
 * Blocked lanes are excluded: they never open a connection, so charging for them
 * would make connecting a key look like it *saved* money.
 */
export function estimateRunCost(input: EstimateInput): CostBreakdown {
  const preset: DepthPreset = DEPTH_PRESETS[input.depth] ?? DEPTH_PRESETS.standard;
  const evidenceTokens = Math.max(0, input.evidenceTokens ?? 0);
  const askTokens =
    estimateTokens(input.question) + estimateTokens(input.systemPrompt) + PROMPT_OVERHEAD_TOKENS;

  const runnable = input.lanes.filter((l) => !l.blocked);
  if (runnable.length === 0) return ZERO;

  const perLane: Record<string, number> = {};
  let low = 0;
  let expected = 0;
  let high = 0;
  // The judge and synthesizer re-read every answer, so their input is the sum of
  // what the lanes produce. Accumulated here rather than guessed.
  let expectedAnswerTokens = 0;

  for (const lane of runnable) {
    const model = input.lookup(lane.modelId);
    // A lane that stuffs the pack pays for all of it; one that retrieves a slice
    // does not, and pricing it as if it did is what made Deep look unaffordable.
    const carried = lane.fit === "stuff" ? evidenceTokens : Math.min(evidenceTokens, 8_000);
    const inTok = askTokens + carried;
    const outExpected = Math.round(lane.maxTokens * EXPECTED_OUTPUT_RATIO);

    low += priceOf(model, inTok, 0);
    const mid = priceOf(model, inTok, outExpected);
    expected += mid;
    high += priceOf(model, inTok, lane.maxTokens);
    perLane[lane.id] = mid;
    expectedAnswerTokens += outExpected;
  }

  // The arbiter is whoever will judge and synthesize. Without an explicit choice
  // the priciest lane is assumed, so the estimate errs high rather than low.
  const arbiter =
    (input.arbiterModelId ? input.lookup(input.arbiterModelId) : undefined) ??
    runnable
      .map((l) => input.lookup(l.modelId))
      .filter((m): m is LaneModel => Boolean(m))
      .sort((a, b) => (b.pricing.outputPerM || 0) - (a.pricing.outputPerM || 0))[0];

  let arbiters = 0;
  // The brief runs on every depth: it is what produces the rubric.
  arbiters += priceOf(arbiter, askTokens, ARBITER_OUTPUT_TOKENS.brief);
  if (preset.claims) arbiters += priceOf(arbiter, expectedAnswerTokens, ARBITER_OUTPUT_TOKENS.claims);
  if (preset.judge) {
    arbiters += priceOf(arbiter, expectedAnswerTokens + evidenceTokens, ARBITER_OUTPUT_TOKENS.judge);
  }
  if (preset.headToHead) {
    // One call per unordered pair.
    const pairs = (runnable.length * (runnable.length - 1)) / 2;
    arbiters += pairs * priceOf(arbiter, (expectedAnswerTokens / runnable.length) * 2, 200);
  }
  arbiters += priceOf(arbiter, expectedAnswerTokens + evidenceTokens, ARBITER_OUTPUT_TOKENS.synthesis);

  return {
    low: low + arbiters,
    expected: expected + arbiters,
    high: high + arbiters,
    perLane,
    arbiters,
  };
}

/**
 * Real cost of one lane from the usage the provider reported.
 *
 * Returns 0 when the provider sent no usage — which happens, because some NIM
 * models reject `stream_options` and the router retries without it. A zero here
 * means "not reported", and `runActuals` counts those separately so the UI can
 * say so instead of implying the lane was free.
 */
export function laneCost(lane: Pick<LaneState, "modelId" | "meters">): number {
  const { promptTokens, completionTokens, imageTokens } = lane.meters;
  if (!promptTokens && !completionTokens) return 0;
  return messageCostUsd(lane.modelId, promptTokens, completionTokens, imageTokens);
}

export interface RunActuals {
  total: number;
  perLane: Record<string, number>;
  perStage: Partial<Record<Stage, number>>;
  promptTokens: number;
  completionTokens: number;
  /** Lanes that finished but reported no usage, so their cost is unknown, not zero. */
  unreported: string[];
}

/** What the run actually cost, from the usage events it received. */
export function runActuals(run: Pick<CompareRun, "lanes" | "stages">): RunActuals {
  const perLane: Record<string, number> = {};
  const unreported: string[] = [];
  let total = 0;
  let promptTokens = 0;
  let completionTokens = 0;

  for (const lane of run.lanes) {
    if (lane.status === "queued" || lane.status === "error") continue;
    const cost = laneCost(lane);
    perLane[lane.id] = cost;
    total += cost;
    promptTokens += lane.meters.promptTokens ?? 0;
    completionTokens += lane.meters.completionTokens ?? 0;
    if (!lane.meters.promptTokens && !lane.meters.completionTokens) unreported.push(lane.id);
  }

  const perStage: Partial<Record<Stage, number>> = {};
  for (const [name, stage] of Object.entries(run.stages) as [Stage, CompareRun["stages"][Stage]][]) {
    if (!stage.costUsd) continue;
    perStage[name] = stage.costUsd;
    total += stage.costUsd;
    promptTokens += stage.promptTokens ?? 0;
    completionTokens += stage.completionTokens ?? 0;
  }

  return { total, perLane, perStage, promptTokens, completionTokens, unreported };
}

/**
 * Cost per rubric point — the number behind the "Best value" award.
 *
 * A free lane with any score at all wins outright, which is correct: it is
 * genuinely infinite value. Returns `null` for a lane with no score rather than
 * ranking it last, because unscored is not the same as bad.
 */
export function valueRatio(costUsd: number, score: number | undefined): number | null {
  if (score === undefined || score <= 0) return null;
  if (costUsd <= 0) return Number.POSITIVE_INFINITY;
  return score / costUsd;
}
