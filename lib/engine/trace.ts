// Trace core (Depth Spec v2 §Part E): an append-only, event-sourced log that
// is the single source of truth for the agent UI, session persistence, and
// export. The pre-v2 `UiEvent[]` list survives as a *projection* of the trace
// so existing components render unchanged.
//
// Framework-agnostic and pure — unit-tested under vitest/node.

import type { LegacyUiEvent, TraceEvent } from "./types";

/** Omit that distributes over a union (plain Omit collapses union members). */
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A trace event before stamping — `seq` is assigned, `ts` defaults to now. */
export type TraceInput = DistOmit<TraceEvent, "seq" | "ts"> & { ts?: number };

const LEGACY_KINDS: ReadonlySet<string> = new Set(["user", "assistant", "tool", "system"]);

/** Stamp an input with the next sequence number (and ts when absent). */
export function stampTraceEvent(trace: readonly TraceEvent[], input: TraceInput): TraceEvent {
  const seq = trace.length ? trace[trace.length - 1].seq + 1 : 0;
  return { ts: Date.now(), ...input, seq } as TraceEvent;
}

/** Append one event, returning a new array (never mutates). */
export function appendTrace(trace: readonly TraceEvent[], input: TraceInput): TraceEvent[] {
  return [...trace, stampTraceEvent(trace, input)];
}

export function isLegacyEvent(
  ev: TraceEvent,
): ev is Extract<TraceEvent, { kind: LegacyUiEvent["kind"] }> {
  return LEGACY_KINDS.has(ev.kind);
}

/**
 * Project the trace down to the pre-v2 `UiEvent[]` shape.
 *
 * Completed assistant turns with no visible text/reasoning are dropped —
 * the pre-v2 store filtered those at `assistant_done` time; the trace keeps
 * them (source of truth) and the projection applies the same display rule.
 */
export function projectUiEvents(trace: readonly TraceEvent[]): LegacyUiEvent[] {
  const out: LegacyUiEvent[] = [];
  for (const ev of trace) {
    if (!isLegacyEvent(ev)) continue;
    if (
      ev.kind === "assistant" &&
      !ev.streaming &&
      !ev.text.trim() &&
      !ev.reasoning.trim()
    )
      continue;
    const { seq: _seq, ts: _ts, taskId: _taskId, phase: _phase, ...ui } = ev;
    out.push(ui as LegacyUiEvent);
  }
  return out;
}

/**
 * Lift a pre-v2 `UiEvent[]` list (from an old persisted session) into a
 * trace. Original timestamps are unknown; all lifted events share `baseTs`.
 */
export function liftUiEventsToTrace(
  events: readonly LegacyUiEvent[],
  baseTs: number = Date.now(),
): TraceEvent[] {
  return events.map((e, i) => ({ ...e, seq: i, ts: baseTs }) as TraceEvent);
}

/**
 * Patch the (single) event with the given id, preserving order and identity
 * of everything else. Returns the same array reference when nothing matched.
 */
export function patchTraceEvent(
  trace: readonly TraceEvent[],
  id: string,
  patch: (ev: TraceEvent) => TraceEvent,
): TraceEvent[] {
  let touched = false;
  const next = trace.map((ev) => {
    if (ev.id !== id) return ev;
    touched = true;
    const patched = patch(ev);
    // seq/ts are immutable once stamped.
    return { ...patched, seq: ev.seq, ts: ev.ts } as TraceEvent;
  });
  return touched ? next : (trace as TraceEvent[]);
}
