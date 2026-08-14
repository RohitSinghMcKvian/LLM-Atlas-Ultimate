/**
 * Turning "I highlighted this bit" into something the patch tool can act on.
 *
 * `applyArtifactPatch` refuses anything that is not exact and unique, which is
 * the right contract — a silent partial apply to a document nobody re-reads is
 * worse than a refusal. But a raw selection almost never satisfies it: highlight
 * `class="btn"` on a page with six buttons and the patch is ambiguous;
 * highlight three characters and it occurs everywhere.
 *
 * So the selection is *grown* until it is unique, along boundaries a person
 * would recognise — the whole line first, then whole lines outward. The result
 * is a snippet the model can be handed with "replace exactly this", and the same
 * unique-match rule that makes patching safe now makes it usable.
 *
 * Pure, and the interesting half of highlight-to-edit.
 */

export interface SelectionAnchor {
  /** The exact text to hand the patch tool. Unique in `source` when `ok`. */
  snippet: string;
  start: number;
  end: number;
  ok: boolean;
  /** Why it could not be anchored. */
  reason?: "empty" | "not-unique";
  /** Occurrences of the final snippet, so a message can say how many. */
  occurrences: number;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) return n;
    n++;
    from = i + needle.length;
  }
}

/** Extend [start, end) outward to the enclosing line boundaries. */
function toLineBounds(source: string, start: number, end: number): [number, number] {
  const lineStart = source.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nl = source.indexOf("\n", end);
  return [lineStart, nl === -1 ? source.length : nl];
}

/** One more line above and below, stopping at the ends of the document. */
function grow(source: string, start: number, end: number): [number, number] | null {
  const above = start > 0 ? source.lastIndexOf("\n", start - 2) + 1 : start;
  const below = end < source.length ? source.indexOf("\n", end + 1) : end;
  const nextStart = start > 0 ? above : start;
  const nextEnd = end < source.length ? (below === -1 ? source.length : below) : end;
  if (nextStart === start && nextEnd === end) return null;
  return [nextStart, nextEnd];
}

/**
 * How far the snippet may grow before giving up.
 *
 * A selection that is still ambiguous after forty lines is not a selection
 * problem — it is a document with forty identical lines in it, and the honest
 * answer is to ask the user to say what they want changed rather than to send
 * the model half the file and hope.
 */
export const MAX_GROW_STEPS = 40;

/**
 * Anchor a selection to a unique snippet.
 *
 * Trims the raw selection first: a highlight that swept up the trailing newline
 * or the indentation of the next line is the common case, and both change what
 * "exact" matches.
 */
export function anchorSelection(source: string, from: number, to: number): SelectionAnchor {
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.min(source.length, Math.max(from, to));
  if (lo >= hi || !source.slice(lo, hi).trim()) {
    return { snippet: "", start: lo, end: hi, ok: false, reason: "empty", occurrences: 0 };
  }

  // Exact selection first: if the user highlighted something already unique,
  // patching exactly that is the smallest possible change.
  const raw = source.slice(lo, hi);
  if (countOccurrences(source, raw) === 1) {
    return { snippet: raw, start: lo, end: hi, ok: true, occurrences: 1 };
  }

  let [start, end] = toLineBounds(source, lo, hi);
  for (let step = 0; step <= MAX_GROW_STEPS; step++) {
    const snippet = source.slice(start, end);
    if (countOccurrences(source, snippet) === 1) {
      return { snippet, start, end, ok: true, occurrences: 1 };
    }
    const next = grow(source, start, end);
    if (!next) break; // reached both ends of the document
    [start, end] = next;
  }

  const snippet = source.slice(start, end);
  return {
    snippet,
    start,
    end,
    ok: false,
    reason: "not-unique",
    occurrences: countOccurrences(source, snippet),
  };
}

/**
 * The instruction handed to the model.
 *
 * Names the file and quotes the snippet in full rather than describing it: the
 * model's job is to produce a replacement for exactly this text, and any
 * paraphrase of "the bit around line 40" reintroduces the ambiguity the anchor
 * just removed.
 */
export function selectionEditPrompt(
  path: string | undefined,
  snippet: string,
  instruction: string,
): string {
  const where = path ? ` in \`${path}\`` : "";
  return [
    `Update the artifact${where}. Replace exactly this text:`,
    "",
    "```",
    snippet,
    "```",
    "",
    `Change requested: ${instruction}`,
    "",
    "Use the `artifact` tool's patch command with this exact string as `old_str`. Change nothing else.",
  ].join("\n");
}
