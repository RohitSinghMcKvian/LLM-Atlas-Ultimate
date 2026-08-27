import { describe, expect, it } from "vitest";
import { TOOL_NAMES } from "@/lib/chat/tools";
import { namespacedToolName } from "@/lib/mcp/protocol";
import {
  ALL_CLASSES,
  ATLAS_CLASSES,
  BUILTIN_CLASSES,
  classify,
  needsApproval,
  toolIndexBlock,
} from "./spec";

describe("the table cannot drift from the registry", () => {
  it("classifies every registered tool", () => {
    const missing = TOOL_NAMES.filter((n) => !ALL_CLASSES[n]);
    expect(missing).toEqual([]);
  });

  it("has no entry for a tool that no longer exists", () => {
    const stale = Object.keys(ALL_CLASSES).filter((n) => !TOOL_NAMES.includes(n));
    expect(stale).toEqual([]);
  });

  it("every Atlas tool is registered, so the table cannot describe a phantom", () => {
    for (const name of Object.keys(ATLAS_CLASSES)) expect(TOOL_NAMES).toContain(name);
  });

  it("keys match their own name field", () => {
    for (const [key, c] of Object.entries(ALL_CLASSES)) expect(c.name).toBe(key);
  });

  it("merges built-ins and Atlas tools without collision", () => {
    for (const name of Object.keys(ATLAS_CLASSES)) expect(BUILTIN_CLASSES[name]).toBeUndefined();
    expect(Object.keys(ALL_CLASSES)).toHaveLength(
      Object.keys(BUILTIN_CLASSES).length + Object.keys(ATLAS_CLASSES).length,
    );
  });
});

describe("classify", () => {
  it("knows a built-in", () => {
    expect(classify("web_search")).toMatchObject({ surface: "core", sideEffect: "network" });
    expect(classify("read_project_file").sideEffect).toBe("read");
  });

  it("knows an Atlas tool", () => {
    expect(classify("atlas_graph")).toMatchObject({ surface: "atlas", sideEffect: "read" });
  });

  it("treats a connector tool as a write, whatever its server claims", () => {
    const name = namespacedToolName("calendar", "delete_everything");
    expect(classify(name)).toMatchObject({ surface: "connector", sideEffect: "write" });
    expect(classify(name).title).toContain("calendar");
  });

  it("treats an unknown name as a write, not as a read", () => {
    expect(classify("something_new").sideEffect).toBe("write");
  });

  it("counts a fan-out as spend, because it starts real model runs", () => {
    expect(classify("spawn_subagents").sideEffect).toBe("spend");
  });
});

describe("needsApproval", () => {
  it("lets reads and network calls through", () => {
    for (const n of ["read_project_file", "atlas_graph", "web_search", "github", "skill"]) {
      expect(needsApproval(n)).toBe(false);
    }
  });

  it("gates writes and spends", () => {
    for (const n of ["memory", "artifact", "run_python", "spawn_subagents"]) {
      expect(needsApproval(n)).toBe(true);
    }
  });

  it("gates anything it does not recognise", () => {
    expect(needsApproval("mystery_tool")).toBe(true);
    expect(needsApproval(namespacedToolName("c", "t"))).toBe(true);
  });
});

describe("toolIndexBlock", () => {
  it("groups the three surfaces into one block", () => {
    const block = toolIndexBlock([
      "web_search",
      "atlas_graph",
      namespacedToolName("linear", "create_issue"),
    ]);
    expect(block).toContain("<atlas_tools>");
    expect(block).toContain("</atlas_tools>");
    expect(block).toContain("Chat tools:");
    expect(block).toContain("Atlas modules");
    expect(block).toContain("Connected services:");
  });

  it("marks which tools will ask first", () => {
    const block = toolIndexBlock(["atlas_graph", "memory"]);
    expect(block).toMatch(/- memory - Memory \(asks first\)/);
    expect(block).toMatch(/- atlas_graph - Atlas graph\n/);
  });

  it("is empty for an empty set, rather than an empty header", () => {
    expect(toolIndexBlock([])).toBe("");
  });

  it("is deterministic", () => {
    const names = ["memory", "atlas_cost", "web_search", "atlas_graph"];
    expect(toolIndexBlock(names)).toBe(toolIndexBlock([...names].reverse()));
  });
});
