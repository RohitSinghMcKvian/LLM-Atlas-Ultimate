// Did the answer actually use the evidence it was given?
//
// The shared-evidence design only means something if you can check it was used.
// Three questions, all answerable from the text and the pack with no model call:
//
//   * **Grounding.** How much of the answer is tied to a source at all.
//   * **Fabrication.** A marker pointing at a number the pack does not contain is
//     a model inventing a citation, which is worse than not citing — it reads as
//     evidence and is not. This is the single most valuable free signal in the run.
//   * **Coverage.** Which sources nobody read. A source no lane cited is either
//     irrelevant, or the thing they all missed.
//
// Markers are read by `./markers.ts` rather than by the shared
// `citedNumbers`, which only matches a single number in a single bracket. Live
// output routinely groups them — `[1, 5, 8]` — and the shared parser scores that
// as citing nothing, which silently zeroes every figure below it.

import { scanMarkers } from "./markers";

export interface CitationProfile {
  /** Distinct source numbers cited, in order. */
  cited: number[];
  /** Total markers, counting repeats — how often the answer points at evidence. */
  markers: number;
  /** Markers per hundred words. */
  density: number;
  /**
   * Numbers cited that the pack does not contain.
   *
   * Not a rounding error: a `[14]` against twelve sources is a fabricated
   * citation, and the answer reads as grounded when it is not.
   */
  fabricated: number[];
}

export function profileCitations(text: string, sourceCount: number): CitationProfile {
  const scan = scanMarkers(text);
  const words = text.split(/\s+/).filter(Boolean).length;

  // Every reference, repeats included: an answer citing [1] eight times is
  // leaning on one source, and that is different from citing eight.
  const markers = scan.all.length;

  return {
    cited: scan.distinct.filter((n) => n >= 1 && n <= sourceCount),
    markers,
    density: words > 0 ? Math.round((markers / words) * 1000) / 10 : 0,
    fabricated: scan.distinct.filter((n) => n < 1 || n > sourceCount),
  };
}

export interface SourceUsage {
  /** 1-based source number. */
  n: number;
  /** Lane ids that cited it. */
  laneIds: string[];
}

export interface CoverageReport {
  usage: SourceUsage[];
  /** Sources no lane cited. */
  unused: number[];
  /** Sources every answering lane cited — the common ground of the run. */
  universal: number[];
  /** Share of the pack that was cited at least once, 0-1. */
  coverage: number;
}

/**
 * Which lanes cited which source.
 *
 * `answered` is the set of lanes that produced text at all — a blocked or failed
 * lane must not make a source look neglected, and must not make "every lane
 * cited this" impossible to reach.
 */
export function sourceCoverage(
  lanes: { id: string; text: string }[],
  sourceCount: number,
): CoverageReport {
  const answered = lanes.filter((l) => l.text.trim().length > 0);
  const usage: SourceUsage[] = Array.from({ length: sourceCount }, (_, i) => ({
    n: i + 1,
    laneIds: [],
  }));

  for (const lane of answered) {
    for (const n of scanMarkers(lane.text).distinct) {
      if (n >= 1 && n <= sourceCount) usage[n - 1].laneIds.push(lane.id);
    }
  }

  const unused = usage.filter((u) => u.laneIds.length === 0).map((u) => u.n);
  const universal =
    answered.length > 0
      ? usage.filter((u) => u.laneIds.length === answered.length).map((u) => u.n)
      : [];

  return {
    usage,
    unused,
    universal,
    coverage: sourceCount > 0 ? (sourceCount - unused.length) / sourceCount : 0,
  };
}

/**
 * One line about how grounded a lane is, for the scorecard.
 *
 * Leads with fabrication when there is any: it is the finding that changes what
 * the reader should do with the answer.
 */
export function describeCitations(profile: CitationProfile, sourceCount: number): string {
  if (sourceCount === 0) return "No sources were provided for this run.";
  if (profile.fabricated.length > 0) {
    const list = profile.fabricated.map((n) => `[${n}]`).join(", ");
    return `Cited ${list}, which ${profile.fabricated.length === 1 ? "does" : "do"} not exist in the pack.`;
  }
  if (profile.cited.length === 0) return "Cited nothing — this answer is ungrounded.";
  return `Cited ${profile.cited.length} of ${sourceCount} sources.`;
}
