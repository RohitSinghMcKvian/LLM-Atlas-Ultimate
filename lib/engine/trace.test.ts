import { describe, expect, it } from "vitest";
import {
  appendTrace,
  liftUiEventsToTrace,
  patchTraceEvent,
  projectUiEvents,
  stampTraceEvent,
} from "./trace";
import type { LegacyUiEvent, TraceEvent } from "./types";

// A realistic pre-v2 session log: every legacy kind, including a tool call
// with a change record and a streamed assistant turn that finished.
const LEGACY_FIXTURE: LegacyUiEvent[] = [
  { kind: "user", id: "u1", text: "add a divide function" },
  {
    kind: "assistant",
    id: "a1",
    text: "I'll read the file first.",
    reasoning: "Need to see current exports.",
    streaming: false,
    promptTokens: 512,
    completionTokens: 64,
  },
  {
    kind: "tool",
    id: "t1",
    name: "edit_file",
    args: '{"path":"math.ts"}',
    result: "ok",
    status: "done",
    display: "math.ts",
    change: {
      id: "c1",
      path: "math.ts",
      before: "export const add = 1;",
      after: "export const add = 1;\nexport const div = 2;",
      tool: "edit_file",
      ts: 1,
    },
  },
  { kind: "tool", id: "t2", name: "run_command", args: '{"command":"npm test"}', status: "running" },
  { kind: "system", id: "s1", text: "Stopped.", tone: "info" },
];

describe("trace round-trip", () => {
  it("project(lift(events)) deep-equals the original events", () => {
    const trace = liftUiEventsToTrace(LEGACY_FIXTURE, 1234);
    expect(projectUiEvents(trace)).toEqual(LEGACY_FIXTURE);
  });

  it("lift assigns contiguous seq and the given ts", () => {
    const trace = liftUiEventsToTrace(LEGACY_FIXTURE, 99);
    expect(trace.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(trace.every((e) => e.ts === 99)).toBe(true);
  });
});

describe("appendTrace / stampTraceEvent", () => {
  it("assigns monotonic seq starting at 0", () => {
    let trace: TraceEvent[] = [];
    trace = appendTrace(trace, { kind: "user", id: "u1", text: "hi" });
    trace = appendTrace(trace, { kind: "system", id: "s1", text: "note", tone: "info" });
    expect(trace.map((e) => e.seq)).toEqual([0, 1]);
  });

  it("continues seq after lifted events", () => {
    const lifted = liftUiEventsToTrace(LEGACY_FIXTURE, 5);
    const ev = stampTraceEvent(lifted, { kind: "user", id: "u2", text: "next" });
    expect(ev.seq).toBe(LEGACY_FIXTURE.length);
  });

  it("does not mutate the input array", () => {
    const before: TraceEvent[] = [];
    appendTrace(before, { kind: "user", id: "u1", text: "hi" });
    expect(before).toHaveLength(0);
  });

  it("stamps v2 kinds with task metadata intact", () => {
    const trace = appendTrace([], {
      kind: "verdict",
      id: "v1",
      taskId: "task1",
      phase: "verify",
      verdict: {
        check: "unit",
        command: "npm test",
        pass: false,
        evidence: "1 failing",
        durationMs: 900,
        ts: 5,
      },
    });
    expect(trace[0]).toMatchObject({ kind: "verdict", taskId: "task1", phase: "verify", seq: 0 });
  });
});

describe("projectUiEvents", () => {
  it("excludes v2-only kinds", () => {
    let trace = liftUiEventsToTrace(LEGACY_FIXTURE, 1);
    trace = appendTrace(trace, { kind: "phase_change", id: "p1", from: null, to: "explore" });
    trace = appendTrace(trace, { kind: "steering", id: "st1", text: "use sqlite" });
    expect(projectUiEvents(trace)).toEqual(LEGACY_FIXTURE);
  });

  it("keeps an empty assistant turn while streaming (live placeholder)", () => {
    const trace = appendTrace([], {
      kind: "assistant",
      id: "a1",
      text: "",
      reasoning: "",
      streaming: true,
    });
    expect(projectUiEvents(trace)).toHaveLength(1);
  });

  it("drops completed assistant turns with nothing visible (pre-v2 display rule)", () => {
    const trace = appendTrace([], {
      kind: "assistant",
      id: "a1",
      text: "",
      reasoning: "",
      streaming: false,
    });
    expect(projectUiEvents(trace)).toHaveLength(0);
  });
});

describe("patchTraceEvent", () => {
  it("patches payload but never seq/ts", () => {
    const trace = appendTrace([], {
      kind: "tool",
      id: "t1",
      name: "run_command",
      args: "{}",
      status: "running",
      ts: 7,
    });
    const next = patchTraceEvent(trace, "t1", (ev) => ({
      ...ev,
      status: "done",
      result: "ok",
      seq: 999,
      ts: 999,
    }) as TraceEvent);
    expect(next[0]).toMatchObject({ status: "done", result: "ok", seq: 0, ts: 7 });
  });

  it("returns the same reference when no id matches", () => {
    const trace = appendTrace([], { kind: "user", id: "u1", text: "hi" });
    expect(patchTraceEvent(trace, "nope", (e) => e)).toBe(trace);
  });
});
