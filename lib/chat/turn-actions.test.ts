import { describe, it, expect } from "vitest";
import {
  ACTIONS_BUDGET,
  appendActions,
  budgetActions,
  renderCall,
  summarizeTurnActions,
} from "./turn-actions";
import type { StoredToolCall } from "./types";

let n = 0;
const call = (name: string, args: unknown = {}, result = "ok"): StoredToolCall => ({
  id: `c${n++}`,
  name,
  arguments: JSON.stringify(args),
  result,
});

describe("renderCall", () => {
  it("names the action and the thing it acted on", () => {
    expect(renderCall(call("workspace", { command: "create", path: "/w/a.html" }), 120)).toContain(
      "/w/a.html",
    );
    expect(renderCall(call("web_search", { search_query: "css grid" }), 120)).toContain("css grid");
    expect(renderCall(call("run_python", { code: "x" }), 120)).toContain("Python");
  });

  // Without this the line reads as a record of having done the thing, and the
  // model does not retry.
  it("marks a failure", () => {
    const failed = call("web_search", { search_query: "q" }, "Search unavailable: no key");
    expect(renderCall(failed, 120)).toContain("failed");
  });

  it("names an MCP tool and its connector", () => {
    expect(renderCall(call("mcp__notion__search", { query: "x" }), 120)).toContain("notion");
  });

  it("truncates past the per-call budget", () => {
    const long = call("workspace", { path: "/w/" + "x".repeat(500) });
    expect(renderCall(long, 60).length).toBeLessThanOrEqual(60);
  });
});

describe("summarizeTurnActions", () => {
  it("says nothing for a turn that called nothing", () => {
    expect(summarizeTurnActions([])).toBe("");
  });

  it("lists what happened, in order", () => {
    const line = summarizeTurnActions([
      call("workspace", { command: "create", path: "/w/a.html" }),
      call("run_python", { code: "x" }),
    ]);
    expect(line).toMatch(/^\[Actions this turn: /);
    expect(line.indexOf("/w/a.html")).toBeLessThan(line.indexOf("Python"));
  });

  // A model that re-read the same file four times should not spend four lines
  // saying so.
  it("collapses consecutive identical calls", () => {
    const same = { command: "view", path: "/w/app.js" };
    const line = summarizeTurnActions([
      call("workspace", same),
      call("workspace", same),
      call("workspace", same),
    ]);
    expect(line).toContain("×3");
  });

  it("stays inside the per-turn budget", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      call("workspace", { command: "create", path: `/workspace/file-${i}.html` }),
    );
    const line = summarizeTurnActions(many);
    expect(line.length).toBeLessThanOrEqual(ACTIONS_BUDGET.perTurn + 24);
    expect(line).toContain("…");
  });
});

describe("appendActions", () => {
  it("appends to existing content", () => {
    const out = appendActions("The page is done.", [call("workspace", { path: "/w/a" })]);
    expect(out).toContain("The page is done.");
    expect(out).toContain("Actions this turn");
  });

  it("returns the content unchanged when there is nothing to add", () => {
    expect(appendActions("hello", [])).toBe("hello");
  });

  it("works on an empty reply", () => {
    expect(appendActions("", [call("workspace", { path: "/w/a" })])).toMatch(/^\[Actions/);
  });
});

describe("budgetActions", () => {
  const turn = (id: string) => ({
    id,
    calls: [call("workspace", { command: "create", path: `/workspace/${id}.html` })],
  });

  it("only annotates the most recent turns", () => {
    const turns = Array.from({ length: 20 }, (_, i) => turn(`t${i}`));
    const out = budgetActions(turns);
    expect(out.size).toBeLessThanOrEqual(ACTIONS_BUDGET.turns);
    // Newest kept, oldest dropped — a follow-up is about the recent ones, and
    // older actions are already in the workspace block and the fold summary.
    expect(out.has("t19")).toBe(true);
    expect(out.has("t0")).toBe(false);
  });

  it("never exceeds the total", () => {
    const turns = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`,
      calls: Array.from({ length: 20 }, (_, j) =>
        call("workspace", { command: "create", path: `/workspace/${i}-${j}.html` }),
      ),
    }));
    const total = [...budgetActions(turns).values()].reduce((n, s) => n + s.length, 0);
    expect(total).toBeLessThanOrEqual(ACTIONS_BUDGET.total);
  });

  it("skips turns that called nothing", () => {
    expect(budgetActions([{ id: "a", calls: [] }]).size).toBe(0);
  });

  it("handles an empty conversation", () => {
    expect(budgetActions([]).size).toBe(0);
  });
});
