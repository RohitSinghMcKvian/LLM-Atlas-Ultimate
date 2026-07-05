import { describe, expect, it } from "vitest";
import type { ChatMessage as RouterMsg } from "@/lib/router";
import { buildHandoffBrief, compactHistory, estimateTokens, taskFactBlock } from "./context";
import { initialTaskState, taskReducer, type TaskEvent } from "./task-loop";

const msg = (role: RouterMsg["role"], content: string, extra: Partial<RouterMsg> = {}): RouterMsg =>
  ({ role, content, ...extra }) as RouterMsg;

function longHistory(): RouterMsg[] {
  const h: RouterMsg[] = [];
  for (let i = 0; i < 10; i++) {
    h.push(msg("user", `task part ${i} ` + "x".repeat(2000)));
    h.push(
      msg("assistant", "", {
        tool_calls: [
          { id: `c${i}`, type: "function", function: { name: "read_file", arguments: "{}" } },
        ],
      }),
    );
    h.push(msg("tool", "file contents ".repeat(300), { tool_call_id: `c${i}`, name: "read_file" }));
  }
  h.push(msg("user", "current question"));
  return h;
}

describe("estimateTokens", () => {
  it("counts chars/4 across content and tool_calls", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens([msg("user", "abcdefgh")])).toBe(2);
    expect(estimateTokens(null)).toBe(0);
  });
});

describe("compactHistory invariants", () => {
  it("strictly decreases tokens on a compactable history", () => {
    const h = longHistory();
    const res = compactHistory(h);
    expect(res.compacted).toBe(true);
    expect(res.afterTokens).toBeLessThan(res.beforeTokens);
  });

  it("preserves message count and tool pairing (no fact block)", () => {
    const h = longHistory();
    const res = compactHistory(h);
    expect(res.history).toHaveLength(h.length);
    // Every assistant tool_call still has its tool reply at the same offset.
    res.history.forEach((m, i) => {
      expect(m.role).toBe(h[i].role);
      if (h[i].tool_calls) expect(m.tool_calls).toEqual(h[i].tool_calls);
    });
  });

  it("keeps the tail verbatim", () => {
    const h = longHistory();
    const res = compactHistory(h, { keepLastTurns: 5 });
    expect(res.history.slice(-5)).toEqual(h.slice(-5));
  });

  it("replaces old tool output with a re-readable reference", () => {
    const res = compactHistory(longHistory());
    const firstTool = res.history.find((m) => m.role === "tool")!;
    expect(firstTool.content).toContain("[compacted:");
    expect(firstTool.content).toContain("re-read");
  });

  it("prepends the fact block as a system message", () => {
    const res = compactHistory(longHistory(), { factBlock: "Goal: build X\n- [done] step 1" });
    expect(res.history[0].role).toBe("system");
    expect(res.history[0].content).toContain("Goal: build X");
  });

  it("returns as-is when nothing is compactable", () => {
    const h = [msg("user", "short")];
    const res = compactHistory(h);
    expect(res.compacted).toBe(false);
    expect(res.history).toBe(h);
  });
});

describe("taskFactBlock / buildHandoffBrief", () => {
  const events: TaskEvent[] = [
    { type: "classified", classification: "complex", questions: [] },
    {
      type: "planned",
      todos: [
        {
          id: "a",
          text: "implement",
          acceptance: "npm test passes",
          status: "done",
          verdicts: [],
          attempts: 1,
          strategyLog: ["minimal fix"],
        },
      ],
    },
    { type: "explored", summary: "small node app" },
  ];
  const state = events.reduce(taskReducer, initialTaskState("t1", "build the thing"));

  it("fact block carries goal, todos, explore summary", () => {
    const block = taskFactBlock(state);
    expect(block).toContain("Goal: build the thing");
    expect(block).toContain("[done] implement");
    expect(block).toContain("small node app");
  });

  it("handoff brief is a self-contained markdown resume", () => {
    const brief = buildHandoffBrief(state, {
      changedFiles: ["lib/x.js"],
      openQuestions: ["keep the old API?"],
      costUsd: 0.1234,
    });
    expect(brief).toContain("# Atlas Code — session handoff");
    expect(brief).toContain("[x] implement");
    expect(brief).toContain("strategies tried: minimal fix");
    expect(brief).toContain("lib/x.js");
    expect(brief).toContain("keep the old API?");
    expect(brief).toContain("$0.1234");
  });
});
