import { describe, expect, it } from "vitest";
import {
  append,
  appendMany,
  endRun,
  isWellFormed,
  resumePoint,
  spansOf,
  startRun,
  summarize,
  type OrchestraRun,
} from "./trace";

function base(): OrchestraRun {
  return startRun("r1", "c1", "Compare three models", 1_000);
}

describe("append", () => {
  it("stamps a monotonic seq the caller cannot set", () => {
    let run = base();
    run = append(run, { kind: "plan", text: "two steps" }, 1_001);
    run = append(run, { kind: "step_start", stepId: "s1", text: "search" }, 1_002);
    expect(run.events.map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it("returns a new run rather than mutating the old one", () => {
    const before = base();
    const after = append(before, { kind: "plan", text: "x" }, 1_001);
    expect(before.events).toHaveLength(1);
    expect(after.events).toHaveLength(2);
    expect(after.events).not.toBe(before.events);
  });

  it("accumulates spend as it goes", () => {
    let run = base();
    run = append(run, { kind: "spend", text: "a", data: { usd: 0.02 } }, 1_001);
    run = append(run, { kind: "spend", text: "b", data: { usd: 0.03 } }, 1_002);
    expect(run.spentUsd).toBeCloseTo(0.05, 6);
  });

  it("ignores a spend event with no amount", () => {
    const run = append(base(), { kind: "spend", text: "unknown" }, 1_001);
    expect(run.spentUsd).toBe(0);
  });

  it("appendMany keeps the sequence intact", () => {
    const run = appendMany(
      base(),
      [
        { kind: "step_start", stepId: "s1", text: "a" },
        { kind: "step_end", stepId: "s1", text: "b" },
      ],
      1_001,
    );
    expect(run.events.map((e) => e.seq)).toEqual([0, 1, 2]);
  });
});

describe("endRun", () => {
  it("closes the run and records why", () => {
    const run = endRun(base(), "done", "2 agents reported.", 2_000);
    expect(run.status).toBe("done");
    expect(run.endedAt).toBe(2_000);
    expect(run.events.at(-1)).toMatchObject({ kind: "run_end", text: "2 agents reported." });
  });

  it("is idempotent - a finished run cannot be re-ended", () => {
    const once = endRun(base(), "done", "first", 2_000);
    const twice = endRun(once, "failed", "second", 3_000);
    expect(twice).toBe(once);
    expect(twice.status).toBe("done");
  });
});

describe("isWellFormed", () => {
  it("accepts a run built by append", () => {
    expect(isWellFormed(appendMany(base(), [{ kind: "plan", text: "x" }], 1_001))).toBe(true);
  });

  it("rejects a rewritten sequence", () => {
    const run = base();
    const tampered: OrchestraRun = {
      ...run,
      events: [...run.events, { seq: 0, ts: 1_001, kind: "plan", text: "x" }],
    };
    expect(isWellFormed(tampered)).toBe(false);
  });

  it("rejects a timestamp that goes backwards", () => {
    const run = base();
    const tampered: OrchestraRun = {
      ...run,
      events: [...run.events, { seq: 1, ts: 500, kind: "plan", text: "x" }],
    };
    expect(isWellFormed(tampered)).toBe(false);
  });

  it("allows two events in the same millisecond", () => {
    let run = base();
    run = append(run, { kind: "plan", text: "a" }, 1_000);
    run = append(run, { kind: "plan", text: "b" }, 1_000);
    expect(isWellFormed(run)).toBe(true);
  });

  it("rejects a run with no identity", () => {
    expect(isWellFormed({ ...base(), conversationId: "" })).toBe(false);
  });
});

describe("spansOf", () => {
  function twoAgents(): OrchestraRun {
    let run = base();
    run = append(run, { kind: "agent_start", agentId: "a", role: "scout", text: "Search" }, 1_010);
    run = append(run, { kind: "agent_start", agentId: "b", role: "analyst", text: "Cost" }, 1_020);
    run = append(run, { kind: "tool_call", agentId: "a", text: "web_search" }, 1_030);
    run = append(run, { kind: "tool_call", agentId: "a", text: "web_search" }, 1_031);
    run = append(run, { kind: "spend", agentId: "a", text: "s", data: { usd: 0.04 } }, 1_040);
    run = append(run, { kind: "agent_end", agentId: "a", text: "done" }, 1_050);
    return run;
  }

  it("builds one lane per agent, in start order", () => {
    const spans = spansOf(twoAgents());
    expect(spans.map((s) => s.agentId)).toEqual(["a", "b"]);
    expect(spans[0].role).toBe("scout");
  });

  it("counts tool calls and spend per lane", () => {
    const [a] = spansOf(twoAgents());
    expect(a.toolCalls).toBe(2);
    expect(a.spentUsd).toBeCloseTo(0.04, 6);
  });

  it("leaves an unfinished lane running", () => {
    const [, b] = spansOf(twoAgents());
    expect(b.status).toBe("running");
    expect(b.endedAt).toBeUndefined();
  });

  it("never closes a lane green over a failure", () => {
    let run = twoAgents();
    run = append(run, { kind: "error", agentId: "b", text: "boom" }, 1_060);
    run = append(run, { kind: "agent_end", agentId: "b", text: "done" }, 1_070);
    const b = spansOf(run).find((s) => s.agentId === "b")!;
    expect(b.status).toBe("error");
    expect(b.endedAt).toBe(1_070);
  });

  it("ignores events that belong to no agent", () => {
    expect(spansOf(base())).toEqual([]);
  });
});

describe("summarize", () => {
  it("counts what the ledger shows", () => {
    let run = base();
    run = append(run, { kind: "agent_start", agentId: "a", text: "x" }, 1_010);
    run = append(run, { kind: "tool_call", agentId: "a", text: "t" }, 1_020);
    run = append(run, { kind: "source", agentId: "a", text: "https://x" }, 1_030);
    run = append(run, { kind: "graph_hit", agentId: "a", text: "model:x" }, 1_040);
    run = append(run, { kind: "error", agentId: "a", text: "e" }, 1_050);
    run = append(run, { kind: "spend", agentId: "a", text: "s", data: { usd: 0.1 } }, 1_060);
    const s = summarize(run, 2_000);
    expect(s).toMatchObject({ agents: 1, toolCalls: 1, sources: 1, graphHits: 1, errors: 1 });
    expect(s.spentUsd).toBeCloseTo(0.1, 6);
    expect(s.elapsedMs).toBe(1_000);
  });

  it("uses the recorded end for a finished run, not the clock", () => {
    const run = endRun(base(), "done", "x", 1_500);
    expect(summarize(run, 9_999).elapsedMs).toBe(500);
  });
});

describe("resumePoint", () => {
  it("finds the step that started and never finished", () => {
    let run = base();
    run = append(run, { kind: "step_start", stepId: "s1", text: "a" }, 1_010);
    run = append(run, { kind: "step_end", stepId: "s1", text: "a" }, 1_020);
    run = append(run, { kind: "step_start", stepId: "s2", text: "b" }, 1_030);
    expect(resumePoint(run)).toBe("s2");
  });

  it("never re-runs a step that already ended, however it ended", () => {
    let run = base();
    run = append(run, { kind: "step_start", stepId: "s1", text: "a" }, 1_010);
    run = append(run, { kind: "error", stepId: "s1", text: "boom" }, 1_015);
    run = append(run, { kind: "step_end", stepId: "s1", text: "failed" }, 1_020);
    expect(resumePoint(run)).toBeNull();
  });

  it("has nothing to resume in a run that never started a step", () => {
    expect(resumePoint(base())).toBeNull();
  });
});
