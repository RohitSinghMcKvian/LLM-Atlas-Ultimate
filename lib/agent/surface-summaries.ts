import { MAX_SUMMARY_CHARS, type SurfaceContext } from "./surface-context";

/**
 * One line per module, describing what is on screen.
 *
 * Pure functions rather than strings assembled inside each client, for the
 * reason the rest of `lib/` gives: this text goes into a system prompt on every
 * question asked from the dock or from voice, and a sentence built inline in a
 * 900-line component is a sentence nobody can test and everybody eventually
 * duplicates. Each one takes exactly what its module already has in state.
 *
 * ### What belongs in a summary
 *
 * The things that change what a good answer looks like, and nothing else. "The
 * Leaderboard, filtered to free models, sorted by price" changes the answer to
 * "is this one worth it"; "the caching checkbox is unticked" does not, and
 * spending prompt budget on it pushes the retrieved facts out of the window to
 * say something the person can already see.
 *
 * `focus` is separate from `summary` because it is machine-readable: the ids in
 * it are the ones the agent should look up, and `describeSurface` renders them
 * as a list rather than trying to work them out of prose.
 */

/** Trim to the cap on a word boundary, so a summary never ends mid-name. */
export function clampSummary(text: string, max = MAX_SUMMARY_CHARS): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  // One character short of the cap, because the ellipsis is part of the result:
  // slicing to `max` and then appending produced a summary one over the limit,
  // which is the only kind of cap bug that survives a review.
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** "3 models" / "1 model" — the same shape everywhere, so it reads as one voice. */
function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export interface LeaderboardSurfaceInput {
  /** Rows after filtering. */
  matched: number;
  /** Rows in the catalog, so "12 of 400" reads as a narrow filter. */
  total: number;
  sort: string;
  access: "all" | "free" | "byok";
  license: "all" | "open" | "proprietary";
  search: string;
  /** The row someone has expanded, if any. */
  expandedId?: string | null;
  /** Rows ticked for comparison. */
  compareIds?: readonly string[];
}

export function leaderboardSurface(input: LeaderboardSurfaceInput): SurfaceContext {
  const parts = [`${count(input.matched, "model")} of ${input.total}, sorted by ${input.sort}`];
  if (input.access !== "all") {
    parts.push(input.access === "free" ? "free to run" : "needs their own key");
  }
  if (input.license !== "all") parts.push(`${input.license} weights`);
  if (input.search.trim()) parts.push(`searching "${input.search.trim()}"`);
  if (input.compareIds?.length) parts.push(`${count(input.compareIds.length, "model")} ticked`);

  // The expanded row first: it is the thing being looked at, and a question
  // asked with a card open is almost always about that card.
  const focus = [
    ...(input.expandedId ? [input.expandedId] : []),
    ...(input.compareIds ?? []).filter((id) => id !== input.expandedId),
  ];

  return {
    moduleId: "leaderboard",
    summary: clampSummary(parts.join(", ")),
    focus: focus.length ? focus : undefined,
  };
}

export interface CostSurfaceInput {
  selectedIds: readonly string[];
  /** Input tokens per month, as the page models it. */
  inputPerMonth: number;
  outputPerMonth: number;
  /** The benchmark on the frontier chart's x-axis. */
  axis?: string;
}

export function costSurface(input: CostSurfaceInput): SurfaceContext {
  const workload = `${millions(input.inputPerMonth)} in / ${millions(input.outputPerMonth)} out per month`;
  const parts = [
    input.selectedIds.length
      ? `costing ${count(input.selectedIds.length, "model")} at ${workload}`
      : `no models selected yet, workload ${workload}`,
  ];
  if (input.axis) parts.push(`frontier against ${input.axis}`);
  return {
    moduleId: "cost",
    summary: clampSummary(parts.join(", ")),
    focus: input.selectedIds.length ? [...input.selectedIds] : undefined,
  };
}

/** Token counts read as "1.2M", which is how the page shows them and how people say them. */
function millions(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${m >= 10 ? Math.round(m) : Number(m.toFixed(1))}M tokens`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k tokens`;
  return `${tokens} tokens`;
}

export interface NewsSurfaceInput {
  matched: number;
  total: number;
  topics: readonly string[];
  query: string;
  verifiedOnly: boolean;
  savedOnly: boolean;
  /** Title of the story open in the reader, if one is. */
  openTitle?: string;
  openId?: string;
}

export function newsSurface(input: NewsSurfaceInput): SurfaceContext {
  // An open story wins outright. Someone reading one article is asking about
  // that article, and listing the filters behind it is noise.
  if (input.openTitle) {
    return {
      moduleId: "news",
      summary: clampSummary(`reading "${input.openTitle}"`),
      focus: input.openId ? [input.openId] : undefined,
    };
  }
  const parts = [`${count(input.matched, "story", "stories")} of ${input.total}`];
  if (input.topics.length) parts.push(`topics: ${input.topics.join(", ")}`);
  if (input.query.trim()) parts.push(`searching "${input.query.trim()}"`);
  if (input.verifiedOnly) parts.push("corroborated only");
  if (input.savedOnly) parts.push("saved only");
  return { moduleId: "news", summary: clampSummary(parts.join(", ")) };
}

export interface CompareSurfaceInput {
  modelIds: readonly string[];
  /** Whether a run is in flight, which changes what "how is it going" means. */
  running?: boolean;
  question?: string;
}

export function compareSurface(input: CompareSurfaceInput): SurfaceContext {
  const parts = [
    input.modelIds.length
      ? `comparing ${count(input.modelIds.length, "model")}`
      : "no models picked yet",
  ];
  if (input.running) parts.push("a run is in flight");
  if (input.question?.trim()) parts.push(`on "${input.question.trim()}"`);
  return {
    moduleId: "compare",
    summary: clampSummary(parts.join(", ")),
    focus: input.modelIds.length ? [...input.modelIds] : undefined,
  };
}

export interface PlaygroundSurfaceInput {
  modelIds: readonly string[];
  promptChars: number;
  running?: boolean;
}

export function playgroundSurface(input: PlaygroundSurfaceInput): SurfaceContext {
  const parts = [
    input.modelIds.length ? `${count(input.modelIds.length, "model")} loaded` : "no model loaded",
    input.promptChars > 0 ? `${input.promptChars} characters of prompt` : "empty prompt",
  ];
  if (input.running) parts.push("running");
  return {
    moduleId: "playground",
    summary: clampSummary(parts.join(", ")),
    focus: input.modelIds.length ? [...input.modelIds] : undefined,
  };
}
