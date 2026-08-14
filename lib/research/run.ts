import { fanOut } from "@/lib/engine/orchestrator";
import type { WebSource } from "@/lib/chat/types";
import { Budget, type BudgetLimits } from "./budget";
import { dedupeSources } from "./providers";

/**
 * The multi-step research loop (spec §4.6).
 *
 * Atlas already had one-shot search: one query, five snippets, answer. That is
 * fine for "who won last night" and poor for anything that needs more than one
 * angle, because a single query returns a single framing of the topic.
 *
 * This runs rounds instead. Each round asks a planner for the sub-questions still
 * unanswered, searches them **in parallel** through `fanOut` — the function that
 * already existed in `lib/engine/orchestrator.ts` for /code subagents, promoted
 * to chat as the gap report anticipated — merges and de-duplicates the results,
 * and asks whether anything is still missing. Every spend goes through `Budget`.
 *
 * Everything is injected: planner, searcher, budget clock. The loop's real
 * behaviour is its control flow — when it stops, what it does with partial
 * failure, whether it can exceed a cap — and injection is what makes that
 * testable without a model or a network.
 */

export interface ResearchQuery {
  /** The sub-question, phrased as a search query. */
  query: string;
  /** Why the planner asked for it. Shown in the progress UI. */
  rationale?: string;
}

export interface RoundReport {
  round: number;
  queries: string[];
  /** New sources this round contributed, after de-duplication. */
  newSources: number;
  failures: string[];
}

export interface ResearchResult {
  sources: WebSource[];
  rounds: RoundReport[];
  /** Every query actually run, in order. */
  queriesRun: string[];
  /** Non-null when a budget stopped the run rather than the planner finishing. */
  stoppedBy: string | null;
  /** Queries the planner asked for that the budget refused. */
  skipped: string[];
}

export interface ResearchDeps {
  /**
   * Propose the next sub-questions.
   *
   * `known` is what has been found so far, so a planner can avoid repeating
   * ground. Returning an empty array ends the run — that is how the planner says
   * "enough", and it is the only non-budget way for the loop to stop.
   */
  plan: (
    question: string,
    known: WebSource[],
    round: number,
  ) => Promise<ResearchQuery[]>;
  /** Run one search. Should resolve with [] rather than throwing on a miss. */
  search: (query: string) => Promise<WebSource[]>;
  signal?: AbortSignal;
  /** Progress for the UI. Never load-bearing. */
  onProgress?: (report: RoundReport) => void;
}

/** How many searches run at once. Matches `fanOut`'s read-only default. */
export const SEARCH_CONCURRENCY = 3;

/**
 * Normalise a planner's queries.
 *
 * A planner will occasionally return the same sub-question twice, or one already
 * searched. Repeating a query spends budget for nothing, so duplicates are
 * dropped against the whole run rather than only within the round.
 */
export function dedupeQueries(queries: ResearchQuery[], alreadyRun: string[]): ResearchQuery[] {
  const seen = new Set(alreadyRun.map((q) => q.trim().toLowerCase()));
  const out: ResearchQuery[] = [];
  for (const q of queries) {
    const key = q.query.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...q, query: q.query.trim() });
  }
  return out;
}

export async function runResearch(
  question: string,
  deps: ResearchDeps,
  limits: Partial<BudgetLimits> = {},
  now: () => number = Date.now,
): Promise<ResearchResult> {
  const budget = new Budget(limits, now);
  const sources: WebSource[] = [];
  const rounds: RoundReport[] = [];
  const queriesRun: string[] = [];
  const skipped: string[] = [];

  for (let round = 0; ; round++) {
    if (deps.signal?.aborted) break;
    if (budget.exhausted) break;
    if (budget.charge("rounds") === 0) break;

    const proposed = dedupeQueries(await deps.plan(question, sources, round), queriesRun);
    // An empty plan is the planner saying it has enough. Distinct from running
    // out of budget, and the two are reported differently.
    if (proposed.length === 0) break;

    // Charge before running, so the cap is enforced by what is *started* rather
    // than by what finishes. Partial grants mean a round can run fewer searches
    // than the planner asked for; the remainder is reported, not silently lost.
    const granted = budget.charge("queries", proposed.length);
    const toRun = proposed.slice(0, granted);
    for (const q of proposed.slice(granted)) skipped.push(q.query);
    if (toRun.length === 0) break;

    const results = await fanOut(
      toRun.map((q) => ({ id: q.query, run: () => deps.search(q.query) })),
      SEARCH_CONCURRENCY,
      deps.signal,
    );

    const failures: string[] = [];
    const found: WebSource[] = [];
    for (const r of results) {
      // A failed search is one angle lost, not a failed run. `fanOut` already
      // captures rejections per job, so nothing here can throw.
      if (!r.ok) failures.push(r.id);
      else found.push(...(r.value ?? []));
    }

    const before = sources.length;
    const merged = dedupeSources([...sources, ...found]);
    // Take only as many new sources as the budget allows, keeping the earlier
    // ones — they came from earlier, more central queries.
    const room = budget.charge("sources", merged.length - before);
    sources.length = 0;
    sources.push(...merged.slice(0, before + room));

    for (const q of toRun) queriesRun.push(q.query);
    const report: RoundReport = {
      round,
      queries: toRun.map((q) => q.query),
      newSources: sources.length - before,
      failures,
    };
    rounds.push(report);
    deps.onProgress?.(report);
  }

  return {
    sources,
    rounds,
    queriesRun,
    stoppedBy: budget.stopReason(),
    skipped,
  };
}

/**
 * Format retrieved sources for the model, numbered for citation.
 *
 * The numbering here is authoritative: it is what `lib/research/citations.ts`
 * validates the answer's markers against. Any renumbering downstream has to start
 * from this list.
 */
export function formatResearchContext(sources: WebSource[]): string {
  if (sources.length === 0) {
    return "No sources were found. Say so plainly rather than answering from memory.";
  }
  const blocks = sources.map(
    (s, i) => `[${i + 1}] ${s.title}\n${s.url}\n${s.snippet}`,
  );
  return (
    "Sources gathered for this question. Cite them inline by number, like [1] or " +
    "[2][3]. Do not cite a number that is not in this list, and do not state as " +
    "fact anything these sources do not support — say what you could not " +
    `establish instead.\n\n${blocks.join("\n\n")}`
  );
}

/** One-line summary of what the run cost, for the UI. */
export function describeRun(result: ResearchResult): string {
  const parts = [
    `${result.queriesRun.length} search${result.queriesRun.length === 1 ? "" : "es"}`,
    `${result.sources.length} source${result.sources.length === 1 ? "" : "s"}`,
    `${result.rounds.length} round${result.rounds.length === 1 ? "" : "s"}`,
  ];
  const failures = result.rounds.reduce((n, r) => n + r.failures.length, 0);
  if (failures) parts.push(`${failures} failed`);
  return parts.join(" · ") + (result.stoppedBy ? ` — ${result.stoppedBy}` : "");
}
