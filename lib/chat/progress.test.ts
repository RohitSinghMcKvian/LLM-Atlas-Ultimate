import { describe, it, expect } from "vitest";
import { callSignature, classifyCall, classifyRound, isLooping } from "./progress";
import type { StoredToolCall } from "./types";

let n = 0;
const mk = (name: string, args: unknown, result = "ok"): StoredToolCall => ({
  id: `c${n++}`,
  name,
  arguments: JSON.stringify(args),
  result,
});

describe("classifyCall", () => {
  it("counts a write as productive", () => {
    expect(classifyCall(mk("workspace", { command: "create", path: "/a" }))).toBe("productive");
    expect(classifyCall(mk("tasks", { command: "complete", step: "1" }))).toBe("productive");
    expect(classifyCall(mk("artifact", { command: "update" }))).toBe("productive");
    expect(classifyCall(mk("memory", { command: "write", path: "/memories/a" }))).toBe("productive");
  });

  it("counts a read of the same tool as informative, not as a write", () => {
    expect(classifyCall(mk("workspace", { command: "view", path: "/a" }))).toBe("informative");
    expect(classifyCall(mk("tasks", { command: "list" }))).toBe("informative");
    expect(classifyCall(mk("artifact", { command: "read" }))).toBe("informative");
    // A second bug in the old inline classifier: `artifact list` counted as a
    // write, so a model listing its own files looked like it was building.
    expect(classifyCall(mk("artifact", { command: "list" }))).toBe("informative");
  });

  // THE regression. Every one of these used to count as getting nowhere, which
  // is why two rounds of research halted a build.
  it("counts information-gathering as progress", () => {
    for (const name of [
      "web_search",
      "github",
      "read_project_file",
      "list_project_files",
      "search_past_chats",
      "skill",
      "mcp__notion__search",
    ]) {
      expect(classifyCall(mk(name, {})), name).toBe("informative");
    }
  });

  it("treats an errored or empty result as barren", () => {
    expect(classifyCall(mk("web_search", {}, "No results found. Try a different phrasing."))).toBe(
      "barren",
    );
    expect(classifyCall(mk("web_search", {}, "Search unavailable: Brave needs an API key."))).toBe(
      "barren",
    );
    expect(classifyCall(mk("workspace", { command: "create" }, 'Tool "workspace" failed: x'))).toBe(
      "barren",
    );
    expect(classifyCall(mk("github", {}, "Could not find that repository."))).toBe("barren");
    expect(classifyCall(mk("web_search", {}, "   "))).toBe("barren");
    expect(classifyCall({ id: "x", name: "web_search", arguments: "{}" })).toBe("barren");
  });

  // A traceback is the model learning something. Worth a round; not worth
  // resetting the counter that asks whether anything has been written.
  it("counts code execution as productive only when it ran", () => {
    expect(classifyCall(mk("run_python", { code: "1" }, "42\nexit code: 0"))).toBe("productive");
    expect(classifyCall(mk("run_python", { code: "x" }, "Traceback...\nexit code: 1"))).toBe(
      "informative",
    );
  });

  it("tolerates unparseable arguments without crashing", () => {
    expect(classifyCall({ id: "x", name: "workspace", arguments: "{part", result: "ok" })).toBe(
      // No readable command, so it cannot be proven read-only — treated as a write.
      "productive",
    );
  });
});

describe("classifyRound", () => {
  // Judging by the worst call would let a model's habit of re-reading its own
  // output cancel out the work it did in the same round.
  it("takes the best verdict in the round", () => {
    expect(
      classifyRound([
        mk("workspace", { command: "view", path: "/a" }),
        mk("workspace", { command: "create", path: "/b" }),
      ]),
    ).toBe("productive");
    expect(
      classifyRound([mk("web_search", {}, "No results found."), mk("github", {})]),
    ).toBe("informative");
  });

  it("is barren when every call failed", () => {
    expect(
      classifyRound([mk("web_search", {}, "No results found."), mk("github", {}, 'Tool "github" failed')]),
    ).toBe("barren");
  });

  it("is barren with no calls at all", () => {
    expect(classifyRound([])).toBe("barren");
  });
});

describe("callSignature", () => {
  // Models re-emit the same request with the fields reordered and the
  // whitespace different; comparing raw strings would miss every real repeat.
  it("is stable across key order and whitespace", () => {
    const a: StoredToolCall = { id: "1", name: "w", arguments: '{"a":1,"b":2}' };
    const b: StoredToolCall = { id: "2", name: "w", arguments: '{ "b": 2, "a": 1 }' };
    expect(callSignature(a)).toBe(callSignature(b));
  });

  it("separates different arguments and different tools", () => {
    const base: StoredToolCall = { id: "1", name: "w", arguments: '{"a":1}' };
    expect(callSignature(base)).not.toBe(callSignature({ ...base, arguments: '{"a":2}' }));
    expect(callSignature(base)).not.toBe(callSignature({ ...base, name: "x" }));
  });

  it("handles nested objects, arrays and absent arguments", () => {
    const a: StoredToolCall = { id: "1", name: "w", arguments: '{"o":{"y":2,"x":[1,{"b":1,"a":2}]}}' };
    const b: StoredToolCall = { id: "2", name: "w", arguments: '{"o":{"x":[1,{"a":2,"b":1}],"y":2}}' };
    expect(callSignature(a)).toBe(callSignature(b));
    expect(callSignature({ id: "3", name: "w" })).toBe("w:");
  });

  // A malformed call repeated verbatim is still a repeat.
  it("falls back to the raw string when arguments are unparseable", () => {
    const a: StoredToolCall = { id: "1", name: "w", arguments: "{broken " };
    const b: StoredToolCall = { id: "2", name: "w", arguments: "{broken" };
    expect(callSignature(a)).toBe(callSignature(b));
  });
});

describe("isLooping", () => {
  it("fires at the third occurrence", () => {
    expect(isLooping(["a", "a"])).toBe(false);
    expect(isLooping(["a", "a", "a"])).toBe(true);
  });

  // A model alternating between two calls it has already made never produces a
  // consecutive repeat, so a per-round or consecutive counter would never see it.
  it("catches an alternating pair", () => {
    expect(isLooping(["a", "b", "a", "b", "a"])).toBe(true);
  });

  it("does not fire on distinct calls", () => {
    expect(isLooping(["a", "b", "c", "d", "e", "f"])).toBe(false);
    expect(isLooping([])).toBe(false);
  });

  it("honours a custom threshold", () => {
    expect(isLooping(["a", "a"], 2)).toBe(true);
    expect(isLooping(["a", "a", "a"], 4)).toBe(false);
  });
});
