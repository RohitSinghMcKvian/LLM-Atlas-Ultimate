import { describe, expect, it } from "vitest";
import { namespacedToolName } from "@/lib/mcp/protocol";
import {
  DEFAULT_RULE,
  decideToolApproval,
  deniedToolResult,
  describePending,
  offerable,
  refusedTools,
  setToolRule,
  type ApprovalPolicy,
} from "./policy";

const mcpTool = namespacedToolName("calendar", "create_event");

describe("decideToolApproval", () => {
  it("defaults to asking", () => {
    expect(DEFAULT_RULE).toBe("ask");
    expect(decideToolApproval({}, "memory")).toBe("ask");
    expect(decideToolApproval({}, "atlas_bench")).toBe("ask");
  });

  it("lets a read run without a prompt", () => {
    expect(decideToolApproval({}, "atlas_graph")).toBe("allow");
    expect(decideToolApproval({}, "read_project_file")).toBe("allow");
  });

  it("does not re-ask about a network tool the user already enabled by toggle", () => {
    expect(decideToolApproval({}, "web_search")).toBe("allow");
    expect(decideToolApproval({}, "github")).toBe("allow");
  });

  it("remembers a yes for that tool alone", () => {
    const policy = setToolRule({}, "atlas_prompt", "always");
    expect(decideToolApproval(policy, "atlas_prompt")).toBe("allow");
    expect(decideToolApproval(policy, "atlas_bench")).toBe("ask");
  });

  it("remembers a no", () => {
    const policy = setToolRule({}, "run_python", "never");
    expect(decideToolApproval(policy, "run_python")).toBe("deny");
  });

  it("clears a rule back to asking", () => {
    let policy = setToolRule({}, "memory", "always");
    policy = setToolRule(policy, "memory", "ask");
    expect(policy.memory).toBeUndefined();
    expect(decideToolApproval(policy, "memory")).toBe("ask");
  });

  it("leaves connector tools to the gate that already owns them", () => {
    expect(decideToolApproval({}, mcpTool)).toBe("ask");
    expect(decideToolApproval(setToolRule({}, mcpTool, "always"), mcpTool)).toBe("allow");
    expect(decideToolApproval(setToolRule({}, mcpTool, "never"), mcpTool)).toBe("deny");
  });

  it("asks about a tool it has never heard of", () => {
    expect(decideToolApproval({}, "brand_new_tool")).toBe("ask");
  });

  it("an always-allow on one tool is not a blank cheque for a surface", () => {
    const policy = setToolRule({}, namespacedToolName("cal", "read_event"), "always");
    expect(decideToolApproval(policy, namespacedToolName("cal", "delete_calendar"))).toBe("ask");
  });
});

describe("offerable / refusedTools", () => {
  it("withholds a tool the user permanently refused", () => {
    const policy: ApprovalPolicy = setToolRule({}, "run_python", "never");
    expect(offerable(policy, ["atlas_graph", "run_python", "memory"])).toEqual([
      "atlas_graph",
      "memory",
    ]);
  });

  it("lists refusals in stable order", () => {
    let policy: ApprovalPolicy = setToolRule({}, "run_python", "never");
    policy = setToolRule(policy, "artifact", "never");
    policy = setToolRule(policy, "memory", "always");
    expect(refusedTools(policy)).toEqual(["artifact", "run_python"]);
  });

  it("offers everything when nothing is refused", () => {
    expect(offerable({}, ["memory", "atlas_graph"])).toEqual(["memory", "atlas_graph"]);
  });
});

describe("describePending / deniedToolResult", () => {
  it("describes a call in the words a prompt can use", () => {
    expect(describePending("atlas_bench", '{"suite":"x"}')).toEqual({
      name: "atlas_bench",
      title: "atlas_bench",
      sideEffect: "write",
      args: '{"suite":"x"}',
    });
    expect(describePending("memory", "{}").title).toBe("Memory");
  });

  it("tells the model a refusal is settled, not a retryable error", () => {
    const r = deniedToolResult("run_python");
    expect(r.isError).toBe(true);
    expect(r.content).toContain("Do not call it again this turn");
  });
});
