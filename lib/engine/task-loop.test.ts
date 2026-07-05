import { describe, expect, it } from "vitest";
import type { AgentPhaseRun, TaskPorts } from "./ports";
import {
  canAttempt,
  initialTaskState,
  runTaskLoop,
  taskReducer,
  type TaskEvent,
} from "./task-loop";
import type { TaskState, Todo, TraceEvent } from "./types";

const todo = (id: string, over: Partial<Todo> = {}): Todo => ({
  id,
  text: `todo ${id}`,
  acceptance: "checks pass",
  status: "pending",
  verdicts: [],
  attempts: 0,
  strategyLog: [],
  ...over,
});

const apply = (state: TaskState, events: TaskEvent[]) => events.reduce(taskReducer, state);

describe("taskReducer", () => {
  const base = initialTaskState("t1", "build a thing");

  it("walks the happy-path transition table", () => {
    const s = apply(base, [
      { type: "classified", classification: "complex", questions: [] },
      { type: "phase", phase: "explore" },
      { type: "explored", summary: "map" },
      { type: "phase", phase: "plan" },
      { type: "planned", todos: [todo("a"), todo("b")] },
      { type: "phase", phase: "execute" },
      { type: "todo_active", id: "a" },
      {
        type: "verdicts",
        todoId: "a",
        verdicts: [
          { check: "unit", command: "npm test", pass: true, evidence: "", durationMs: 1, ts: 1 },
        ],
      },
      { type: "todo_status", id: "a", status: "done" },
    ]);
    expect(s.classification).toBe("complex");
    expect(s.exploreSummary).toBe("map");
    expect(s.todos[0]).toMatchObject({ id: "a", status: "done" });
    expect(s.todos[0].verdicts).toHaveLength(1);
    expect(s.todos[1].status).toBe("pending");
  });

  it("attempt: accepts a new strategy, rejects a repeat (case-insensitive)", () => {
    let s = apply(base, [{ type: "planned", todos: [todo("a")] }]);
    s = taskReducer(s, { type: "attempt", todoId: "a", strategy: "Fix the import" });
    expect(s.todos[0].attempts).toBe(1);
    const rejected = taskReducer(s, { type: "attempt", todoId: "a", strategy: "fix the import" });
    expect(rejected).toBe(s); // unchanged reference = rejected
    const accepted = taskReducer(s, { type: "attempt", todoId: "a", strategy: "rewrite the parser" });
    expect(accepted.todos[0].attempts).toBe(2);
    expect(accepted.todos[0].strategyLog).toEqual(["Fix the import", "rewrite the parser"]);
  });

  it("attempt: rejects once the budget is exhausted", () => {
    let s = { ...apply(base, [{ type: "planned", todos: [todo("a")] }]), attemptBudget: 2 };
    s = taskReducer(s, { type: "attempt", todoId: "a", strategy: "one" });
    s = taskReducer(s, { type: "attempt", todoId: "a", strategy: "two" });
    expect(taskReducer(s, { type: "attempt", todoId: "a", strategy: "three" })).toBe(s);
    expect(canAttempt(s, "a", "three")).toBe(false);
  });

  it("attempt: rejects unknown todos", () => {
    const s = apply(base, [{ type: "planned", todos: [todo("a")] }]);
    expect(taskReducer(s, { type: "attempt", todoId: "zz", strategy: "x" })).toBe(s);
  });

  it("steering queue accumulates and drains", () => {
    let s = taskReducer(base, { type: "steering_queued", text: "use sqlite" });
    s = taskReducer(s, { type: "steering_queued", text: "add dark mode" });
    expect(s.steeringQueue).toEqual(["use sqlite", "add dark mode"]);
    expect(taskReducer(s, { type: "steering_drained" }).steeringQueue).toEqual([]);
  });

  it("stopped freezes the phase", () => {
    expect(taskReducer(base, { type: "stopped" }).phase).toBe("stopped");
  });
});

// ── Driver integration (fake ports) ─────────────────────────────────────────

function makePorts(overrides: Partial<TaskPorts> & { script?: (run: AgentPhaseRun) => Promise<string> | string }) {
  const trace: TraceEvent[] = [];
  let seq = 0;
  let n = 0;
  const ports: TaskPorts = {
    agent: async (run) => {
      const summary = overrides.script ? await overrides.script(run) : "ok";
      return { summary, ok: true };
    },
    llm: async () => '{"classification":"complex","questions":[],"assumptions":["node project"]}',
    exec: async () => ({ code: 0, output: "ok" }),
    readFile: async (p) =>
      p === "package.json" ? JSON.stringify({ scripts: { test: "node test.js" } }) : null,
    listPaths: async () => ["package.json", "index.js", "test.js"],
    changes: () => [{ path: "index.js", before: "a", after: "b" }],
    snapshot: async () => {},
    trace: (input) => {
      trace.push({ ts: 0, ...input, seq: seq++ } as TraceEvent);
    },
    usage: () => ({ costUsd: 0.01, tokens: 1000 }),
    uid: () => `id${n++}`,
    ...overrides,
  };
  return { ports, trace };
}

const planScript = (todos: { text: string; acceptance: string }[]) => async (run: AgentPhaseRun) => {
  if (run.phase === "plan" && run.onCustomTool) {
    await run.onCustomTool("set_todos", JSON.stringify({ todos }));
    return "planned";
  }
  if (run.phase === "review") return "Looks correct. REVIEW: pass";
  return "STRATEGY: take a different angle\ndone";
};

describe("runTaskLoop (driver, fake ports)", () => {
  it("runs the full complex loop to done with a report card", async () => {
    const { ports, trace } = makePorts({
      script: planScript([
        { text: "implement divide", acceptance: "npm test passes" },
        { text: "wire cli", acceptance: "node index.js runs" },
      ]),
    });
    const state = await runTaskLoop({ taskId: "t1", goal: "add divide", ports });

    expect(state.phase).toBe("done");
    expect(state.todos).toHaveLength(2);
    expect(state.todos.every((t) => t.status === "done")).toBe(true);
    expect(state.exploreSummary).toBeTruthy();
    expect(state.report).toBeTruthy();
    expect(state.report!.files).toEqual([{ path: "index.js", kind: "modified" }]);
    expect(state.report!.verified.length).toBeGreaterThan(0);
    expect(state.report!.costUsd).toBe(0.01);

    const kinds = trace.map((e) => e.kind);
    // Explore-before-edit is auditable in the trace.
    expect(kinds).toContain("phase_change");
    expect(kinds).toContain("todo");
    expect(kinds).toContain("verdict");
    const phases = trace.filter((e) => e.kind === "phase_change") as Extract<
      TraceEvent,
      { kind: "phase_change" }
    >[];
    const order = phases.map((p) => p.to);
    expect(order.indexOf("explore")).toBeLessThan(order.indexOf("execute"));
  });

  it("self-corrects on a failing check and records the strategy", async () => {
    let testRuns = 0;
    const { ports, trace } = makePorts({
      script: planScript([{ text: "fix bug", acceptance: "npm test passes" }]),
      exec: async () => {
        testRuns++;
        return testRuns === 1
          ? { code: 1, output: "AssertionError: expected 3" }
          : { code: 0, output: "ok" };
      },
    });
    const state = await runTaskLoop({ taskId: "t1", goal: "fix the bug", ports });

    expect(state.phase).toBe("done");
    expect(state.todos[0].status).toBe("done");
    expect(state.todos[0].attempts).toBe(1);
    expect(state.todos[0].strategyLog[0].toLowerCase()).toContain("different angle");
    expect(trace.some((e) => e.kind === "hypothesis")).toBe(true);
    const failed = trace.find(
      (e) => e.kind === "verdict" && !(e as any).verdict.pass,
    );
    expect(failed).toBeTruthy();
  });

  it("stops retrying when the agent repeats its strategy, todo fails", async () => {
    const { ports } = makePorts({
      script: async (run: AgentPhaseRun) => {
        if (run.phase === "plan" && run.onCustomTool) {
          await run.onCustomTool(
            "set_todos",
            JSON.stringify({ todos: [{ text: "fix", acceptance: "npm test passes" }] }),
          );
          return "planned";
        }
        if (run.phase === "review") return "REVIEW: concerns";
        return "STRATEGY: same thing\n...";
      },
      exec: async () => ({ code: 1, output: "still failing" }),
    });
    const state = await runTaskLoop({ taskId: "t1", goal: "fix", ports });
    expect(state.todos[0].status).toBe("failed");
    // First attempt accepted, second rejected (identical strategy).
    expect(state.todos[0].attempts).toBe(1);
    expect(state.report!.leftUndone).toEqual(["fix"]);
  });

  it("trivial classification degrades to a single agent call", async () => {
    const runs: AgentPhaseRun[] = [];
    const { ports } = makePorts({
      llm: async () => '{"classification":"trivial","questions":[]}',
      script: async (run: AgentPhaseRun) => {
        runs.push(run);
        return "renamed";
      },
    });
    const state = await runTaskLoop({ taskId: "t1", goal: "rename x to y", ports });
    expect(state.phase).toBe("done");
    expect(runs).toHaveLength(1);
    expect(runs[0].phase).toBe("execute");
    expect(state.todos).toHaveLength(0);
    expect(state.report).toBeUndefined();
  });

  it("injects a write-tests todo when the project has no test check", async () => {
    const { ports } = makePorts({
      script: planScript([{ text: "implement", acceptance: "works" }]),
      readFile: async () => JSON.stringify({ scripts: {} }),
      exec: async () => ({ code: 0, output: "ok" }),
    });
    const state = await runTaskLoop({ taskId: "t1", goal: "add feature", ports });
    expect(state.todos.map((t) => t.text)).toContain(
      "Add minimal tests covering the change (happy path + one edge case)",
    );
  });

  it("plan approval: null discards, edited todos replace", async () => {
    const { ports } = makePorts({
      script: planScript([{ text: "a", acceptance: "b" }]),
      approvePlan: async () => null,
    });
    const state = await runTaskLoop({ taskId: "t1", goal: "do it", ports });
    expect(state.phase).toBe("stopped");
    expect(state.todos.every((t) => t.status === "pending")).toBe(true);
  });

  it("clarify answers are folded into the goal context", async () => {
    const goals: string[] = [];
    const { ports } = makePorts({
      llm: async () =>
        '{"classification":"complex","questions":["Which framework?"],"assumptions":[]}',
      clarify: async () => "Use Express",
      script: async (run: AgentPhaseRun) => {
        goals.push(run.goal);
        if (run.phase === "plan" && run.onCustomTool)
          await run.onCustomTool(
            "set_todos",
            JSON.stringify({ todos: [{ text: "t", acceptance: "a" }] }),
          );
        return "ok";
      },
    });
    await runTaskLoop({ taskId: "t1", goal: "build an api", ports });
    expect(goals.some((g) => g.includes("Use Express"))).toBe(true);
  });
});
