// The deterministic analysis pass.
//
// One function over a finished (or half-finished) run, producing every figure
// the analysis panels render. Pure, synchronous and free: no model call, no
// network, no cost. That is what lets it run on every depth, re-run on every
// checkpoint, and be covered by `npm run verify` rather than by hoping.
//
// The model-based tiers — claims, the judge, the synthesis — layer on top of
// this rather than replacing it. When they are off, or when they fail, the run
// still has numbers.

import { profileCitations, sourceCoverage } from "./citations";
import { checkCompliance } from "./compliance";
import { efficiencyFrontier, laneMetrics } from "./metrics";
import { compareAnswers } from "./similarity";
import { profileText } from "./text";
import type { Analysis, CompareRun, LaneAnalysis } from "../types";

/**
 * Measure a run.
 *
 * Lanes with no text still get an entry: a failed lane's zeroes are the honest
 * answer, and omitting it would make the panels quietly shorter than the grid.
 */
export function analyseRun(run: CompareRun): Analysis {
  const sourceCount = run.evidence?.sources.length ?? 0;
  const groundRules = run.brief?.rubric.groundRules ?? [];

  const lanes: Record<string, LaneAnalysis> = {};
  for (const lane of run.lanes) {
    lanes[lane.id] = {
      text: profileText(lane.text),
      citations: profileCitations(lane.text, sourceCount),
      compliance: checkCompliance(groundRules, lane.text),
      metrics: laneMetrics(lane),
    };
  }

  return {
    lanes,
    similarity: compareAnswers(run.lanes.map((l) => ({ id: l.id, text: l.text }))),
    coverage: sourceCoverage(
      run.lanes.map((l) => ({ id: l.id, text: l.text })),
      sourceCount,
    ),
    // Empty until a judge has scored, since the axis is quality against cost and
    // there is no quality axis without one.
    frontier: efficiencyFrontier(run.lanes, run.scores ?? []),
    computedAt: Date.now(),
  };
}

/**
 * Findings worth putting in front of someone without them going looking.
 *
 * Ordered by how much they should change what the reader does: a fabricated
 * citation first, because it means an answer that looks grounded is not.
 */
export function headlines(run: CompareRun, analysis: Analysis, nameOf: (id: string) => string): string[] {
  const out: string[] = [];

  const fabricators = Object.entries(analysis.lanes)
    .filter(([, a]) => a.citations.fabricated.length > 0)
    .map(([id]) => nameOf(id));
  if (fabricators.length > 0) {
    out.push(
      `${fabricators.join(", ")} cited ${fabricators.length === 1 ? "a source" : "sources"} that do not exist.`,
    );
  }

  const broke = Object.entries(analysis.lanes)
    .filter(([, a]) => a.compliance.failed > 0)
    .map(([id]) => nameOf(id));
  if (broke.length > 0) out.push(`${broke.join(", ")} broke the format rules.`);

  if (analysis.similarity.outlier) {
    out.push(`${nameOf(analysis.similarity.outlier)} took a different line from the rest.`);
  } else if (analysis.similarity.pairs.length > 0 && analysis.similarity.clusters.length === 1) {
    out.push("Every model covered the same ground — the extra lanes added little.");
  }

  const sourceCount = run.evidence?.sources.length ?? 0;

  // A research stage that ran and found nothing leaves every lane answering from
  // memory while the brief's ground rules still say "base this on recent
  // research". Silence here reads as "research happened", which is the opposite
  // of what occurred.
  if (sourceCount === 0 && (run.evidence?.queriesRun.length ?? 0) > 0) {
    const failed = run.evidence?.failedQueries ?? 0;
    out.push(
      failed > 0
        ? `Search failed on ${failed} of ${run.evidence?.queriesRun.length} queries — every answer here is ungrounded.`
        : `${run.evidence?.queriesRun.length} searches returned no sources — every answer here is ungrounded.`,
    );
  }

  if (sourceCount > 0 && analysis.coverage.unused.length > 0) {
    const n = analysis.coverage.unused.length;
    out.push(`${n} of ${sourceCount} sources went uncited by every model.`);
  }

  const truncated = Object.entries(analysis.lanes)
    .filter(([, a]) => a.metrics.truncated)
    .map(([id]) => nameOf(id));
  if (truncated.length > 0) out.push(`${truncated.join(", ")} hit the output limit and stopped short.`);

  return out;
}

export * from "./citations";
export * from "./compliance";
export * from "./metrics";
export * from "./similarity";
export * from "./text";
