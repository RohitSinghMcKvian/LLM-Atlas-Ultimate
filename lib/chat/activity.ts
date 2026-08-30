import type { StoredToolCall } from "./types";

/**
 * What the assistant did, as one readable list.
 *
 * The problem this solves is presentational, but it is not cosmetic. A turn
 * could stack a reasoning card, one bordered card per tool call, a research
 * panel and a plan panel — five or ten boxes, each with its own accent colour
 * and its own chevron, all expanded, all above the answer. The work was visible;
 * the answer was not.
 *
 * So the process is folded into a single line — "Searched the web · 3 more
 * steps" — that expands into the detail on request. Nothing is thrown away, and
 * a failure is never quiet: an errored step promotes to the collapsed summary,
 * because a step that failed is the one thing the user must not have to expand
 * to discover.
 *
 * Pure, so the folding rules are testable without rendering anything.
 */

export type ActivityKind =
  | "thinking"
  | "tool"
  | "artifact"
  | "continuation"
  | "recovery"
  | "truncated"
  | "downgrade"
  | "artifact-error";

export type ActivityStatus = "running" | "done" | "error";

export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  /** One short phrase, past tense: "Searched the web". */
  label: string;
  /** The specific thing it acted on, when there is one. */
  detail?: string;
  status: ActivityStatus;
}

export interface ActivityFold {
  entries: ActivityEntry[];
  /** The collapsed row's text, or null when there is nothing to show. */
  summary: string | null;
  /** True when any step failed, so the collapsed row can say so. */
  hasError: boolean;
}

export interface ActivityInput {
  reasoning?: string;
  toolCalls?: StoredToolCall[];
  /** Resume requests made after the provider truncated the answer. */
  continuations?: number;
  /** The answer is still unfinished: truncated, and out of resume attempts. */
  truncated?: boolean;
  /** Runtime errors the artifact reported from the preview frame. */
  artifactErrors?: string[];
  /**
   * A capability the route refused, so the turn ran without it.
   *
   * Distinct from an error: the answer is real. But a turn that quietly lost its
   * tools is indistinguishable from a model that chose not to use them, and the
   * user's natural next move — asking again, more firmly — cannot work. So it is
   * promoted to the collapsed summary like a failure, while staying a note.
   */
  capabilityDowngrade?: string;
  /**
   * The turn failed to get its file out through a tool call and was re-asked in
   * prose, which worked. See `lib/chat/prose-fallback.ts`.
   *
   * A note rather than an error, because the answer is real — this is the step
   * that used to present a finished build as a failure. It is still said out
   * loud: a build assembled from a second, tool-less request is a real reason
   * the model might have skipped a file, and a user comparing the result against
   * what they asked for deserves to know which path produced it.
   */
  recovered?: string;
  /** The turn is still in flight. */
  streaming?: boolean;
}

/** Past-tense names for the built-in tools. Unknown names fall back to the raw id. */
const TOOL_LABELS: Record<string, string> = {
  web_search: "Searched the web",
  search_past_chats: "Searched past chats",
  memory: "Used memory",
  skill: "Loaded a skill",
  github: "Read from GitHub",
  artifact: "Edited the artifact",
  read_project_file: "Read a project file",
  list_project_files: "Listed project files",
  run_python: "Ran Python",
  tasks: "Updated the plan",
  spawn_subagents: "Ran sub-agents",
  recall_context: "Recalled context",
};

/**
 * `workspace` is seven different actions behind one name, and it is the tool a
 * build spends most of its rounds in — so "Ran workspace" for a whole minute is
 * the least informative thing the live summary could say. The command is in the
 * arguments; use it.
 */
const WORKSPACE_LABELS: Record<string, string> = {
  view: "Read a file",
  create: "Wrote a file",
  append: "Extended a file",
  str_replace: "Edited a file",
  insert: "Edited a file",
  delete: "Deleted a file",
  rename: "Renamed a file",
};

/** Arguments as an object, or null while they are still streaming in. */
function parseArgs(raw?: string): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `mcp__notion__search` reads as "Called search on notion". */
function labelForTool(call: StoredToolCall): string {
  const { name } = call;
  if (name === "workspace") {
    const command = parseArgs(call.arguments)?.command;
    const known = typeof command === "string" ? WORKSPACE_LABELS[command] : undefined;
    if (known) return known;
  }
  const known = TOOL_LABELS[name];
  if (known) return known;
  const mcp = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(name);
  if (mcp) return `Called ${mcp[2]} on ${mcp[1]}`;
  return `Ran ${name}`;
}

/**
 * The argument worth showing next to a tool's name.
 *
 * One field, not the whole object: the collapsed view exists to be scannable,
 * and the full arguments are one click away in the expanded step.
 */
function detailForTool(call: StoredToolCall): string | undefined {
  const args = parseArgs(call.arguments);
  if (!args) return undefined; // no arguments, or still streaming in
  for (const key of ["search_query", "query", "repo", "path", "file", "name", "command", "id"]) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) return v.length > 60 ? `${v.slice(0, 60)}…` : v;
  }
  return undefined;
}

/**
 * A tool result that reads as a failure.
 *
 * Matched on the result text because `ToolResult.isError` is not carried on the
 * stored call. Worth keeping in sync with the refusals in `lib/chat/tools.ts`: a
 * backend that rejected the user's key returns a sentence they can act on, and
 * folding it away as an ordinary step is how it goes unnoticed for a whole turn.
 */
function toolFailed(call: StoredToolCall): boolean {
  const r = call.result;
  if (typeof r !== "string") return false;
  return /^(Unknown tool|Invalid arguments|Arguments for|Could not find|Tool "|Search unavailable|Web search is unavailable|The skill you are following|Connector tool)/.test(
    r,
  );
}

export function buildActivity(input: ActivityInput): ActivityFold {
  const entries: ActivityEntry[] = [];

  if (input.reasoning?.trim() || (input.streaming && !input.toolCalls?.length)) {
    const tokens = Math.max(1, Math.ceil((input.reasoning ?? "").length / 4));
    entries.push({
      id: "thinking",
      kind: "thinking",
      label: input.streaming && !input.reasoning ? "Thinking" : "Thought",
      detail: input.reasoning ? `${tokens.toLocaleString()} tokens` : undefined,
      status: input.streaming ? "running" : "done",
    });
  }

  for (const call of input.toolCalls ?? []) {
    entries.push({
      id: call.id,
      kind: call.name === "artifact" ? "artifact" : "tool",
      label: labelForTool(call),
      detail: detailForTool(call),
      status: call.result === undefined ? "running" : toolFailed(call) ? "error" : "done",
    });
  }

  if (input.continuations)
    entries.push({
      id: "continuation",
      kind: "continuation",
      // Named plainly rather than hidden: the answer arrived in several
      // requests, which is a real thing that happened and a real reason a seam
      // might read oddly.
      label: "Resumed a truncated answer",
      detail: `${input.continuations} ${input.continuations === 1 ? "time" : "times"}`,
      status: "done",
    });

  if (input.recovered)
    entries.push({
      id: "recovery",
      kind: "recovery",
      label: input.recovered,
      status: "done",
    });

  // Placed before `truncated` and the artifact errors so that when several
  // things went sideways at once, the summary names the one that explains the
  // others — a turn with no tools is why nothing was searched, read or written.
  if (input.capabilityDowngrade)
    entries.push({
      id: "downgrade",
      kind: "downgrade",
      label: input.capabilityDowngrade,
      status: "error",
    });

  if (input.truncated)
    entries.push({
      id: "truncated",
      kind: "truncated",
      label: "Answer is still incomplete",
      detail: "the model hit its output limit",
      status: "error",
    });

  if (input.artifactErrors?.length)
    entries.push({
      id: "artifact-error",
      kind: "artifact-error",
      label: "The artifact reported errors",
      detail: `${input.artifactErrors.length}`,
      status: "error",
    });

  const hasError = entries.some((e) => e.status === "error");
  return { entries, summary: summarize(entries, hasError, !!input.streaming), hasError };
}

/**
 * The one line the user sees before expanding anything.
 *
 * A failed step wins the summary slot. Otherwise the first step names the turn
 * and the rest are a count — "Searched the web · 3 more steps" tells you what
 * kind of turn this was without asking you to read six boxes.
 */
function summarize(entries: ActivityEntry[], hasError: boolean, streaming: boolean): string | null {
  if (entries.length === 0) return null;

  const running = entries.find((e) => e.status === "running");
  if (streaming && running) {
    const others = entries.length - 1;
    const verb = running.kind === "thinking" ? "Thinking…" : `${running.label}…`;
    return others > 0 ? `${verb} · ${others} step${others === 1 ? "" : "s"} so far` : verb;
  }

  if (hasError) {
    const failed = entries.find((e) => e.status === "error")!;
    const others = entries.length - 1;
    return others > 0
      ? `${failed.label} · ${others} other step${others === 1 ? "" : "s"}`
      : failed.label;
  }

  const [first, ...rest] = entries;
  const head = first.detail && first.kind !== "thinking" ? `${first.label}: ${first.detail}` : first.label;
  if (rest.length === 0) return first.kind === "thinking" && first.detail ? `Thought for ${first.detail}` : head;
  return `${head} · ${rest.length} more step${rest.length === 1 ? "" : "s"}`;
}
