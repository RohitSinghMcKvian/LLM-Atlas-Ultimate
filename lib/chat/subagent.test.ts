import { describe, it, expect, vi } from "vitest";
import {
  allowSubagentCall,
  decodeSubagentProgress,
  encodeSubagentProgress,
  isSubagentTool,
  isSubagentWorkspaceCommand,
  MAX_AGENTS,
  MAX_CALLS_PER_TURN,
  mergeSubagentReports,
  PARENT_HEADROOM_USD,
  REPORT_CLIP,
  REPORTS_TOTAL,
  runSubagents,
  subagentPrompt,
  SUBAGENT_LIMITS,
  SUBAGENT_TOOLS,
  type SubagentOutcome,
  type SubagentState,
  type SubagentTask,
  type SubagentTurnState,
} from "./subagent";

const task = (title: string, instruction = `investigate ${title}`): SubagentTask => ({
  title,
  instruction,
});
const turn = (over: Partial<SubagentTurnState> = {}): SubagentTurnState => ({
  calls: 0,
  agents: 0,
  ...over,
});
const outcome = (over: Partial<SubagentOutcome> = {}): SubagentOutcome => ({
  report: "found it",
  spentUsd: 0.02,
  rounds: 2,
  ...over,
});

describe("the read-only toolset", () => {
  /**
   * The invariant this whole feature rests on. One workspace, one artifact
   * record, one ledger, one database, one interpreter — three concurrent
   * writers to any of them is a corruption bug, not a race to tune.
   */
  it("excludes every tool that writes", () => {
    for (const forbidden of ["artifact", "tasks", "memory", "run_python", "skill"]) {
      expect(isSubagentTool(forbidden)).toBe(false);
    }
  });

  // Depth is structurally 1: an absence, not a counter that can be got wrong.
  it("cannot spawn sub-agents of its own", () => {
    expect(isSubagentTool("spawn_subagents")).toBe(false);
    expect(SUBAGENT_TOOLS).not.toContain("spawn_subagents");
  });

  // They carry a user approval gate a nested loop cannot honour, and three
  // agents racing for one dialog is a bug rather than a UX.
  it("excludes connector tools", () => {
    expect(isSubagentTool("mcp__notion__search")).toBe(false);
  });

  it("allows reading the build but not writing it", () => {
    expect(isSubagentTool("workspace")).toBe(true);
    for (const c of ["view", "list", "glob", "grep"]) {
      expect(isSubagentWorkspaceCommand(c)).toBe(true);
    }
    for (const c of ["create", "append", "str_replace", "insert", "delete", "rename"]) {
      expect(isSubagentWorkspaceCommand(c)).toBe(false);
    }
  });

  it("tells the agent, in words, that it cannot write", () => {
    const p = subagentPrompt(task("routing"));
    expect(p).toContain("read-only");
    expect(p).toContain("CANNOT write");
    expect(p).toContain("investigate routing");
  });
});

describe("allowSubagentCall", () => {
  it("allows a first fan-out with budget to spare", () => {
    expect(allowSubagentCall(turn(), 3, 2)).toEqual({ ok: true });
  });

  /**
   * The reason the tool is plural. `.max(3)` on the schema bounds one call and
   * cannot stop three sequential ones, which is the same $0.75 arriving by a
   * different route.
   */
  it("refuses a second call in the same turn", () => {
    const out = allowSubagentCall(turn({ calls: MAX_CALLS_PER_TURN, agents: 1 }), 1, 5);
    expect(out.ok).toBe(false);
    expect(out).toMatchObject({ reason: "calls" });
  });

  it("refuses more agents than the ceiling", () => {
    expect(allowSubagentCall(turn(), MAX_AGENTS + 1, 5)).toMatchObject({
      ok: false,
      reason: "agents",
    });
  });

  it("counts agents already spawned this turn", () => {
    expect(allowSubagentCall(turn({ agents: 2 }), 2, 5)).toMatchObject({
      ok: false,
      reason: "agents",
    });
  });

  /**
   * Refused rather than started: beginning three fan-outs and stopping after
   * the first bills for work whose results are thrown away.
   */
  it("refuses when the parent build cannot afford to finish", () => {
    expect(allowSubagentCall(turn(), 3, PARENT_HEADROOM_USD - 0.01)).toMatchObject({
      ok: false,
      reason: "headroom",
    });
    expect(allowSubagentCall(turn(), 3, PARENT_HEADROOM_USD)).toEqual({ ok: true });
  });

  it("refuses an empty fan-out", () => {
    expect(allowSubagentCall(turn(), 0, 5)).toMatchObject({ ok: false, reason: "empty" });
  });

  // A model told only "denied" spends the next round rephrasing the same
  // request. Every refusal has to say what to do instead.
  it("phrases every refusal as something the model can act on", () => {
    const refusals = [
      allowSubagentCall(turn({ calls: 1 }), 1, 5),
      allowSubagentCall(turn(), 9, 5),
      allowSubagentCall(turn(), 1, 0),
      allowSubagentCall(turn(), 0, 5),
    ];
    for (const r of refusals) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.refusal.length).toBeGreaterThan(40);
    }
  });
});

describe("runSubagents", () => {
  it("runs every task and merges the reports", async () => {
    const out = await runSubagents([task("a"), task("b")], {
      runOne: async (t) => outcome({ report: `report for ${t.title}` }),
    });
    expect(out.content).toContain("### a");
    expect(out.content).toContain("report for a");
    expect(out.content).toContain("### b");
    expect(out.agents.every((a) => a.phase === "done")).toBe(true);
  });

  it("runs them in parallel, not one after another", async () => {
    let live = 0;
    let peak = 0;
    await runSubagents([task("a"), task("b"), task("c")], {
      runOne: async () => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 5));
        live -= 1;
        return outcome();
      },
    });
    expect(peak).toBe(3);
  });

  /**
   * Charged as each agent settles rather than when the merged report returns.
   * Otherwise the meter reads $0.30 while $1.05 has already gone, and a user
   * watching a build has no other signal that it did.
   */
  it("charges the parent as agents settle", async () => {
    const charges: number[] = [];
    let seenDuringRun = 0;
    await runSubagents([task("a"), task("b")], {
      charge: (usd) => charges.push(usd),
      runOne: async (t) => {
        if (t.title === "b") {
          await new Promise((r) => setTimeout(r, 10));
          seenDuringRun = charges.length;
        }
        return outcome({ spentUsd: 0.05 });
      },
    });
    expect(seenDuringRun).toBe(1);
    expect(charges).toEqual([0.05, 0.05]);
  });

  it("reports the total it spent", async () => {
    const out = await runSubagents([task("a"), task("b")], {
      runOne: async () => outcome({ spentUsd: 0.07 }),
    });
    expect(out.spentUsd).toBeCloseTo(0.14);
  });

  // Two reports where three were asked for reads as a complete answer, and the
  // model presents it as one.
  it("reports a failed agent as failed rather than omitting it", async () => {
    const out = await runSubagents([task("a"), task("boom")], {
      runOne: async (t) => {
        if (t.title === "boom") throw new Error("provider said no");
        return outcome();
      },
    });
    expect(out.content).toContain("### boom");
    expect(out.content).toContain("provider said no");
    expect(out.agents.find((a) => a.title === "boom")!.phase).toBe("error");
  });

  it("streams phase changes so the panel can show them filling in", async () => {
    const frames: SubagentState[][] = [];
    await runSubagents([task("a")], {
      onProgress: (agents) => frames.push(agents),
      runOne: async () => outcome(),
    });
    const phases = frames.map((f) => f[0].phase);
    expect(phases[0]).toBe("queued");
    expect(phases).toContain("running");
    expect(phases[phases.length - 1]).toBe("done");
  });

  it("stops when the parent's signal aborts", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const runOne = vi.fn(async () => outcome());
    const out = await runSubagents([task("a"), task("b")], { runOne, signal: ctrl.signal });
    expect(runOne).not.toHaveBeenCalled();
    expect(out.spentUsd).toBe(0);
  });
});

describe("mergeSubagentReports", () => {
  const results = (n: number, text: string) =>
    Array.from({ length: n }, (_, i) => ({
      id: `t${i}`,
      ok: true as const,
      value: outcome({ report: text }),
    }));
  const tasks = (n: number) => Array.from({ length: n }, (_, i) => task(`t${i}`));

  it("says these are findings, not actions", () => {
    const out = mergeSubagentReports(tasks(1), results(1, "x"));
    expect(out).toContain("nothing was written");
  });

  it("clips one verbose agent so it cannot crowd out the concise ones", () => {
    const out = mergeSubagentReports(tasks(2), [
      { id: "t0", ok: true, value: outcome({ report: "x".repeat(REPORT_CLIP * 3) }) },
      { id: "t1", ok: true, value: outcome({ report: "the short one" }) },
    ]);
    expect(out).toContain("report clipped");
    expect(out).toContain("the short one");
  });

  // Three sub-agents must not be able to undo what `transcriptTrim` deflates.
  it("stays inside the combined budget", () => {
    const out = mergeSubagentReports(tasks(3), results(3, "y".repeat(REPORT_CLIP)));
    expect(out.length).toBeLessThanOrEqual(REPORTS_TOTAL + 400);
  });

  it("names an agent that never ran", () => {
    expect(mergeSubagentReports(tasks(2), results(1, "x"))).toContain("(did not run)");
  });

  it("says when an agent stopped early", () => {
    const out = mergeSubagentReports(tasks(1), [
      { id: "t0", ok: true, value: outcome({ stopReason: "reached its round cap" }) },
    ]);
    expect(out).toContain("stopped early: reached its round cap");
  });

  it("does not pass off an empty report as a finding", () => {
    const out = mergeSubagentReports(tasks(1), [{ id: "t0", ok: true, value: outcome({ report: "  " }) }]);
    expect(out).toContain("(empty report)");
  });
});

describe("progress encoding", () => {
  const agents: SubagentState[] = [
    { title: "a", phase: "running", rounds: 1, spentUsd: 0.01 },
    { title: "b", phase: "queued", rounds: 0, spentUsd: 0 },
  ];

  it("round-trips", () => {
    expect(decodeSubagentProgress(encodeSubagentProgress(agents))).toEqual(agents);
  });

  // Progress arrives appended, so the accumulated string holds every frame.
  it("reads the newest frame out of an accumulated stream", () => {
    const done: SubagentState[] = [{ title: "a", phase: "done", rounds: 3, spentUsd: 0.04 }];
    const stream = encodeSubagentProgress(agents) + encodeSubagentProgress(done);
    expect(decodeSubagentProgress(stream)).toEqual(done);
  });

  it("falls back to the last complete frame when the newest is half-written", () => {
    const stream = `${encodeSubagentProgress(agents)} subagents:[{"title":"a"`;
    expect(decodeSubagentProgress(stream)).toEqual(agents);
  });

  it("returns null when there is nothing to read", () => {
    expect(decodeSubagentProgress(undefined)).toBeNull();
    expect(decodeSubagentProgress("")).toBeNull();
    expect(decodeSubagentProgress("some python output\n")).toBeNull();
  });
});

describe("SUBAGENT_LIMITS", () => {
  // Three agents at their individual ceilings must stay under the smallest
  // parent build budget that is allowed to start one.
  it("caps a full fan-out below what the headroom check guarantees", () => {
    expect(SUBAGENT_LIMITS.maxUsd * MAX_AGENTS).toBeLessThanOrEqual(1);
    expect(SUBAGENT_LIMITS.maxRounds).toBeLessThan(10);
  });
});
