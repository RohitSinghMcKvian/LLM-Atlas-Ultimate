import { describe, it, expect } from "vitest";
import { buildActivity } from "./activity";
import type { StoredToolCall } from "./types";

const call = (name: string, extra: Partial<StoredToolCall> = {}): StoredToolCall => ({
  id: `${name}-1`,
  name,
  arguments: "{}",
  result: "ok",
  ...extra,
});

describe("buildActivity", () => {
  it("shows nothing for a plain answer", () => {
    const a = buildActivity({});
    expect(a.entries).toEqual([]);
    expect(a.summary).toBeNull();
  });

  it("names each built-in tool in plain language", () => {
    const a = buildActivity({
      toolCalls: [call("web_search"), call("memory"), call("github"), call("artifact")],
    });
    expect(a.entries.map((e) => e.label)).toEqual([
      "Searched the web",
      "Used memory",
      "Read from GitHub",
      "Edited the artifact",
    ]);
  });

  it("reads an MCP tool name as a service and an action", () => {
    expect(buildActivity({ toolCalls: [call("mcp__notion__search_pages")] }).entries[0].label).toBe(
      "Called search_pages on notion",
    );
  });

  it("falls back to the raw name for an unknown tool", () => {
    expect(buildActivity({ toolCalls: [call("weird_thing")] }).entries[0].label).toBe(
      "Ran weird_thing",
    );
  });

  it("pulls one meaningful argument out for the detail line", () => {
    const a = buildActivity({
      toolCalls: [call("web_search", { arguments: '{"search_query":"atlas chat","max_results":5}' })],
    });
    expect(a.entries[0].detail).toBe("atlas chat");
  });

  it("survives arguments that are still streaming in", () => {
    const a = buildActivity({ toolCalls: [call("web_search", { arguments: '{"search_qu' })] });
    expect(a.entries[0].detail).toBeUndefined();
  });

  it("marks a call with no result yet as running", () => {
    expect(buildActivity({ toolCalls: [call("web_search", { result: undefined })] }).entries[0].status).toBe(
      "running",
    );
  });

  it("marks a tool error as failed", () => {
    const a = buildActivity({
      toolCalls: [call("artifact", { result: "Could not find that text in the artifact: \"x\"." })],
    });
    expect(a.entries[0].status).toBe("error");
    expect(a.hasError).toBe(true);
  });

  // The one thing the user must not have to expand something to discover.
  it("promotes a failed step into the collapsed summary", () => {
    const a = buildActivity({
      toolCalls: [call("web_search"), call("artifact", { result: "Could not find it" }), call("memory")],
    });
    expect(a.summary).toBe("Edited the artifact · 2 other steps");
  });

  it("summarises a single step as itself and several as a count", () => {
    expect(buildActivity({ toolCalls: [call("web_search", { arguments: '{"search_query":"x"}' }) ] }).summary)
      .toBe("Searched the web: x");
    expect(buildActivity({ toolCalls: [call("web_search"), call("memory"), call("skill")] }).summary)
      .toBe("Searched the web · 2 more steps");
  });

  it("summarises reasoning alone as a token count", () => {
    expect(buildActivity({ reasoning: "x".repeat(400) }).summary).toBe("Thought for 100 tokens");
  });

  it("reads as live while the turn is in flight", () => {
    const a = buildActivity({ streaming: true, toolCalls: [call("web_search", { result: undefined })] });
    expect(a.summary).toBe("Searched the web…");
  });

  it("records a resumed answer rather than hiding the seam", () => {
    const a = buildActivity({ continuations: 2 });
    expect(a.entries[0].label).toBe("Resumed a truncated answer");
    expect(a.entries[0].detail).toBe("2 times");
    expect(a.hasError).toBe(false);
  });

  it("flags an answer that is still cut off as an error", () => {
    const a = buildActivity({ continuations: 3, truncated: true });
    expect(a.hasError).toBe(true);
    expect(a.summary).toContain("still incomplete");
  });

  it("counts artifact runtime errors as a step", () => {
    const a = buildActivity({ artifactErrors: ["boom", "bang"] });
    expect(a.entries[0].kind).toBe("artifact-error");
    expect(a.entries[0].detail).toBe("2");
  });

  it("keeps steps in the order they happened", () => {
    const a = buildActivity({
      reasoning: "abcd",
      toolCalls: [call("web_search"), call("artifact")],
      continuations: 1,
    });
    expect(a.entries.map((e) => e.kind)).toEqual(["thinking", "tool", "artifact", "continuation"]);
  });
});
