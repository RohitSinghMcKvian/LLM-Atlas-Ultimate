// Reading citation markers out of an answer.
//
// `lib/research/citations.ts` matches `/\[(\d{1,3})\]/g` — one number, one
// bracket. Models do not write that consistently. Observed live from
// `llama-3-1-8b` given a twelve-source pack:
//
//     "RAG [1, 5, 8] is generally more cost-effective than long-context…"
//
// The shared parser finds nothing there, so the answer was recorded as citing
// zero sources while visibly citing three. Everything built on the count then
// went wrong at once: citation density read as 0, no source showed a "cited by"
// mark, every source looked unused, and — worst — the fabricated-citation check
// had nothing to test, so an invented `[99]` inside a group would pass silently.
//
// This parser handles the forms models actually produce. It is separate from the
// shared one rather than a patch to it because that function is also used to
// *rewrite* answers during renumbering (`reconcileCitations`), where widening the
// match would change text rather than only reading it. The shared parser has the
// same blind spot and is worth fixing there too — it affects chat identically.

/** A bracket group whose contents are only numbers, commas, ranges and spaces. */
const GROUP_RE = /\[([\d\s,;&-]+)\]/g;

/** Upper bound on a citation number, matching the shared parser's 3 digits. */
const MAX_CITATION = 999;

export interface MarkerScan {
  /** Every number referenced, with repeats, in order. */
  all: number[];
  /** Distinct numbers, ascending. */
  distinct: number[];
  /** How many bracket groups were written, e.g. `[1, 5, 8]` counts as one. */
  groups: number;
}

/**
 * Pull every citation number out of `text`.
 *
 * Accepts `[1]`, `[1][2]`, `[1, 5, 8]`, `[1;2]`, `[1 2]` and the range `[1-3]`.
 * Rejects anything with a non-numeric character in it, so `[see above]`,
 * `[TODO]` and markdown links like `[title](url)` are not citations.
 */
export function scanMarkers(text: string): MarkerScan {
  const all: number[] = [];
  let groups = 0;

  for (const match of text.matchAll(GROUP_RE)) {
    const body = match[1];
    // A bare "-" or "," with no digits is punctuation inside brackets, not a
    // citation.
    if (!/\d/.test(body)) continue;

    const numbers: number[] = [];
    let wellFormed = true;

    for (const part of body.split(/[,;&]+/)) {
      const chunk = part.trim();
      if (!chunk) continue;

      const range = /^(\d{1,3})\s*-\s*(\d{1,3})$/.exec(chunk);
      if (range) {
        const from = Number(range[1]);
        const to = Number(range[2]);
        // A descending or absurd range is not a citation range; treat the group
        // as prose rather than inventing numbers that were never written.
        if (to < from || to - from > 50) {
          wellFormed = false;
          break;
        }
        for (let n = from; n <= to; n++) numbers.push(n);
        continue;
      }

      // Space-separated numbers inside one group: "[1 2 3]".
      const loose = chunk.split(/\s+/);
      for (const token of loose) {
        if (!/^\d{1,3}$/.test(token)) {
          wellFormed = false;
          break;
        }
        numbers.push(Number(token));
      }
      if (!wellFormed) break;
    }

    if (!wellFormed || numbers.length === 0) continue;
    if (numbers.some((n) => n > MAX_CITATION)) continue;

    groups++;
    all.push(...numbers);
  }

  return {
    all,
    distinct: [...new Set(all)].sort((a, b) => a - b),
    groups,
  };
}
