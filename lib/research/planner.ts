import type { WebSource } from "@/lib/chat/types";
import type { ResearchQuery } from "./run";

/**
 * Turning a question into sub-questions, without a second model call.
 *
 * The obvious planner asks the model "what should I search for?" between rounds.
 * That costs a full round trip per round, which on the free tier (§1.7) roughly
 * doubles the latency and the token bill of every research turn — and the model
 * is about to see the sources anyway.
 *
 * So round 0 is decomposed locally by rule, and later rounds broaden along a
 * fixed set of angles. It is dumber than a model planner and it is honest about
 * that: the value of multi-step research comes mostly from *breadth* — several
 * differently-framed queries instead of one — and breadth does not require
 * intelligence to generate.
 *
 * `modelPlanner` is here for when a caller does want the model to plan; the loop
 * takes either, since `ResearchDeps.plan` is injected.
 *
 * **Inference label:** Claude's research mode plans with a model and does far
 * more of it. This is Atlas's cheaper substitute under §1.7, labelled as such.
 */

/** Words that carry no search signal on their own. */
const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "to", "of", "in", "on", "for", "is",
  "are", "was", "were", "be", "what", "which", "who", "how", "why", "when",
  "where", "does", "do", "did", "can", "could", "should", "would", "about",
  "please", "tell", "me", "i", "you", "my", "our", "their", "it", "its",
]);

export function keywords(question: string): string[] {
  return (question.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? []).filter(
    (w) => w.length > 2 && !STOP.has(w),
  );
}

/**
 * Angles a first round searches from.
 *
 * Each exists because it surfaces a different kind of page: the bare question
 * finds overviews, the year finds current material rather than an outdated top
 * result, and the last two find the criticism that a positive-framed query
 * systematically misses — which is the failure mode of one-shot search, not a
 * refinement of it.
 */
export function firstRoundQueries(question: string, year = new Date().getFullYear()): ResearchQuery[] {
  const q = question.trim().replace(/\s+/g, " ");
  const terms = keywords(q).slice(0, 6).join(" ");
  const base = terms || q;
  return [
    { query: q, rationale: "The question as asked" },
    { query: `${base} ${year}`, rationale: "Recent material" },
    { query: `${base} explained`, rationale: "Background and overviews" },
    { query: `${base} criticism limitations`, rationale: "Counter-evidence" },
  ];
}

/** Later rounds: only if the first found little, and only along new angles. */
export function laterRoundQueries(question: string, round: number): ResearchQuery[] {
  const base = keywords(question).slice(0, 6).join(" ") || question.trim();
  const angles: ResearchQuery[][] = [
    [
      { query: `${base} comparison alternatives`, rationale: "Alternatives" },
      { query: `${base} data statistics`, rationale: "Primary figures" },
    ],
    [
      { query: `${base} case study`, rationale: "Concrete examples" },
      { query: `${base} official documentation`, rationale: "Authoritative source" },
    ],
  ];
  return angles[round - 1] ?? [];
}

/** How many sources make a round "productive enough" to stop broadening. */
export const ENOUGH_SOURCES = 8;

/**
 * The default planner: decompose once, then broaden only if thin.
 *
 * Stopping when there is already enough is the important half. A planner that
 * always proposes more spends the whole budget on every question, including the
 * ones a single search answered — and the budget exists to be left unspent when
 * it can be.
 */
export function localPlanner(): (
  question: string,
  known: WebSource[],
  round: number,
) => Promise<ResearchQuery[]> {
  return async (question, known, round) => {
    if (round === 0) return firstRoundQueries(question);
    if (known.length >= ENOUGH_SOURCES) return [];
    return laterRoundQueries(question, round);
  };
}

/**
 * A planner that asks the model instead. Not the default; see the note above.
 *
 * `ask` returns raw text; anything that is not a plausible query line is dropped
 * rather than searched, because a model asked for a list will sometimes return
 * prose, and searching "Here are some queries you could try:" wastes a query.
 */
export function modelPlanner(
  ask: (prompt: string) => Promise<string>,
  maxPerRound = 4,
): (question: string, known: WebSource[], round: number) => Promise<ResearchQuery[]> {
  return async (question, known, round) => {
    if (round > 0 && known.length >= ENOUGH_SOURCES) return [];
    const seen = known
      .slice(0, 10)
      .map((s) => `- ${s.title}`)
      .join("\n");
    const prompt =
      `Research question: ${question}\n\n` +
      (seen ? `Already found:\n${seen}\n\n` : "") +
      `List up to ${maxPerRound} web search queries that would fill the gaps. ` +
      "One per line, no numbering, no commentary. Reply with nothing at all if " +
      "the question is already covered.";
    const raw = await ask(prompt).catch(() => "");
    return parsePlannedQueries(raw, maxPerRound);
  };
}

/** Read a model's line-per-query reply, discarding anything that isn't one. */
export function parsePlannedQueries(raw: string, max: number): ResearchQuery[] {
  const out: ResearchQuery[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const cleaned = line
      .trim()
      .replace(/^[-*•]\s*/, "")
      .replace(/^\d+[.)]\s*/, "")
      .replace(/^["'`]|["'`]$/g, "")
      .trim();
    if (!cleaned) continue;
    // Prose, not a query: too long, or ends in a colon like a preamble.
    if (cleaned.length > 200 || cleaned.endsWith(":")) continue;
    out.push({ query: cleaned });
    if (out.length >= max) break;
  }
  return out;
}
