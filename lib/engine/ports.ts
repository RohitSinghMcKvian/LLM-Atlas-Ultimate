// Ports (Depth Spec v2 Part E): the engine talks to the app exclusively
// through these injected interfaces — no React, no zustand, no direct
// workspace/runAgent imports. The Code store builds a TaskPorts from its
// existing plumbing; tests build fakes.

import type { ToolDef } from "@/lib/router";
import type { ToolExecution } from "@/lib/code/tools";
import type { TraceInput } from "./trace";
import type { Phase, Todo, Verdict } from "./types";

export interface ExecResultLike {
  code: number;
  output: string;
  timedOut?: boolean;
}

/** One phase-scoped agent run (wraps lib/code/agent.ts runAgent). */
export interface AgentPhaseRun {
  goal: string;
  phase: Phase;
  /** Read-only toolset (explore/plan/review phases). */
  readonly: boolean;
  /** Override the built-in system prompt for this phase. */
  systemPrompt?: string;
  extraTools?: ToolDef[];
  onCustomTool?: (name: string, argsJson: string) => Promise<ToolExecution | null>;
  /**
   * Conversation to run on. Omit ⇒ continue the session history (and persist
   * the updated history back). Pass [] ⇒ fresh context (review subagent).
   */
  history?: unknown[];
  maxIterations?: number;
}

export interface AgentPhaseResult {
  /** The model's final plain-text reply ("" when it errored out). */
  summary: string;
  /** False when the run ended in an error event (iteration cap, router error). */
  ok: boolean;
}

export interface TaskPorts {
  /** Run one agent phase. Rejections/aborts propagate to the loop. */
  agent: (run: AgentPhaseRun) => Promise<AgentPhaseResult>;
  /** One cheap, non-streaming completion (intake classification). */
  llm: (system: string, user: string, maxTokens?: number) => Promise<string>;
  /** Shell in the workspace (verification commands). */
  exec: (cmd: string, timeoutMs?: number) => Promise<ExecResultLike>;
  readFile: (path: string) => Promise<string | null>;
  listPaths: () => Promise<string[]>;
  /** File changes recorded so far in this session (for review/report). */
  changes: () => { path: string; before: string | null; after: string | null }[];
  /**
   * ChangeRecords produced since a marker (for per-todo change-set grouping,
   * B.3). Returns the raw records so the store can build/review a ChangeSet.
   */
  changesSince?: (marker: number) => import("@/lib/code/tools").ChangeRecord[];
  /** Total ChangeRecord count — used as a change-set marker. */
  changeCount?: () => number;
  /** Present a change set for per-hunk review; resolves when applied/reverted. */
  reviewChangeSet?: (records: import("@/lib/code/tools").ChangeRecord[], label: string, checkpointId: string, todoId: string) => Promise<void>;
  /** Latest checkpoint id (the per-todo pre-state snapshot). */
  lastCheckpointId?: () => string | null;
  /** Checkpoint the workspace (before each execute todo). */
  snapshot: (label: string) => Promise<void>;
  /** Append to the event-sourced trace. */
  trace: (input: TraceInput) => void;
  /**
   * Surface the proposed plan for user approval. Resolve with the (possibly
   * edited) todos to proceed, or null to stop. Absent ⇒ auto-approve.
   */
  approvePlan?: (todos: Todo[]) => Promise<Todo[] | null>;
  /**
   * Ask the batched clarifying questions. Resolve with the user's answer, or
   * null to proceed on stated assumptions. Absent ⇒ never ask.
   */
  clarify?: (questions: string[]) => Promise<string | null>;
  /** Optional runtime smoke check (dev-server reachability). */
  smoke?: () => Promise<Verdict | null>;
  /** Drain queued mid-run user messages (A.6) — called at loop boundaries. */
  drainSteering?: () => string[];
  /** Pause gate — resolves when the user un-pauses. */
  gate?: () => Promise<void>;
  /** A.6 stop-after-current-step: true ⇒ finish the current todo, then stop. */
  shouldStopAfterStep?: () => boolean;
  /** A.3 bisect availability: are there checkpoints to roll back against? */
  hasCheckpoints?: () => boolean;
  /**
   * B.1 ATLAS.md learning: propose durable conventions after delivery; resolve
   * true when the user accepted the proposed additions.
   */
  proposeAtlasMd?: (summary: string) => Promise<boolean>;
  /** Live usage for the report card. */
  usage?: () => { costUsd: number; tokens: number };
  uid: () => string;
}
