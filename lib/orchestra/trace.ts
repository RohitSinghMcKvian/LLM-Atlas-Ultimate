import type { RoleId } from "./roles";

/**
 * The append-only record of a run.
 *
 * Two problems it closes at once. Plans lived in component state, so an
 * interrupted run could not resume and nothing could be audited after the fact.
 * And observability was turn-scoped - `RunPanel` shows one live turn,
 * `ActivityTimeline` folds one finished turn - so nothing could answer "what has
 * this session done, in what order, at what cost".
 *
 * The discipline is `lib/engine/trace.ts`'s, for the reasons it gives: events
 * are append-only with a monotonic `seq`, and once an event is stamped its `seq`
 * and `ts` are immutable. A trace whose timestamps can be rewritten is not
 * evidence of anything.
 *
 * Pure. Storage lives in `lib/orchestra/store.ts`.
 */

export type OrchestraEventKind =
  | "run_start"
  | "plan"
  | "step_start"
  | "step_end"
  | "agent_start"
  | "agent_end"
  | "tool_call"
  | "tool_result"
  | "graph_hit"
  | "source"
  | "spend"
  | "approval"
  | "error"
  | "run_end";

export interface OrchestraEvent {
  /** Monotonic within a run. Assigned by `append`, never by a caller. */
  seq: number;
  ts: number;
  kind: OrchestraEventKind;
  /** Which sub-agent this belongs to, when it belongs to one. */
  agentId?: string;
  role?: RoleId;
  /** Which plan step, when there is one. */
  stepId?: string;
  /** Short human line. The Log tab renders this. */
  text: string;
  /** Kind-specific detail. Kept flat and small - a trace is not a document store. */
  data?: Record<string, string | number | boolean>;
}

export type RunStatus = "running" | "done" | "stopped" | "failed";

export interface OrchestraRun {
  id: string;
  conversationId: string;
  goal: string;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  /** USD charged so far, mirrored out of the budget for cheap reads. */
  spentUsd: number;
  events: OrchestraEvent[];
}

export function startRun(id: string, conversationId: string, goal: string, now = Date.now()): OrchestraRun {
  return {
    id,
    conversationId,
    goal,
    status: "running",
    startedAt: now,
    spentUsd: 0,
    events: [{ seq: 0, ts: now, kind: "run_start", text: goal }],
  };
}

export type NewEvent = Omit<OrchestraEvent, "seq" | "ts">;

/**
 * Append one event.
 *
 * Returns a new run rather than mutating: the store persists whole runs, and a
 * mutated array shared with a React state slot is how a trace ends up rendered
 * one event behind itself.
 */
export function append(run: OrchestraRun, event: NewEvent, now = Date.now()): OrchestraRun {
  const seq = run.events.length === 0 ? 0 : run.events[run.events.length - 1].seq + 1;
  const stamped: OrchestraEvent = { ...event, seq, ts: now };
  const spentUsd =
    event.kind === "spend" && typeof event.data?.usd === "number"
      ? run.spentUsd + event.data.usd
      : run.spentUsd;
  return { ...run, spentUsd, events: [...run.events, stamped] };
}

export function appendMany(run: OrchestraRun, events: NewEvent[], now = Date.now()): OrchestraRun {
  return events.reduce((acc, e) => append(acc, e, now), run);
}

export function endRun(run: OrchestraRun, status: RunStatus, text: string, now = Date.now()): OrchestraRun {
  if (run.status !== "running") return run;
  const ended = append(run, { kind: "run_end", text }, now);
  return { ...ended, status, endedAt: now };
}

/**
 * Reject an event that would rewrite history.
 *
 * Used by the store on load: a persisted run is untrusted input in exactly the
 * way a connector response is - it may have been written by an older build, or
 * edited. A trace that silently accepts a non-monotonic `seq` is a trace whose
 * ordering means nothing.
 */
export function isWellFormed(run: OrchestraRun): boolean {
  if (!run.id || !run.conversationId) return false;
  let lastSeq = -1;
  let lastTs = -Infinity;
  for (const e of run.events) {
    if (e.seq <= lastSeq) return false;
    // Timestamps may repeat - several events can land in the same millisecond -
    // but never go backwards.
    if (e.ts < lastTs) return false;
    lastSeq = e.seq;
    lastTs = e.ts;
  }
  return true;
}

export interface AgentSpan {
  agentId: string;
  role?: RoleId;
  title: string;
  startedAt: number;
  endedAt?: number;
  status: "running" | "done" | "error";
  toolCalls: number;
  spentUsd: number;
}

/**
 * Project the trace into swimlanes.
 *
 * The Agents view needs one row per sub-agent with a start, an end and what
 * happened between; the trace stores that as a flat event stream because that
 * is the only shape that appends cleanly. Doing the projection here rather than
 * in the component keeps it testable - `vitest.config.ts` only reaches `lib/`.
 */
export function spansOf(run: OrchestraRun): AgentSpan[] {
  const byId = new Map<string, AgentSpan>();
  for (const e of run.events) {
    if (!e.agentId) continue;
    let span = byId.get(e.agentId);
    if (!span) {
      span = {
        agentId: e.agentId,
        role: e.role,
        title: e.kind === "agent_start" ? e.text : e.agentId,
        startedAt: e.ts,
        status: "running",
        toolCalls: 0,
        spentUsd: 0,
      };
      byId.set(e.agentId, span);
    }
    switch (e.kind) {
      case "agent_start":
        span.title = e.text;
        span.role = e.role ?? span.role;
        span.startedAt = e.ts;
        break;
      case "tool_call":
        span.toolCalls++;
        break;
      case "spend":
        if (typeof e.data?.usd === "number") span.spentUsd += e.data.usd;
        break;
      case "error":
        span.status = "error";
        break;
      case "agent_end":
        span.endedAt = e.ts;
        // An error already recorded outranks a clean end: the agent finished,
        // but it finished badly, and a lane that closes green over a failure is
        // the one thing the Activity rules already forbid.
        if (span.status !== "error") span.status = "done";
        break;
    }
  }
  return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt || (a.agentId < b.agentId ? -1 : 1));
}

export interface RunSummary {
  events: number;
  agents: number;
  toolCalls: number;
  sources: number;
  graphHits: number;
  spentUsd: number;
  elapsedMs: number;
  errors: number;
}

export function summarize(run: OrchestraRun, now = Date.now()): RunSummary {
  let toolCalls = 0;
  let sources = 0;
  let graphHits = 0;
  let errors = 0;
  for (const e of run.events) {
    if (e.kind === "tool_call") toolCalls++;
    else if (e.kind === "source") sources++;
    else if (e.kind === "graph_hit") graphHits++;
    else if (e.kind === "error") errors++;
  }
  return {
    events: run.events.length,
    agents: spansOf(run).length,
    toolCalls,
    sources,
    graphHits,
    spentUsd: run.spentUsd,
    elapsedMs: (run.endedAt ?? now) - run.startedAt,
    errors,
  };
}

/**
 * Where to pick a stopped run back up.
 *
 * The first step that started and never ended. A step that ended - however it
 * ended - is not re-run: repeating a step that already spent money and wrote
 * files is worse than leaving it done.
 */
export function resumePoint(run: OrchestraRun): string | null {
  const started = new Set<string>();
  const ended = new Set<string>();
  for (const e of run.events) {
    if (!e.stepId) continue;
    if (e.kind === "step_start") started.add(e.stepId);
    if (e.kind === "step_end") ended.add(e.stepId);
  }
  for (const id of started) if (!ended.has(id)) return id;
  return null;
}
