// Atlas Brain engine types (Depth Spec v2, Part A).
//
// Framework-agnostic: NO React, NO zustand, NO browser globals. Everything in
// lib/engine is consumed by Chat/Playground/Code UIs through injected ports
// and plain data — and unit-tested under vitest's node environment.

import type { ChangeRecord } from "@/lib/code/tools";

// ── Task loop (A.1) ─────────────────────────────────────────────────────────

export type Phase =
  | "intake"
  | "clarify"
  | "explore"
  | "plan"
  | "execute"
  | "verify"
  | "self_correct"
  | "review"
  | "deliver"
  | "done"
  | "stopped";

export type TaskClassification = "trivial" | "bounded" | "complex";

export type TodoStatus = "pending" | "active" | "done" | "failed" | "skipped";

/** One plan item with a machine-checkable definition of done. */
export interface Todo {
  id: string;
  text: string;
  /** Acceptance criterion, e.g. "npm test passes for the new module". */
  acceptance: string;
  status: TodoStatus;
  verdicts: Verdict[];
  /** Self-correct attempts consumed so far. */
  attempts: number;
  /** One entry per attempt — retries must state a DIFFERENT strategy. */
  strategyLog: string[];
  /** Safe to run in parallel with other parallelizable todos (read-only work). */
  parallelizable?: boolean;
}

// ── Verification (A.2) ──────────────────────────────────────────────────────

export type CheckKind = "typecheck" | "lint" | "unit" | "build" | "smoke" | "custom";

/** A structured, auditable verification outcome — never vibes. */
export interface Verdict {
  check: CheckKind;
  command: string;
  pass: boolean;
  /** Tail of the command output (capped) — the auditable evidence. */
  evidence: string;
  durationMs: number;
  ts: number;
}

// ── Delivery (A.1 DELIVER) ──────────────────────────────────────────────────

export interface ReportCard {
  files: { path: string; kind: "new" | "modified" | "deleted" }[];
  /** Commands the agent ran (dedup'd, chronological). */
  commands: string[];
  verdicts: Verdict[];
  /** What was machine-verified. */
  verified: string[];
  /** Assumptions made without verification. */
  assumed: string[];
  /** Known-incomplete items. */
  leftUndone: string[];
  costUsd: number;
  tokens: number;
}

export interface TaskState {
  id: string;
  goal: string;
  phase: Phase;
  classification: TaskClassification;
  todos: Todo[];
  exploreSummary?: string;
  /** Bounded self-correct budget per todo (default 3). */
  attemptBudget: number;
  report?: ReportCard;
  /** User messages queued mid-run, injected at the next loop boundary (A.6). */
  steeringQueue: string[];
  paused: boolean;
  stopAfterStep: boolean;
}

// ── Change sets (B.3) ───────────────────────────────────────────────────────

export interface Hunk {
  path: string;
  /** 0-based line offset of the hunk in the BEFORE text. */
  startBefore: number;
  before: string;
  after: string;
  accepted: boolean;
}

export interface ChangeSet {
  id: string;
  taskId: string;
  todoId?: string;
  label: string;
  /** Pre-state snapshot id (reuses the existing Checkpoint mechanism). */
  checkpointId: string;
  records: ChangeRecord[];
  status: "staged" | "applied" | "reverted";
  hunks: Hunk[];
}

// ── Trace (event-sourced log — the single source of truth) ─────────────────

/**
 * Legacy UI event payloads. Structurally identical to the pre-v2 `UiEvent`
 * union in lib/store/code-store.ts (which now re-exports this type) so that
 * existing components and persisted sessions keep working unchanged.
 */
export type LegacyUiEvent =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "assistant";
      id: string;
      text: string;
      reasoning: string;
      streaming: boolean;
      promptTokens?: number;
      completionTokens?: number;
    }
  | {
      kind: "tool";
      id: string;
      name: string;
      args: string;
      result?: string;
      status: "running" | "done" | "error";
      display?: string;
      change?: ChangeRecord;
    }
  | { kind: "system"; id: string; text: string; tone: "info" | "error" };

interface TraceMeta {
  /** Monotonic per-trace sequence number. */
  seq: number;
  ts: number;
  taskId?: string;
  phase?: Phase;
}

/**
 * The append-only trace envelope: legacy UI kinds plus the v2 kinds. Entries
 * are appended in order; an entry may be patched only during its active
 * window (a streaming assistant turn, a running tool) — exactly the pre-v2
 * update discipline.
 */
export type TraceEvent = TraceMeta &
  (
    | LegacyUiEvent
    | { kind: "phase_change"; id: string; from: Phase | null; to: Phase; note?: string }
    | { kind: "todo"; id: string; todos: Todo[] }
    | { kind: "verdict"; id: string; verdict: Verdict; todoId?: string }
    | { kind: "hypothesis"; id: string; text: string; todoId?: string }
    | { kind: "steering"; id: string; text: string }
    | { kind: "compaction"; id: string; beforeTokens: number; afterTokens: number; note?: string }
    | {
        kind: "subagent_span";
        id: string;
        role: string;
        task: string;
        status: "running" | "done" | "error";
        summary?: string;
        toolsUsed?: number;
      }
    | {
        kind: "cost";
        id: string;
        modelId: string;
        promptTokens: number;
        completionTokens: number;
        costUsd: number;
      }
    | {
        kind: "changeset";
        id: string;
        changeSetId: string;
        label: string;
        status: "staged" | "applied" | "reverted";
      }
    | { kind: "checkpoint_ref"; id: string; checkpointId: string; label: string }
  );

export type TraceKind = TraceEvent["kind"];
