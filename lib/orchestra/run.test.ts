import { describe, expect, it, vi } from "vitest";
import { ROLES, ROLE_IDS, allowedRoles, rolesBlock, roleWritesMatchTools, toolsFor } from "./roles";
import {
  MAX_AGENTS,
  MIN_AGENT_USD,
  agentCapacity,
  budgetFor,
  finishRun,
  mergeOutcomes,
  runAgents,
  type AgentTask,
  type OrchestraPorts,
} from "./run";
import { spansOf, startRun } from "./trace";

const ALL_TOOLS = [
  "web_search",
  "github",
  "workspace",
  "artifact",
  "tasks",
  "run_python",
  "atlas_graph",
  "atlas_catalog",
  "atlas_cost",
  "atlas_news",
];

describe("roles", () => {
  it("declares writes consistently with the tools it asks for", () => {
    for (const id of ROLE_IDS) {
      expect(roleWritesMatchTools(ROLES[id])).toBe(true);
    }
  });

  it("keeps the acting tools out of every read-only role", () => {
    // The specific regression: `READ_ATLAS` was `ATLAS_TOOL_NAMES`, which was
    // all reads until it was not. A cartographer holding `atlas_open` can move
    // the person to another page in the middle of a fan-out they cannot see.
    for (const id of ROLE_IDS) {
      if (ROLES[id].writes) continue;
      expect(ROLES[id].tools, id).not.toContain("atlas_open");
      expect(ROLES[id].tools, id).not.toContain("atlas_prompt");
    }
  });

  it("exactly one role may change anything", () => {
    expect(ROLE_IDS.filter((id) => ROLES[id].writes)).toEqual(["builder"]);
  });

  it("narrows the turn's tools, and can never widen them", () => {
    const scout = ROLES.scout;
    expect(toolsFor(scout, ALL_TOOLS)).toContain("web_search");
    // Web search off for the turn: the role cannot switch it back on.
    expect(toolsFor(scout, ["atlas_news"])).toEqual(["atlas_news"]);
    expect(toolsFor(scout, [])).toEqual([]);
  });

  it("withholds the builder from a read-only run", () => {
    const ids = allowedRoles(ALL_TOOLS, false).map((r) => r.id);
    expect(ids).not.toContain("builder");
    expect(allowedRoles(ALL_TOOLS, true).map((r) => r.id)).toContain("builder");
  });

  it("does not offer a role that would have no tools", () => {
    // Only the graph is on: the scout would be a model asked to research with
    // nothing to research with, which produces confident prose from memory.
    const ids = allowedRoles(["atlas_graph"], true).map((r) => r.id);
    expect(ids).toContain("cartographer");
    expect(ids).not.toContain("scout");
  });

  it("renders a stable block for the planner", () => {
    const block = rolesBlock(allowedRoles(ALL_TOOLS, true));
    expect(block).toContain("<agents>");
    expect(block).toContain("cartographer:");
    expect(rolesBlock([])).toBe("");
  });
});

describe("agentCapacity", () => {
  it("runs nothing on a budget that cannot fund one agent", () => {
    expect(agentCapacity(0)).toBe(0);
    expect(agentCapacity(MIN_AGENT_USD - 0.001)).toBe(0);
  });

  it("scales with the budget instead of a hardcoded three", () => {
    expect(agentCapacity(MIN_AGENT_USD)).toBe(1);
    expect(agentCapacity(MIN_AGENT_USD * 4)).toBe(4);
  });

  it("still caps, because a bigger fan-out is unreadable", () => {
    expect(agentCapacity(100)).toBe(MAX_AGENTS);
  });
});

describe("budgetFor", () => {
  const tasks: AgentTask[] = [
    { id: "1", role: "scout", title: "s", instruction: "i" },
    { id: "2", role: "critic", title: "c", instruction: "i" },
  ];

  it("splits by declared share and spends the whole budget", () => {
    const b = budgetFor(tasks, 1);
    expect([...b.values()].reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
    // Scout's share (0.25) is larger than critic's (0.10).
    expect(b.get("1")!).toBeGreaterThan(b.get("2")!);
  });

  it("gives an absent role's share back rather than leaving it unspent", () => {
    const solo = budgetFor([tasks[0]], 1);
    expect(solo.get("1")).toBeCloseTo(1, 6);
  });
});

describe("runAgents", () => {
  function ports(over: Partial<OrchestraPorts> = {}): OrchestraPorts {
    return {
      runAgent: async ({ task }) => ({ report: `report for ${task.title}`, spentUsd: 0.01 }),
      availableTools: ALL_TOOLS,
      budgetUsd: 1,
      ...over,
    };
  }

  const two: AgentTask[] = [
    { id: "a", role: "scout", title: "Search the web", instruction: "go" },
    { id: "b", role: "cartographer", title: "Read the graph", instruction: "go" },
  ];

  it("runs every agent and returns their reports", async () => {
    const r = await runAgents(startRun("r", "c", "goal", 0), two, ports());
    expect(r.outcomes.map((o) => o.ok)).toEqual([true, true]);
    expect(r.outcomes[0].report).toContain("Search the web");
    expect(r.stoppedBy).toBeUndefined();
  });

  it("writes a lane per agent into the trace", async () => {
    const r = await runAgents(startRun("r", "c", "goal", 0), two, ports());
    const spans = spansOf(r.run);
    expect(spans).toHaveLength(2);
    expect(spans.every((s) => s.status === "done")).toBe(true);
  });

  it("hands each role only the tools it is allowed", async () => {
    const seen: Record<string, string[]> = {};
    await runAgents(
      startRun("r", "c", "goal", 0),
      two,
      ports({
        runAgent: async ({ task, tools }) => {
          seen[task.role] = tools;
          return { report: "", spentUsd: 0 };
        },
      }),
    );
    expect(seen.scout).toContain("web_search");
    expect(seen.scout).not.toContain("artifact");
    expect(seen.cartographer).not.toContain("web_search");
  });

  it("a failed agent costs one angle, not the run", async () => {
    const r = await runAgents(
      startRun("r", "c", "goal", 0),
      two,
      ports({
        runAgent: async ({ task }) => {
          if (task.id === "a") throw new Error("search is down");
          return { report: "graph says x", spentUsd: 0.01 };
        },
      }),
    );
    expect(r.outcomes[0]).toMatchObject({ ok: false });
    expect(r.outcomes[0].error).toContain("search is down");
    expect(r.outcomes[1].ok).toBe(true);
    expect(spansOf(r.run).find((s) => s.agentId === "a")!.status).toBe("error");
  });

  it("refuses to spawn anything it cannot fund", async () => {
    const r = await runAgents(startRun("r", "c", "goal", 0), two, ports({ budgetUsd: 0.001 }));
    expect(r.outcomes).toEqual([]);
    expect(r.stoppedBy).toBe("budget");
    expect(r.run.events.at(-1)?.text).toContain("Not enough budget");
  });

  it("admits as many agents as the budget supports, and says how many it dropped", async () => {
    const three: AgentTask[] = [
      ...two,
      { id: "c", role: "critic", title: "Check", instruction: "go" },
    ];
    const r = await runAgents(
      startRun("r", "c", "goal", 0),
      three,
      ports({ budgetUsd: MIN_AGENT_USD * 2 }),
    );
    expect(r.outcomes).toHaveLength(2);
    expect(r.stoppedBy).toBe("budget");
    expect(r.run.events.some((e) => e.text.includes("2 of 3 agents"))).toBe(true);
  });

  it("streams events out as they happen", async () => {
    const onRun = vi.fn();
    await runAgents(startRun("r", "c", "goal", 0), two, ports({ onRun }));
    expect(onRun.mock.calls.length).toBeGreaterThan(4);
  });

  it("charges spend into the run's own total", async () => {
    const r = await runAgents(startRun("r", "c", "goal", 0), two, ports());
    expect(r.run.spentUsd).toBeCloseTo(0.02, 6);
  });

  it("reports an abort rather than a completion", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await runAgents(startRun("r", "c", "goal", 0), two, ports({ signal: ctrl.signal }));
    expect(r.stoppedBy).toBe("aborted");
  });
});

describe("mergeOutcomes", () => {
  it("names a failed agent instead of dropping it", () => {
    const merged = mergeOutcomes([
      { id: "a", role: "scout", title: "Search", report: "", spentUsd: 0, ok: false, error: "down" },
      { id: "b", role: "critic", title: "Check", report: "looks fine", spentUsd: 0, ok: true },
    ]);
    expect(merged).toContain("FAILED - down");
    expect(merged).toContain("This angle was not covered");
    expect(merged).toContain("looks fine");
  });

  it("clips a long report and says it clipped", () => {
    const merged = mergeOutcomes(
      [{ id: "a", role: "scout", title: "S", report: "x".repeat(100), spentUsd: 0, ok: true }],
      20,
    );
    expect(merged).toContain("(report truncated)");
  });

  it("is empty for no outcomes", () => {
    expect(mergeOutcomes([])).toBe("");
  });
});

describe("finishRun", () => {
  const ok = { id: "a", role: "scout" as const, title: "t", report: "r", spentUsd: 0, ok: true };
  const bad = { ...ok, id: "b", ok: false, error: "e" };

  it("closes a good run as done", () => {
    const run = finishRun(startRun("r", "c", "g", 0), { outcomes: [ok] }, 100);
    expect(run.status).toBe("done");
  });

  it("says how many failed rather than hiding it", () => {
    const run = finishRun(startRun("r", "c", "g", 0), { outcomes: [ok, bad] }, 100);
    expect(run.status).toBe("done");
    expect(run.events.at(-1)?.text).toContain("1 failed");
  });

  it("is a failure only when nothing succeeded", () => {
    expect(finishRun(startRun("r", "c", "g", 0), { outcomes: [bad] }, 100).status).toBe("failed");
  });

  it("records a stop as a stop, not as a failure", () => {
    const run = finishRun(startRun("r", "c", "g", 0), { outcomes: [], stoppedBy: "aborted" }, 100);
    expect(run.status).toBe("stopped");
  });
});
