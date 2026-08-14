import { describe, it, expect } from "vitest";
import { bodyFor, buildRun, detailFor, headlineFor, resultFailed, summarizeRun } from "./run-model";
import type { StoredToolCall } from "./types";

let n = 0;
const call = (name: string, argsObj: unknown, result?: string): StoredToolCall => ({
  id: `c${n++}`,
  name,
  arguments: JSON.stringify(argsObj),
  ...(result === undefined ? {} : { result }),
});

describe("bodyFor", () => {
  // What makes a run legible rather than a list of names: the body is shaped by
  // what the tool actually did.
  it("parses search results back out of what the model was given", () => {
    const result =
      "[1] First result\nhttps://a.test\nsnippet one\n\n[2] Second\nhttps://b.test\nsnippet two";
    const body = bodyFor(call("web_search", { search_query: "atlas" }, result));
    expect(body.kind).toBe("search");
    if (body.kind !== "search") throw new Error("wrong body");
    expect(body.sources).toHaveLength(2);
    expect(body.sources[0]).toEqual({
      title: "First result",
      url: "https://a.test",
      snippet: "snippet one",
    });
    expect(body.query).toBe("atlas");
  });

  it("gives a write a diff body and a read none", () => {
    const write = bodyFor(
      call("workspace", { command: "create", path: "/workspace/a.html" }, "Created a.html"),
    );
    expect(write.kind).toBe("diff");

    const read = bodyFor(call("workspace", { command: "view", path: "/workspace/a.html" }, "<p>"));
    expect(read.kind).toBe("raw");
  });

  it("gives python a terminal, live while it runs", () => {
    const running = bodyFor({ id: "1", name: "run_python", arguments: "{}" }, "partial output\n");
    expect(running).toEqual({ kind: "terminal", text: "partial output\n", failed: false });

    const done = bodyFor(call("run_python", { code: "x" }, "42\n"), "stale");
    expect(done).toEqual({ kind: "terminal", text: "42\n", failed: false });
  });

  it("marks a failed run so the terminal can open itself", () => {
    const body = bodyFor(call("run_python", { code: "x" }, 'Tool "run_python" failed: boom'));
    expect(body.kind === "terminal" && body.failed).toBe(true);
  });

  it("summarises a ledger change", () => {
    const body = bodyFor(call("tasks", { command: "complete", step: "2" }, "Marked step 2 done\n…"));
    expect(body).toEqual({ kind: "tasks", summary: "Marked step 2 done" });
  });

  it("falls back to raw for anything unrecognised", () => {
    expect(bodyFor(call("mcp__notion__search", { query: "x" }, "found")).kind).toBe("raw");
  });

  it("tolerates arguments that are still streaming in", () => {
    expect(bodyFor({ id: "1", name: "web_search", arguments: '{"search_' }).kind).toBe("raw");
  });
});

describe("detailFor", () => {
  it("shows the one argument worth showing", () => {
    expect(detailFor(call("web_search", { search_query: "css grid" }))).toBe("css grid");
    expect(detailFor(call("workspace", { command: "create", path: "/w/a.html" }))).toBe("/w/a.html");
  });

  it("truncates a long value", () => {
    expect(detailFor(call("web_search", { search_query: "x".repeat(200) }))).toHaveLength(65);
  });

  it("returns nothing when there is no useful field", () => {
    expect(detailFor(call("list_project_files", {}))).toBeUndefined();
  });
});

describe("resultFailed", () => {
  it("recognises the refusals tools.ts produces", () => {
    expect(resultFailed('Tool "x" failed: boom')).toBe(true);
    expect(resultFailed("Search unavailable: no key")).toBe(true);
    expect(resultFailed("The Python sandbox is not running.")).toBe(true);
    expect(resultFailed("Invalid arguments for x")).toBe(true);
  });

  it("leaves an ordinary result alone", () => {
    expect(resultFailed("Created a.html")).toBe(false);
    expect(resultFailed(undefined)).toBe(false);
  });
});

describe("buildRun", () => {
  it("orders thinking before the tools that followed it", () => {
    const run = buildRun({
      reasoning: "some thought",
      toolCalls: [call("web_search", { search_query: "q" }, "[1] a\nhttps://a.test\ns")],
    });
    expect(run.steps.map((s) => s.kind)).toEqual(["thinking", "tool"]);
  });

  it("marks a call with no result as in flight", () => {
    const run = buildRun({
      streaming: true,
      toolCalls: [{ id: "1", name: "run_python", arguments: "{}" }],
    });
    expect(run.steps[0].status).toBe("running");
    expect(run.steps[0].label).toBe("Running Python");
  });

  it("uses the past tense once a call has finished", () => {
    const run = buildRun({ toolCalls: [call("run_python", { code: "x" }, "ok")] });
    expect(run.steps[0].label).toBe("Ran Python");
  });

  it("names an MCP tool and its connector", () => {
    const run = buildRun({ toolCalls: [call("mcp__notion__search", { query: "x" }, "found")] });
    expect(run.steps[0].label).toBe("Called search on notion");
  });

  it("appends the stop as a step so the run ends visibly", () => {
    const run = buildRun({ stoppedBy: "Stopped after 20 tool rounds." });
    expect(run.steps.at(-1)?.kind).toBe("note");
    expect(run.hasError).toBe(true);
  });

  it("computes clamped meter ratios", () => {
    const run = buildRun({ rounds: 5, maxRounds: 20, spentUsd: 0.5, maxUsd: 2 });
    expect(run.meters.roundsRatio).toBeCloseTo(0.25);
    expect(run.meters.costRatio).toBeCloseTo(0.25);
  });

  // Providers report usage after the fact and can push spend past the ceiling
  // the budget checked against; a bar wider than its track is not a bug worth
  // rendering.
  it("clamps a ratio past its ceiling", () => {
    const run = buildRun({ rounds: 30, maxRounds: 20, spentUsd: 5, maxUsd: 2 });
    expect(run.meters.roundsRatio).toBe(1);
    expect(run.meters.costRatio).toBe(1);
  });

  it("does not divide by a missing ceiling", () => {
    const run = buildRun({ rounds: 3 });
    expect(run.meters.roundsRatio).toBe(0);
    expect(run.meters.costRatio).toBe(0);
  });

  it("produces an empty run from empty input", () => {
    const run = buildRun({});
    expect(run.steps).toEqual([]);
    expect(run.headline).toBe("");
    expect(run.hasError).toBe(false);
  });
});

/**
 * Three dots for forty seconds reads as hung. Naming the step in progress is the
 * difference between "it is working" and "it has stopped".
 */
describe("headlineFor", () => {
  it("names the step in progress while streaming", () => {
    const run = buildRun({
      streaming: true,
      toolCalls: [{ id: "1", name: "web_search", arguments: '{"search_query":"css grid"}' }],
    });
    expect(run.headline).toContain("Searching the web");
    expect(run.headline).toContain("css grid");
  });

  it("says something rather than nothing before the first step", () => {
    expect(headlineFor([], true)).toBe("Working…");
    expect(headlineFor([], false)).toBe("");
  });

  it("promotes a failure over a count", () => {
    const run = buildRun({
      toolCalls: [
        call("web_search", { search_query: "q" }, "Search unavailable: no key"),
        call("workspace", { command: "create", path: "/w/a" }, "Created a"),
      ],
    });
    expect(run.headline).toBe("Searched the web");
  });

  it("counts the steps of a finished run", () => {
    const run = buildRun({
      toolCalls: [
        call("workspace", { command: "create", path: "/w/a" }, "Created a"),
        call("workspace", { command: "create", path: "/w/b" }, "Created b"),
      ],
    });
    expect(run.headline).toBe("2 steps");
  });
});

describe("summarizeRun", () => {
  it("names what the run produced", () => {
    const s = summarizeRun(
      [
        call("workspace", { command: "create", path: "/w/a" }, "ok"),
        call("workspace", { command: "view", path: "/w/a" }, "ok"),
        call("run_python", { code: "x" }, "ok"),
        call("web_search", { search_query: "q" }, "ok"),
      ],
      42_000,
      0.31,
    );
    expect(s).toContain("1 file written");
    expect(s).toContain("1 python run");
    expect(s).toContain("1 search");
    expect(s).toContain("42s");
    expect(s).toContain("$0.31");
  });

  it("says nothing about a run that did nothing", () => {
    expect(summarizeRun([], 0, 0)).toBe("");
  });
});
