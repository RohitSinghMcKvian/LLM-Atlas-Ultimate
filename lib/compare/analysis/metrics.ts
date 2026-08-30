// What the run cost, how fast it was, and who won.
//
// The verdict is three awards rather than one, because "which model is best" is
// three different questions and answering only the first is how a comparison
// tool becomes a leaderboard nobody trusts:
//
//   * **Best overall** — the highest rubric score, ignoring price.
//   * **Best value** — the most score per dollar. Frequently a small free model,
//     which is the finding people actually act on.
//   * **Fastest acceptable** — the quickest lane that still cleared a quality
//     floor. A fast wrong answer is not a result.
//
// One lane can hold more than one award, and that is worth seeing rather than
// hiding behind a tiebreak.

import { laneCost, valueRatio } from "../cost";
import type { JudgeScore, LaneState, Verdict } from "../types";

export interface LaneMetrics {
  laneId: string;
  ttftMs?: number;
  totalMs?: number;
  /** Tokens per second over generation time, excluding the wait for the first token. */
  throughput?: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  /** True when the provider reported no usage, so cost is unknown rather than zero. */
  costUnknown: boolean;
  failovers: number;
  continuations: number;
  truncated: boolean;
}

export function laneMetrics(lane: LaneState): LaneMetrics {
  const { ttftMs, totalMs, promptTokens, completionTokens } = lane.meters;
  const reported = Boolean(promptTokens || completionTokens);
  // Generation time, not wall time: a fast model on a slow queue is not a slow
  // model, and dividing by wall time would report it as one.
  const generating = totalMs !== undefined ? Math.max(1, totalMs - (ttftMs ?? 0)) : undefined;

  return {
    laneId: lane.id,
    ttftMs,
    totalMs,
    throughput:
      completionTokens && generating
        ? Math.round(completionTokens / (generating / 1000))
        : undefined,
    promptTokens: promptTokens ?? 0,
    completionTokens: completionTokens ?? 0,
    costUsd: laneCost(lane),
    costUnknown: !reported,
    failovers: lane.meters.failovers ?? 0,
    continuations: lane.meters.continuations ?? 0,
    truncated: Boolean(lane.meters.truncated),
  };
}

/**
 * A lane has to score this well to be eligible for "fastest".
 *
 * Expressed as a share of the best score in the run, not an absolute: on a hard
 * question every answer may be mediocre, and the fastest of them is still the
 * useful answer. An absolute floor would leave the award empty exactly when it
 * matters.
 */
export const QUALITY_FLOOR = 0.85;

export interface VerdictInput {
  lanes: LaneState[];
  scores?: JudgeScore[];
  nameOf?: (laneId: string) => string;
}

/**
 * Pick the winners.
 *
 * Only lanes that finished are eligible: a stopped or failed lane has no answer
 * to award anything to, and a truncated one is not a complete answer even though
 * it has text.
 */
export function decideVerdict(input: VerdictInput): Verdict {
  const name = input.nameOf ?? ((id: string) => id);
  const eligible = input.lanes.filter((l) => l.status === "done" && l.text.trim().length > 0);
  const reasons: Record<string, string> = {};
  if (eligible.length === 0) return { reasons };

  const scoreOf = new Map((input.scores ?? []).map((s) => [s.laneId, s.total]));
  const metrics = new Map(eligible.map((l) => [l.id, laneMetrics(l)]));

  // Without a judge there is no quality axis, so the awards that depend on one
  // are left empty rather than invented from length or speed.
  const scored = eligible.filter((l) => scoreOf.has(l.id));
  const verdict: Verdict = { reasons };

  if (scored.length > 0) {
    const best = scored.reduce((a, b) => ((scoreOf.get(b.id) ?? 0) > (scoreOf.get(a.id) ?? 0) ? b : a));
    verdict.bestOverall = best.id;
    reasons[best.id] = `Scored ${(scoreOf.get(best.id) ?? 0).toFixed(1)} on the run's rubric.`;

    let bestRatio = -Infinity;
    let value: LaneState | undefined;
    for (const lane of scored) {
      const ratio = valueRatio(metrics.get(lane.id)!.costUsd, scoreOf.get(lane.id));
      if (ratio !== null && ratio > bestRatio) {
        bestRatio = ratio;
        value = lane;
      }
    }
    if (value) {
      verdict.bestValue = value.id;
      const cost = metrics.get(value.id)!.costUsd;
      reasons[value.id] =
        cost <= 0
          ? `Scored ${(scoreOf.get(value.id) ?? 0).toFixed(1)} at no cost.`
          : `Best score per dollar: ${(scoreOf.get(value.id) ?? 0).toFixed(1)} for $${cost.toFixed(4)}.`;
    }

    const topScore = scoreOf.get(best.id) ?? 0;
    const acceptable = scored.filter(
      (l) => (scoreOf.get(l.id) ?? 0) >= topScore * QUALITY_FLOOR && metrics.get(l.id)?.totalMs,
    );
    if (acceptable.length > 0) {
      const fastest = acceptable.reduce((a, b) =>
        (metrics.get(b.id)!.totalMs ?? Infinity) < (metrics.get(a.id)!.totalMs ?? Infinity) ? b : a,
      );
      verdict.fastestAcceptable = fastest.id;
      const ms = metrics.get(fastest.id)!.totalMs ?? 0;
      reasons[fastest.id] = `Answered in ${(ms / 1000).toFixed(1)}s without dropping below the top score.`;
    }
  } else if (eligible.length > 0) {
    // No rubric, so the only honest award is the one that needs no judgement.
    const timed = eligible.filter((l) => metrics.get(l.id)?.totalMs);
    if (timed.length > 0) {
      const fastest = timed.reduce((a, b) =>
        (metrics.get(b.id)!.totalMs ?? Infinity) < (metrics.get(a.id)!.totalMs ?? Infinity) ? b : a,
      );
      verdict.fastestAcceptable = fastest.id;
      const ms = metrics.get(fastest.id)!.totalMs ?? 0;
      reasons[fastest.id] = `Fastest to finish, at ${(ms / 1000).toFixed(1)}s. No rubric was scored.`;
    }
  }

  void name;
  return verdict;
}

export interface FrontierPoint {
  laneId: string;
  costUsd: number;
  score: number;
  /** True when no lane is both cheaper and better — the efficient frontier. */
  efficient: boolean;
}

/**
 * Cost against quality, with the dominated points marked.
 *
 * A lane is dominated when another is at least as good *and* no more expensive.
 * Marking rather than hiding: seeing that four of six models are strictly worse
 * choices is the point of plotting it.
 */
export function efficiencyFrontier(lanes: LaneState[], scores: JudgeScore[]): FrontierPoint[] {
  const scoreOf = new Map(scores.map((s) => [s.laneId, s.total]));
  const points = lanes
    .filter((l) => l.status === "done" && scoreOf.has(l.id))
    .map((l) => ({
      laneId: l.id,
      costUsd: laneCost(l),
      score: scoreOf.get(l.id) ?? 0,
      efficient: true,
    }));

  for (const point of points) {
    point.efficient = !points.some(
      (other) =>
        other !== point &&
        other.costUsd <= point.costUsd &&
        other.score >= point.score &&
        (other.costUsd < point.costUsd || other.score > point.score),
    );
  }
  return points;
}
