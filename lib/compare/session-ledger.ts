// What a session has spent, and what it has learned about the models.
//
// The reason this is core rather than decoration: three questions asked of one
// lane set is *evidence about those models*; three isolated runs is three
// anecdotes. Compare's value compounds across turns, and until now the product
// threw that compounding away at the end of every run.
//
// Two tallies, deliberately separate:
//
//   * `judgeWins` — the rubric's opinion, from `verdict.bestOverall`.
//   * `keptWins`  — the user's, from `run.kept`.
//
// Merging them would hide the most interesting thing a long session produces:
// the turns where the judge and the person disagreed.

import { laneCost } from "./cost";
import { orderedTurns, type CompareSession } from "./session";
import type { CompareRun } from "./types";

export interface LaneLedger {
  laneId: string;
  modelId: string;
  /** Turns this lane actually answered. */
  answered: number;
  /** Turns it failed or was blocked on. */
  failed: number;
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  /** Mean judge score across the turns it was scored on. Null when never scored. */
  meanScore: number | null;
  judgeWins: number;
  keptWins: number;
  /** Slowest-to-fastest is not useful; the mean is. Null when never timed. */
  meanMs: number | null;
}

export interface SessionLedger {
  turns: number;
  /** Turns that produced at least one answer. */
  answeredTurns: number;
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  /** Wall time across every turn, in milliseconds. */
  totalMs: number;
  lanes: LaneLedger[];
  /** Consensus per turn, oldest first. One point per turn that measured it. */
  consensusDrift: { turn: number; consensus: number }[];
  /** True when at least one turn's cost could not be measured. */
  costIncomplete: boolean;
}

const EMPTY: SessionLedger = {
  turns: 0,
  answeredTurns: 0,
  costUsd: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalMs: 0,
  lanes: [],
  consensusDrift: [],
  costIncomplete: false,
};

/**
 * Accumulate a session.
 *
 * Pure over the turns, so the bar in the rail and the panel render from one
 * object rather than each recomputing and drifting.
 */
export function buildLedger(session: CompareSession, runs: CompareRun[]): SessionLedger {
  const turns = orderedTurns(session, runs);
  if (turns.length === 0) return EMPTY;

  const lanes = new Map<string, LaneLedger>();
  const scoreTotals = new Map<string, { sum: number; n: number }>();
  const msTotals = new Map<string, { sum: number; n: number }>();
  const drift: SessionLedger["consensusDrift"] = [];

  let costUsd = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalMs = 0;
  let answeredTurns = 0;
  let costIncomplete = false;

  const ledgerFor = (laneId: string, modelId: string): LaneLedger => {
    let l = lanes.get(laneId);
    if (!l) {
      l = {
        laneId,
        modelId,
        answered: 0,
        failed: 0,
        costUsd: 0,
        promptTokens: 0,
        completionTokens: 0,
        meanScore: null,
        judgeWins: 0,
        keptWins: 0,
        meanMs: null,
      };
      lanes.set(laneId, l);
    }
    return l;
  };

  turns.forEach((run, index) => {
    let answeredThisTurn = false;

    for (const lane of run.lanes) {
      const l = ledgerFor(lane.id, lane.modelId);
      const answered = lane.text.trim().length > 0;

      if (answered) {
        l.answered += 1;
        answeredThisTurn = true;
      } else if (lane.status === "error") {
        // A blocked or failed lane contributes no cost — charging for a lane
        // that never opened a connection would make connecting a key look like
        // it saved money.
        l.failed += 1;
        continue;
      } else {
        continue;
      }

      const cost = laneCost(lane);
      l.costUsd += cost;
      costUsd += cost;
      if (!lane.meters.promptTokens && !lane.meters.completionTokens) costIncomplete = true;

      l.promptTokens += lane.meters.promptTokens ?? 0;
      l.completionTokens += lane.meters.completionTokens ?? 0;
      promptTokens += lane.meters.promptTokens ?? 0;
      completionTokens += lane.meters.completionTokens ?? 0;

      if (lane.meters.totalMs) {
        const t = msTotals.get(lane.id) ?? { sum: 0, n: 0 };
        t.sum += lane.meters.totalMs;
        t.n += 1;
        msTotals.set(lane.id, t);
      }
    }

    // Stage costs — the brief, judge and merge — belong to the session too.
    for (const stage of Object.values(run.stages)) {
      if (stage.costUsd) costUsd += stage.costUsd;
      promptTokens += stage.promptTokens ?? 0;
      completionTokens += stage.completionTokens ?? 0;
    }

    for (const score of run.scores ?? []) {
      const t = scoreTotals.get(score.laneId) ?? { sum: 0, n: 0 };
      t.sum += score.total;
      t.n += 1;
      scoreTotals.set(score.laneId, t);
    }

    if (run.verdict?.bestOverall) {
      const l = lanes.get(run.verdict.bestOverall);
      if (l) l.judgeWins += 1;
    }
    if (run.kept) {
      const l = lanes.get(run.kept);
      if (l) l.keptWins += 1;
    }

    const consensus = run.analysis?.similarity.consensus;
    if (typeof consensus === "number" && (run.analysis?.similarity.pairs.length ?? 0) > 0) {
      drift.push({ turn: index, consensus });
    }

    // The turn's wall time is its slowest lane, not the sum: the lanes ran at
    // the same time, and summing them would report a minute of waiting as three.
    const slowest = Math.max(0, ...run.lanes.map((l) => l.meters.totalMs ?? 0));
    totalMs += slowest;
    if (answeredThisTurn) answeredTurns += 1;
  });

  for (const [laneId, t] of scoreTotals) {
    const l = lanes.get(laneId);
    if (l && t.n > 0) l.meanScore = Math.round((t.sum / t.n) * 10) / 10;
  }
  for (const [laneId, t] of msTotals) {
    const l = lanes.get(laneId);
    if (l && t.n > 0) l.meanMs = Math.round(t.sum / t.n);
  }

  return {
    turns: turns.length,
    answeredTurns,
    costUsd,
    promptTokens,
    completionTokens,
    totalMs,
    // Best first by mean score, then by how often the user kept it — a lane
    // nobody scored still ranks by the only signal there is.
    lanes: [...lanes.values()].sort((a, b) => {
      const d = (b.meanScore ?? -1) - (a.meanScore ?? -1);
      return d !== 0 ? d : b.keptWins - a.keptWins;
    }),
    consensusDrift: drift,
    costIncomplete,
  };
}

/**
 * Which way consensus is moving across the session.
 *
 * Rising means the models are converging as the question narrows; falling means
 * it is opening up and the extra lanes are earning their cost. Needs at least
 * two points to have a direction at all.
 */
export function consensusTrend(ledger: SessionLedger): "rising" | "falling" | "flat" | null {
  const points = ledger.consensusDrift;
  if (points.length < 2) return null;
  const delta = points[points.length - 1].consensus - points[0].consensus;
  if (Math.abs(delta) < 0.05) return "flat";
  return delta > 0 ? "rising" : "falling";
}

/** One line for the rail's foot. */
export function describeLedger(ledger: SessionLedger): string {
  if (ledger.turns === 0) return "Nothing yet";
  const parts = [`${ledger.turns} turn${ledger.turns === 1 ? "" : "s"}`];
  if (ledger.totalMs > 0) parts.push(`${Math.round(ledger.totalMs / 1000)}s`);
  return parts.join(" · ");
}
