// The shared evidence pack.
//
// This is the decision the whole module turns on: one research pass, and every
// lane answers from the *identical* context. That isolates reasoning quality as
// the only variable — a model does not win because its search happened to
// surface a better page — and it costs one research budget instead of N.
//
// Almost none of the work is new. `lib/research/run.ts` already runs the
// multi-round loop with a budget and parallel search through `fanOut`, and
// `formatResearchContext` already numbers sources in the order
// `lib/research/citations.ts` validates against. This module wires those to a
// run's depth, folds in the user's attachments, and produces one pack.

import { formatResearchContext, runResearch, type ResearchQuery } from "@/lib/research/run";
import { ENOUGH_SOURCES, firstRoundQueries, laterRoundQueries } from "@/lib/research/planner";
import type { BudgetLimits } from "@/lib/research/budget";
import { estimateTokens } from "@/lib/engine/context";
import type { WebSource } from "@/lib/chat/types";
import { DEPTH_PRESETS } from "./lanes";
import { EMPTY_EVIDENCE, type Depth, type EvidenceDocument, type EvidencePack } from "./types";

/**
 * Research limits for a depth.
 *
 * The wall-clock ceiling matters more here than anywhere else: the evidence
 * stage is one request, and it has to finish inside the route's 300 s with room
 * left for the response to be written.
 */
export function limitsFor(depth: Depth): BudgetLimits {
  const preset = DEPTH_PRESETS[depth] ?? DEPTH_PRESETS.standard;
  return {
    maxQueries: preset.researchQueries,
    maxSources: preset.maxSources,
    maxRounds: preset.researchRounds,
    maxMs: depth === "deep" ? 180_000 : 60_000,
  };
}

/**
 * A planner seeded by the brief.
 *
 * Round 0 uses the brief's own queries — it saw the question and decided what
 * was missing, so re-deriving them from keywords would be throwing that away.
 * Later rounds fall back to `laterRoundQueries`, and the loop stops once there
 * are enough sources.
 *
 * Returning `[]` is how a planner says "enough", and it is the only non-budget
 * way `runResearch` stops.
 */
/**
 * Share of the query budget the first round may spend.
 *
 * The rest is held back for the rounds that react to what was found. Without
 * this the brief's opening guess consumes everything and the multi-round loop
 * degrades to the one-shot search it was built to replace.
 */
export const FIRST_ROUND_SHARE = 0.6;

export function briefPlanner(
  briefQueries: string[],
  queryBudget = Number.POSITIVE_INFINITY,
): (question: string, known: WebSource[], round: number) => Promise<ResearchQuery[]> {
  return async (question, known, round) => {
    if (round === 0) {
      // Leave budget for later rounds. The brief will happily propose as many
      // queries as the schema allows, and spending the entire allowance on its
      // first guess means the loop never gets to ask "what is still missing" —
      // which is the only thing that makes it a loop.
      const room = Math.max(1, Math.ceil(queryBudget * FIRST_ROUND_SHARE));
      const seeded = briefQueries
        .slice(0, room)
        .map((q) => ({ query: q, rationale: "from the brief" }));
      // `laterRoundQueries` returns nothing for round 0 — its angles start at 1 —
      // so a brief that proposed no searches would end the loop before it began.
      return seeded.length > 0 ? seeded : firstRoundQueries(question).slice(0, room);
    }
    if (known.length >= ENOUGH_SOURCES) return [];
    return laterRoundQueries(question, round);
  };
}

export interface GatherInput {
  question: string;
  briefQueries: string[];
  depth: Depth;
  /** Already-parsed attachment text, from `lib/chat/attachments.ts`. */
  documents?: { name: string; text: string }[];
  search: (query: string) => Promise<WebSource[]>;
  signal?: AbortSignal;
  onRound?: (report: { round: number; queries: string[]; newSources: number; failures: string[] }) => void;
}

/**
 * Run the research loop and build the pack.
 *
 * Never throws: a failed search is one angle lost, not a failed run, and
 * `runResearch` already captures per-query rejections. A total failure yields an
 * empty pack, which the lanes then answer without — degraded, and honest about
 * it, rather than the whole run collapsing.
 */
export async function gatherEvidence(input: GatherInput): Promise<EvidencePack> {
  const documents: EvidenceDocument[] = (input.documents ?? [])
    .filter((d) => d.text?.trim())
    .map((d) => ({ name: d.name, text: d.text, tokens: estimateTokens(d.text) }));

  if (input.briefQueries.length === 0 && documents.length === 0) {
    return EMPTY_EVIDENCE;
  }

  // Attachments alone are evidence. Skipping the search saves a stage the user
  // did not ask for when they dropped in a PDF and asked about that PDF.
  if (input.briefQueries.length === 0) {
    return { ...EMPTY_EVIDENCE, documents };
  }

  const limits = limitsFor(input.depth);
  try {
    const result = await runResearch(
      input.question,
      {
        plan: briefPlanner(input.briefQueries, limits.maxQueries),
        search: input.search,
        signal: input.signal,
        onProgress: input.onRound,
      },
      limits,
    );
    return {
      sources: result.sources,
      documents,
      queriesRun: result.queriesRun,
      rounds: result.rounds.length,
      // `runResearch` already captures a rejection per query; it was being
      // thrown away here, which is what made a blocked backend look like a topic
      // with no coverage.
      failedQueries: result.rounds.reduce((n, r) => n + r.failures.length, 0),
      stoppedBy: result.stoppedBy,
    };
  } catch {
    return { ...EMPTY_EVIDENCE, documents };
  }
}

/**
 * Turn the pack into the text a lane carries.
 *
 * Sources go through `formatResearchContext` untouched, because its numbering is
 * authoritative for citation validation and anything that renumbers downstream
 * breaks `reconcileCitations`. Documents are appended after, named rather than
 * numbered, so they cannot be confused with a citable source.
 */
export function packToContext(pack: EvidencePack): string | undefined {
  const blocks: string[] = [];
  if (pack.sources.length > 0) blocks.push(formatResearchContext(pack.sources));
  if (pack.documents.length > 0) {
    blocks.push(
      "Files the user attached. Refer to them by name, not by citation number.\n\n" +
        pack.documents.map((d) => `--- ${d.name} ---\n${d.text}`).join("\n\n"),
    );
  }
  return blocks.length > 0 ? blocks.join("\n\n") : undefined;
}

/** Size of the pack, for the lane planner's context-fit decision. */
export function packTokens(pack: EvidencePack): number {
  const context = packToContext(pack);
  return context ? estimateTokens(context) : 0;
}

export function isEmptyPack(pack: EvidencePack | undefined): boolean {
  return !pack || (pack.sources.length === 0 && pack.documents.length === 0);
}

/** One line for the run spine. */
export function describeEvidence(pack: EvidencePack): string {
  // A run where every search failed is not a run that found nothing; leading
  // with the failure is the only way the reader knows to distrust the answers.
  if (pack.sources.length === 0 && pack.failedQueries > 0) {
    return `${pack.failedQueries} of ${pack.queriesRun.length} searches failed — no sources gathered`;
  }
  const parts: string[] = [];
  if (pack.sources.length) {
    parts.push(`${pack.sources.length} source${pack.sources.length === 1 ? "" : "s"}`);
  }
  if (pack.documents.length) {
    parts.push(`${pack.documents.length} file${pack.documents.length === 1 ? "" : "s"}`);
  }
  if (pack.rounds) parts.push(`${pack.rounds} round${pack.rounds === 1 ? "" : "s"}`);
  if (pack.failedQueries) parts.push(`${pack.failedQueries} failed`);
  if (parts.length === 0) return "Nothing found";
  return parts.join(" · ") + (pack.stoppedBy ? ` — ${pack.stoppedBy}` : "");
}
