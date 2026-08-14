/**
 * What an agentic turn is doing, as a structure the panel can render.
 *
 * `activity.ts` folds a finished turn into one line, and that is the right shape
 * for a transcript: process available, not imposed. It is the wrong shape for a
 * run in flight. A twenty-round build takes minutes, and for all of them the
 * reply bubble shows three dots — so a build that is working looks exactly like
 * one that has hung, and the honest report at the end arrives long after the
 * user has decided it failed.
 *
 * So the run gets its own surface, and this is its model: steps in order, each
 * with a body shaped by what the tool actually did — search results, a diff
 * stat, a terminal — plus the two numbers that make an agent's spending legible.
 *
 * Pure, because `vitest.config.ts` only reaches `lib/**` and this is the part
 * worth testing. `run-panel.tsx` is rendering over it and nothing else.
 */

import { decodeSubagentProgress, type SubagentState } from "./subagent";
import type { StoredToolCall, WebSource } from "./types";

export type StepStatus = "running" | "done" | "error";

export type RunBody =
  | { kind: "search"; sources: WebSource[]; query?: string }
  | { kind: "diff"; path: string; summary: string }
  | { kind: "terminal"; text: string; failed: boolean }
  | { kind: "tasks"; summary: string }
  /**
   * A fan-out, nested. Reconstructed live from the tool's progress stream, so
   * the user watches three investigations fill in rather than waiting on one
   * opaque call — and sees what each one cost while it is still running.
   */
  | { kind: "subagents"; agents: SubagentState[] }
  | { kind: "raw"; args?: string; result?: string };

export interface RunStep {
  id: string;
  kind: "thinking" | "tool" | "note";
  /** One short phrase: "Searched the web". */
  label: string;
  /** The specific thing it acted on. */
  detail?: string;
  status: StepStatus;
  body: RunBody;
}

export interface RunMeters {
  rounds: number;
  maxRounds: number;
  spentUsd: number;
  maxUsd: number;
  /** 0–1, for the bar. Clamped, because a provider can report past a ceiling. */
  roundsRatio: number;
  costRatio: number;
}

export interface RunInput {
  toolCalls?: StoredToolCall[];
  reasoning?: string;
  /** Live output per tool-call id, for tools that stream. */
  progress?: Record<string, string>;
  streaming?: boolean;
  rounds?: number;
  maxRounds?: number;
  spentUsd?: number;
  maxUsd?: number;
  /** The stop, once one has happened. */
  stoppedBy?: string;
}

export interface Run {
  steps: RunStep[];
  /** One line for the panel header, and for the bubble while it is empty. */
  headline: string;
  meters: RunMeters;
  hasError: boolean;
}

const LABELS: Record<string, string> = {
  web_search: "Searched the web",
  search_past_chats: "Searched past chats",
  recall_context: "Recalled earlier turns",
  spawn_subagents: "Ran sub-agents",
  memory: "Used memory",
  skill: "Loaded a skill",
  github: "Read from GitHub",
  artifact: "Edited the artifact",
  read_project_file: "Read a project file",
  list_project_files: "Listed project files",
  workspace: "Wrote to the workspace",
  tasks: "Updated the plan",
  run_python: "Ran Python",
};

/** Present tense, for a step that has not finished. Used by the live status line. */
const RUNNING_LABELS: Record<string, string> = {
  web_search: "Searching the web",
  search_past_chats: "Searching past chats",
  recall_context: "Recalling earlier turns",
  spawn_subagents: "Running sub-agents",
  memory: "Reading memory",
  skill: "Loading a skill",
  github: "Reading from GitHub",
  artifact: "Editing the artifact",
  read_project_file: "Reading a project file",
  list_project_files: "Listing project files",
  workspace: "Writing files",
  tasks: "Updating the plan",
  run_python: "Running Python",
};

/** `mcp__notion__search` reads as "Called search on notion". */
function labelFor(name: string, running: boolean): string {
  const known = (running ? RUNNING_LABELS : LABELS)[name];
  if (known) return known;
  const mcp = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(name);
  if (mcp) return `${running ? "Calling" : "Called"} ${mcp[2]} on ${mcp[1]}`;
  return `${running ? "Running" : "Ran"} ${name}`;
}

function args(call: StoredToolCall): Record<string, unknown> {
  if (!call.arguments) return {};
  try {
    const parsed: unknown = JSON.parse(call.arguments);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {}; // still streaming in
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

/** The argument worth showing beside the label. One field, not the whole object. */
export function detailFor(call: StoredToolCall): string | undefined {
  const a = args(call);
  for (const key of ["search_query", "query", "path", "file_name", "repo", "step", "skill_id", "command"]) {
    const v = str(a[key]);
    if (v) return v.length > 64 ? `${v.slice(0, 64)}…` : v;
  }
  return undefined;
}

/** A result that reads as a failure. Kept in step with the refusals in tools.ts. */
export function resultFailed(result: string | undefined): boolean {
  if (typeof result !== "string") return false;
  return /^(Unknown tool|Invalid arguments|Arguments for|Could not find|Tool "|Search unavailable|Web search is unavailable|The skill you are following|Connector tool|The (build )?workspace is unavailable|The Python sandbox)/i.test(
    result,
  );
}

/** Numbered search results, parsed back out of what the tool handed the model. */
function parseSources(result: string): WebSource[] {
  const out: WebSource[] = [];
  for (const block of result.split(/\n\n+/)) {
    const m = /^\[(\d+)\]\s+([^\n]*)\n(\S+)\n?([\s\S]*)$/.exec(block.trim());
    if (m) out.push({ title: m[2].trim(), url: m[3].trim(), snippet: m[4].trim() });
  }
  return out;
}

/**
 * The right body for a step, from the tool that produced it.
 *
 * This is what makes a run legible rather than a list of names: a search shows
 * what it found, a write shows what changed, an execution shows its terminal.
 * Falls back to raw arguments and result, which is what the old tool card showed
 * for everything.
 */
export function bodyFor(call: StoredToolCall, progress?: string): RunBody {
  const a = args(call);
  const result = call.result;

  if (call.name === "run_python") {
    // Live output while it runs, the recorded result once it has finished.
    const text = call.result ?? progress ?? "";
    return { kind: "terminal", text, failed: !!result && resultFailed(result) };
  }

  if (call.name === "spawn_subagents") {
    const agents = decodeSubagentProgress(progress);
    // Falls through to `raw` when no frame has arrived, so a fan-out that was
    // refused before it started shows its refusal rather than an empty list of
    // agents that never existed.
    if (agents) return { kind: "subagents", agents };
  }

  if (call.name === "web_search" && result && !resultFailed(result)) {
    return { kind: "search", sources: parseSources(result), query: str(a.search_query) };
  }

  if (call.name === "workspace" || call.name === "artifact") {
    const command = str(a.command) ?? "";
    const path = str(a.path) ?? str(a.file_path) ?? "";
    // A read is not a change, so it does not get a diff body.
    if (result && !/^(view|read|list|glob|grep)$/.test(command)) {
      return { kind: "diff", path, summary: result.split("\n")[0]?.slice(0, 160) ?? "" };
    }
  }

  if (call.name === "tasks" && result) {
    return { kind: "tasks", summary: result.split("\n")[0]?.slice(0, 200) ?? "" };
  }

  return { kind: "raw", args: call.arguments, result };
}

function statusOf(call: StoredToolCall): StepStatus {
  if (call.result === undefined) return "running";
  return resultFailed(call.result) ? "error" : "done";
}

export function buildRun(input: RunInput): Run {
  const steps: RunStep[] = [];

  if (input.reasoning?.trim() || (input.streaming && !input.toolCalls?.length)) {
    const tokens = Math.max(1, Math.ceil((input.reasoning ?? "").length / 4));
    steps.push({
      id: "thinking",
      kind: "thinking",
      label: input.streaming && !input.reasoning ? "Thinking" : "Thought",
      detail: input.reasoning ? `${tokens.toLocaleString()} tokens` : undefined,
      status: input.streaming ? "running" : "done",
      body: { kind: "raw", result: input.reasoning },
    });
  }

  for (const call of input.toolCalls ?? []) {
    const status = statusOf(call);
    steps.push({
      id: call.id,
      kind: "tool",
      label: labelFor(call.name, status === "running"),
      detail: detailFor(call),
      status,
      body: bodyFor(call, input.progress?.[call.id]),
    });
  }

  if (input.stoppedBy) {
    steps.push({
      id: "stop",
      kind: "note",
      label: input.stoppedBy,
      status: "error",
      body: { kind: "raw" },
    });
  }

  const rounds = input.rounds ?? 0;
  const maxRounds = input.maxRounds ?? 0;
  const spentUsd = input.spentUsd ?? 0;
  const maxUsd = input.maxUsd ?? 0;

  return {
    steps,
    headline: headlineFor(steps, !!input.streaming),
    hasError: steps.some((s) => s.status === "error"),
    meters: {
      rounds,
      maxRounds,
      spentUsd,
      maxUsd,
      roundsRatio: maxRounds > 0 ? Math.min(1, rounds / maxRounds) : 0,
      costRatio: maxUsd > 0 ? Math.min(1, spentUsd / maxUsd) : 0,
    },
  };
}

/**
 * The one line shown while the bubble is still empty.
 *
 * Three dots for forty seconds reads as hung. Naming the step in progress is the
 * cheapest possible fix and the difference between "it is working" and "it has
 * stopped", which is the single most common misreading of a long agentic turn.
 */
export function headlineFor(steps: RunStep[], streaming: boolean): string {
  const running = steps.find((s) => s.status === "running");
  if (streaming && running) {
    return running.detail ? `${running.label} · ${running.detail}` : `${running.label}…`;
  }

  const failed = steps.find((s) => s.status === "error");
  if (failed) return failed.label;

  if (!steps.length) return streaming ? "Working…" : "";

  const tools = steps.filter((s) => s.kind === "tool").length;
  if (!tools) return steps[0].label;
  return `${tools} step${tools === 1 ? "" : "s"}`;
}

/** "Wrote 6 files · 3 python runs · 42s · $0.31" — the run, in one sentence. */
export function summarizeRun(
  calls: StoredToolCall[],
  elapsedMs: number,
  spentUsd: number,
): string {
  const writes = calls.filter(
    (c) =>
      (c.name === "workspace" || c.name === "artifact") &&
      !/"command"\s*:\s*"(view|read|list|glob|grep)"/.test(c.arguments ?? ""),
  ).length;
  const runs = calls.filter((c) => c.name === "run_python").length;
  const searches = calls.filter((c) => c.name === "web_search").length;

  const parts: string[] = [];
  if (writes) parts.push(`${writes} file${writes === 1 ? "" : "s"} written`);
  if (runs) parts.push(`${runs} python run${runs === 1 ? "" : "s"}`);
  if (searches) parts.push(`${searches} search${searches === 1 ? "" : "es"}`);
  if (elapsedMs > 0) parts.push(`${Math.max(1, Math.round(elapsedMs / 1000))}s`);
  if (spentUsd > 0) parts.push(`$${spentUsd.toFixed(2)}`);
  return parts.join(" · ");
}
