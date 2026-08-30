// Turning disagreement into the next question.
//
// A run already works out where the models diverged — the synthesis lists it and,
// at Deep, the claim matrix records which lanes contradict which. Until now that
// was something you read and then had to act on by hand, retyping a question the
// system had effectively already written.
//
// Pure, and deliberately conservative: a suggestion that is not obviously worth
// asking is worse than no suggestion, because a chip nobody clicks trains people
// to stop reading the row.

import type { Claim, CompareRun, Synthesis } from "./types";

/** More than this and the row becomes a wall nobody reads. */
export const MAX_SUGGESTIONS = 3;

/** Below this many characters a divergence is a fragment, not a topic. */
const MIN_LENGTH = 12;

/** Above this it is a paragraph, and a chip cannot hold it. */
const MAX_LENGTH = 160;

/**
 * Strip the framing a model puts around a divergence.
 *
 * The synthesis is asked to say what each side held, so its lines routinely open
 * with "Answer A says…" or "They disagree on whether…". As a question those
 * openers are noise, and "Answer A" names a label the user never saw.
 */
export function toQuestion(divergence: string): string | null {
  let text = divergence.trim();
  if (!text) return null;

  text = text
    .replace(/^(?:they|the answers|the models)\s+(?:disagree(?:d)?|differ(?:ed)?|split)\s+(?:on|about|over)\s+/i, "")
    .replace(/^(?:whether|if)\s+/i, "")
    .replace(/^answer\s+[a-f]\b[^:.]*[:.]?\s*/i, "")
    .replace(/^[-*•]\s*/, "")
    .trim();

  if (text.length < MIN_LENGTH || text.length > MAX_LENGTH) return null;

  // A line that already reads as a question is used as written.
  if (text.endsWith("?")) return capitalise(text);

  const stripped = text.replace(/[.;]+$/, "");
  return `Which is right about ${lowerFirst(stripped)}?`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function lowerFirst(s: string): string {
  // Only when the first word is not an acronym or a proper noun — "RAG" must
  // not become "rAG".
  const first = s.split(/\s+/)[0] ?? "";
  if (first.length > 1 && first === first.toUpperCase()) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export interface SuggestionInput {
  synthesis?: Synthesis;
  claims?: Claim[];
}

/**
 * Questions worth asking next, best first.
 *
 * Contradicted claims outrank the synthesis's prose: a claim the matrix records
 * two lanes as actively disagreeing about is a harder disagreement than one the
 * merge merely noticed.
 */
export function suggestFollowUps(input: SuggestionInput): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const q = toQuestion(raw);
    if (!q) return;
    const key = q.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(q);
  };

  const contested = (input.claims ?? [])
    .filter((c) => c.contradicts.length > 0)
    .sort((a, b) => materiality(b) - materiality(a));
  for (const claim of contested) push(claim.text);

  for (const line of input.synthesis?.divergences ?? []) push(line);

  return out.slice(0, MAX_SUGGESTIONS);
}

function materiality(claim: Claim): number {
  return claim.materiality === "high" ? 2 : claim.materiality === "medium" ? 1 : 0;
}

/** Suggestions for the newest turn of a session that has one. */
export function suggestionsForTurn(run: CompareRun | undefined): string[] {
  if (!run) return [];
  return suggestFollowUps({ synthesis: run.synthesis, claims: run.claims });
}
