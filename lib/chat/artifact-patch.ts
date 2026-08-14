/**
 * Editing an artifact by replacing a fragment of it.
 *
 * The long-context problem, concretely: changing the headline of a 900-line
 * landing page used to mean re-emitting all 900 lines. That is slow, expensive,
 * runs into the same output limit that truncated the page in the first place,
 * and gives the model 900 fresh chances to change something it was not asked to
 * change. A patch costs the two fragments.
 *
 * The rules are deliberately unforgiving, because a silent partial apply to a
 * document nobody re-reads is worse than a refusal:
 *
 *  - The match is **exact**. No whitespace normalising, no fuzzy matching.
 *  - The match must be **unique**. Two occurrences means the caller was not
 *    specific enough, and guessing which one they meant is how the wrong button
 *    gets restyled.
 *  - No match is an **error**, never a no-op that reports success.
 */

export type PatchFailure = "not-found" | "ambiguous" | "empty" | "unchanged";

export interface PatchResult {
  ok: boolean;
  code: string;
  failure?: PatchFailure;
  /** Occurrences found, so an ambiguity message can say how many. */
  occurrences: number;
}

function countOccurrences(haystack: string, needle: string): number {
  let n = 0;
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) return n;
    n++;
    from = i + needle.length;
  }
}

/**
 * Replace one exact, unique fragment.
 *
 * Returns the original code untouched on every failure path, so a caller that
 * ignores `ok` cannot corrupt the artifact — it can only fail to change it.
 */
export function applyArtifactPatch(code: string, oldStr: string, newStr: string): PatchResult {
  if (!oldStr) return { ok: false, code, failure: "empty", occurrences: 0 };
  if (oldStr === newStr) return { ok: false, code, failure: "unchanged", occurrences: 0 };

  const occurrences = countOccurrences(code, oldStr);
  if (occurrences === 0) return { ok: false, code, failure: "not-found", occurrences: 0 };
  if (occurrences > 1) return { ok: false, code, failure: "ambiguous", occurrences };

  const at = code.indexOf(oldStr);
  return {
    ok: true,
    code: code.slice(0, at) + newStr + code.slice(at + oldStr.length),
    occurrences: 1,
  };
}

/**
 * What to tell the model when a patch did not apply.
 *
 * Written to be actionable rather than merely accurate: each message names the
 * next thing to try, because the alternative is the model retrying the identical
 * patch and burning a round.
 */
export function describePatchFailure(result: PatchResult, oldStr: string): string {
  const preview = oldStr.length > 80 ? `${oldStr.slice(0, 80)}…` : oldStr;
  switch (result.failure) {
    case "empty":
      return "`old_str` was empty. It must be the exact text to replace.";
    case "unchanged":
      return "`old_str` and `new_str` are identical, so there is nothing to change.";
    case "ambiguous":
      return (
        `Found ${result.occurrences} occurrences of that text, so it is ambiguous. ` +
        "Include more surrounding lines in `old_str` so it matches exactly one place."
      );
    default:
      return (
        `Could not find that text in the artifact: ${JSON.stringify(preview)}. ` +
        "It must match the current source character for character, including indentation. " +
        "Use `read` to see the current source."
      );
  }
}

/** A short, human-readable summary of what a successful patch did. */
export function summarizePatch(oldStr: string, newStr: string): string {
  const removed = oldStr.split("\n").length;
  const added = newStr.split("\n").length;
  if (!newStr) return `Removed ${removed} line${removed === 1 ? "" : "s"}.`;
  return `Replaced ${removed} line${removed === 1 ? "" : "s"} with ${added}.`;
}
