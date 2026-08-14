import type { WebSource } from "@/lib/chat/types";

/**
 * Citation integrity for research answers (spec §4.6).
 *
 * A research answer's whole value is that its claims are checkable. Two failure
 * modes destroy that, and both are things models do routinely:
 *
 *  1. **Citing a number that does not exist.** `[9]` when eight sources were
 *     retrieved. The marker looks authoritative and points at nothing.
 *  2. **Citing sources that were never used.** Twenty sources go in, the answer
 *     draws on four, and the UI shows twenty — implying corroboration that was
 *     never read.
 *
 * So the answer is reconciled against the list it was actually given: invalid
 * markers are removed, the cited sources are collected in order of first
 * appearance, and the markers are renumbered to match. What the user sees under
 * the answer is then exactly what the answer cites, in the order it cites them.
 *
 * Pure and free of React so the rules can be tested directly.
 */

/** `[1]`, `[12]`, and the `[1][2]` runs models write. Not `[foo]`. */
const CITATION_RE = /\[(\d{1,3})\]/g;

export interface ReconciledAnswer {
  /** The answer with markers renumbered and invalid ones removed. */
  text: string;
  /** Only the sources actually cited, in order of first citation. */
  sources: WebSource[];
  /** Numbers the model used that did not exist. Reported, not hidden. */
  invalid: number[];
  /** True when the answer cited nothing at all. */
  uncited: boolean;
}

/** Every distinct citation number in `text`, in order of first appearance. */
export function citedNumbers(text: string): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const m of text.matchAll(CITATION_RE)) {
    const n = Number(m[1]);
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/**
 * Reconcile an answer with the sources it was given.
 *
 * Renumbering is deliberate rather than cosmetic: after dropping uncited sources
 * the original numbers no longer index the displayed list, so leaving them would
 * point every marker at the wrong entry — a worse outcome than not renumbering at
 * all.
 */
export function reconcileCitations(
  answer: string,
  available: WebSource[],
): ReconciledAnswer {
  const used = citedNumbers(answer);
  const invalid: number[] = [];
  const keep: number[] = [];

  for (const n of used) {
    // 1-indexed, as the context block presents them.
    if (n >= 1 && n <= available.length) keep.push(n);
    else invalid.push(n);
  }

  // old number -> new number, assigned in order of first citation.
  const renumber = new Map<number, number>();
  keep.forEach((oldN, i) => renumber.set(oldN, i + 1));

  const text = answer.replace(CITATION_RE, (whole, digits: string) => {
    const next = renumber.get(Number(digits));
    // An invalid marker is removed outright. Leaving it would keep pointing at
    // nothing; rewriting it to a valid number would invent a citation the model
    // never made, which is the worse of the two.
    return next === undefined ? "" : `[${next}]`;
  });

  return {
    text: tidySpacing(text),
    sources: keep.map((n) => available[n - 1]),
    invalid,
    uncited: keep.length === 0,
  };
}

/**
 * Clean up the gaps removing a marker leaves behind.
 *
 * Only whitespace and the stray space-before-punctuation case — nothing that
 * could change wording. Rewriting an answer's prose to tidy it up would be a
 * different and much less defensible operation than deleting a bad marker.
 */
function tidySpacing(s: string): string {
  return s
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:!?)])/g, "$1")
    .replace(/\(\s+\)/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * Warn when an answer's grounding looks thin.
 *
 * Advisory, shown to the user — never used to suppress or rewrite the answer.
 * The judgement of whether thin grounding matters belongs to the reader, who can
 * see the question; this function cannot.
 */
export function groundingWarning(r: ReconciledAnswer, searched: boolean): string | null {
  if (!searched) return null;
  if (r.uncited) {
    return "This answer cites none of the sources found. Treat it as unverified.";
  }
  if (r.invalid.length) {
    return `Removed ${r.invalid.length} citation${r.invalid.length === 1 ? "" : "s"} pointing at sources that were not retrieved.`;
  }
  return null;
}
