import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_RULE,
  MAX_ARGS_PREVIEW_CHARS,
  clearConnectorRules,
  decideApproval,
  deniedResult,
  formatArgsForReview,
  setRule,
  type ApprovalPolicy,
  type PendingApproval,
} from "./approval";
import {
  connectorToolDefs,
  connectorsIndexBlock,
  resolveTool,
  runMcpTool,
  type BridgeConnector,
} from "./bridge";
import { namespacedToolName } from "./protocol";

const CAL: BridgeConnector = {
  id: "calendar",
  name: "Calendar",
  enabled: true,
  approvals: {},
  tools: [
    {
      name: "create_event",
      description: "Create a calendar event.",
      inputSchema: { type: "object", properties: { title: { type: "string" } } },
    },
    {
      name: "delete_calendar",
      description: "Delete an entire calendar.",
      inputSchema: { type: "object" },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
  ],
};

const CREATE = namespacedToolName("calendar", "create_event");
const DELETE = namespacedToolName("calendar", "delete_calendar");

describe("decideApproval", () => {
  // Nothing auto-runs. A connector cannot arrive pre-approved.
  it("defaults to asking", () => {
    expect(DEFAULT_RULE).toBe("ask");
    expect(decideApproval({}, CREATE)).toBe("ask");
  });

  it("honours a remembered allow and a remembered refusal", () => {
    expect(decideApproval({ [CREATE]: "always" }, CREATE)).toBe("allow");
    expect(decideApproval({ [CREATE]: "never" }, CREATE)).toBe("deny");
  });

  // Approving one tool must not be a blank cheque for every tool the server adds.
  it("does not let one tool's approval cover another", () => {
    const policy: ApprovalPolicy = { [CREATE]: "always" };
    expect(decideApproval(policy, DELETE)).toBe("ask");
  });

  // Built-ins have their own toggles; routing them here would prompt for things
  // the user already opted into.
  it("allows non-connector tools through untouched", () => {
    expect(decideApproval({}, "web_search")).toBe("allow");
    expect(decideApproval({}, "memory")).toBe("allow");
  });
});

describe("setRule / clearConnectorRules", () => {
  it("stores always and never", () => {
    expect(setRule({}, CREATE, "always")).toEqual({ [CREATE]: "always" });
    expect(setRule({}, CREATE, "never")).toEqual({ [CREATE]: "never" });
  });

  it("setting back to ask removes the entry rather than storing it", () => {
    expect(setRule({ [CREATE]: "always" }, CREATE, "ask")).toEqual({});
  });

  it("does not mutate the policy it is given", () => {
    const policy: ApprovalPolicy = { [CREATE]: "always" };
    setRule(policy, DELETE, "never");
    expect(policy).toEqual({ [CREATE]: "always" });
  });

  // Otherwise a stale "always" would apply to a server the user disconnected —
  // or to a different server that reused the id.
  it("clears every rule for one connector, leaving others", () => {
    const other = namespacedToolName("email", "send");
    const policy: ApprovalPolicy = { [CREATE]: "always", [DELETE]: "never", [other]: "always" };
    expect(clearConnectorRules(policy, "calendar")).toEqual({ [other]: "always" });
  });
});

describe("formatArgsForReview", () => {
  it("pretty-prints JSON so a human can read what they are approving", () => {
    expect(formatArgsForReview('{"to":"a@b.c"}')).toBe('{\n  "to": "a@b.c"\n}');
  });

  it("says so when there are no arguments", () => {
    expect(formatArgsForReview("{}")).toBe("(no arguments)");
    expect(formatArgsForReview("   ")).toBe("(no arguments)");
  });

  // Hiding unparseable arguments would hide the evidence of why the call fails.
  it("shows unparseable arguments as-is", () => {
    expect(formatArgsForReview("{broken")).toBe("{broken");
  });

  it("truncates an argument blob long enough to push the operation off screen", () => {
    const out = formatArgsForReview(JSON.stringify({ x: "y".repeat(MAX_ARGS_PREVIEW_CHARS) }));
    expect(out.length).toBeLessThan(MAX_ARGS_PREVIEW_CHARS + 100);
    expect(out).toContain("truncated");
  });
});

describe("connectorToolDefs", () => {
  it("namespaces every tool", () => {
    const names = connectorToolDefs([CAL]).map((d) => d.function.name);
    expect(names).toEqual([CREATE, DELETE]);
  });

  // The model sees a flat list; without the connector name "Delete a record"
  // gives no clue whose record.
  it("prefixes the description with the connector name", () => {
    expect(connectorToolDefs([CAL])[0].function.description).toContain("[Calendar]");
  });

  it("passes the server's schema through unchanged", () => {
    expect(connectorToolDefs([CAL])[0].function.parameters).toEqual(CAL.tools[0].inputSchema);
  });

  it("offers nothing for a disabled connector", () => {
    expect(connectorToolDefs([{ ...CAL, enabled: false }])).toEqual([]);
  });

  // Listing a permanently-refused tool only invites a call that burns a round.
  it("withholds a tool the user set to never", () => {
    const defs = connectorToolDefs([{ ...CAL, approvals: { [DELETE]: "never" } }]);
    expect(defs.map((d) => d.function.name)).toEqual([CREATE]);
  });
});

describe("resolveTool", () => {
  it("finds the connector and tool", () => {
    expect(resolveTool([CAL], CREATE)?.tool.name).toBe("create_event");
  });

  it("returns null for an unknown connector or tool", () => {
    expect(resolveTool([CAL], namespacedToolName("ghost", "x"))).toBeNull();
    expect(resolveTool([CAL], namespacedToolName("calendar", "ghost"))).toBeNull();
    expect(resolveTool([CAL], "web_search")).toBeNull();
  });
});

describe("runMcpTool — the gate", () => {
  const invoke = vi.fn(async () => ({ content: "done", isError: false }));

  function deps(over: Partial<Parameters<typeof runMcpTool>[2]> = {}) {
    return {
      connectors: [CAL],
      requestApproval: vi.fn(async () => true),
      invoke,
      ...over,
    };
  }

  it("asks before invoking, and invokes once approved", async () => {
    const d = deps();
    const r = await runMcpTool(CREATE, '{"title":"x"}', d);
    expect(d.requestApproval).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalled();
    expect(r.content).toBe("done");
  });

  it("does not invoke when the user declines", async () => {
    invoke.mockClear();
    const d = deps({ requestApproval: vi.fn(async () => false) });
    const r = await runMcpTool(CREATE, "{}", d);
    expect(invoke).not.toHaveBeenCalled();
    expect(r.isError).toBe(true);
    expect(r.content).toContain("declined");
  });

  it("tells the model not to retry a declined call", async () => {
    expect(deniedResult(CREATE).content).toContain("Do not retry");
  });

  it("skips the prompt for a remembered always", async () => {
    const d = deps({ connectors: [{ ...CAL, approvals: { [CREATE]: "always" } }] });
    await runMcpTool(CREATE, "{}", d);
    expect(d.requestApproval).not.toHaveBeenCalled();
  });

  it("refuses a remembered never without prompting or invoking", async () => {
    invoke.mockClear();
    const d = deps({ connectors: [{ ...CAL, approvals: { [CREATE]: "never" } }] });
    const r = await runMcpTool(CREATE, "{}", d);
    expect(d.requestApproval).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(r.isError).toBe(true);
  });

  // The ordering that makes the gate a gate: nothing reaches the network without
  // passing it, and a malformed argument cannot short-circuit past it.
  it("checks approval BEFORE parsing arguments", async () => {
    invoke.mockClear();
    const d = deps({ requestApproval: vi.fn(async () => false) });
    const r = await runMcpTool(CREATE, "{not json", d);
    expect(d.requestApproval).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
    // Denial, not a parse error — the user's refusal is the outcome that matters.
    expect(r.content).toContain("declined");
  });

  it("reports malformed arguments only after approval", async () => {
    invoke.mockClear();
    const r = await runMcpTool(CREATE, "{not json", deps());
    expect(invoke).not.toHaveBeenCalled();
    expect(r.content).toContain("not valid JSON");
  });

  it("hands the user enough to judge the call", async () => {
    const seen: PendingApproval[] = [];
    const requestApproval = vi.fn(async (p: PendingApproval) => {
      seen.push(p);
      return true;
    });
    await runMcpTool(DELETE, '{"id":"work"}', deps({ requestApproval }));
    const pending = seen[0];
    expect(pending).toMatchObject({
      connectorName: "Calendar",
      tool: "delete_calendar",
      description: "Delete an entire calendar.",
    });
    expect(pending.args).toContain('"id": "work"');
  });

  // The server's own claim may inform the prompt but must never decide.
  it("still asks for a tool the server calls read-only", async () => {
    const readOnly: BridgeConnector = {
      ...CAL,
      tools: [{ ...CAL.tools[0], annotations: { readOnlyHint: true } }],
    };
    const d = deps({ connectors: [readOnly] });
    await runMcpTool(CREATE, "{}", d);
    expect(d.requestApproval).toHaveBeenCalledOnce();
  });

  it("reports an unknown tool without invoking", async () => {
    invoke.mockClear();
    const r = await runMcpTool(namespacedToolName("ghost", "x"), "{}", deps());
    expect(r.isError).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses a disabled connector", async () => {
    invoke.mockClear();
    const d = deps({ connectors: [{ ...CAL, enabled: false }] });
    const r = await runMcpTool(CREATE, "{}", d);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("disabled");
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("connectorsIndexBlock", () => {
  it("is empty with nothing connected", () => {
    expect(connectorsIndexBlock([])).toBe("");
    expect(connectorsIndexBlock([{ ...CAL, tools: [] }])).toBe("");
  });

  it("names services and warns the model these act on real accounts", () => {
    const block = connectorsIndexBlock([CAL]);
    expect(block).toContain("Calendar");
    expect(block).toContain("real accounts");
  });

  it("excludes a disabled connector", () => {
    expect(connectorsIndexBlock([{ ...CAL, enabled: false }])).toBe("");
  });
});
