import { describe, expect, it, vi, beforeEach } from "vitest";
import type { WireEvent } from "@/lib/chat/tool-loop";

const postSSEMock = vi.fn();
vi.mock("@/lib/sse-client", () => ({
  postSSE: (...args: unknown[]) => postSSEMock(...args),
}));

// Imported after the mock so `session.ts` picks up the mocked module.
const { runSessionTurn, DEFAULT_ORCHESTRA_BUDGET_USD } = await import("./session");

interface FakeBody {
  messages: { role: string; content: unknown }[];
  tools?: { function: { name: string } }[];
}

async function* events(evs: WireEvent[]) {
  for (const e of evs) yield e;
}

/**
 * `spawn_subagents` is a shared tool: `chat-client.tsx` and this module both
 * supply the port that runs it, so the fixture has to tell an outer-turn call
 * apart from a sub-agent's own call by content, not by call order — `fanOut`
 * starts sub-agents concurrently, and nothing here should depend on which of
 * them the fake transport happens to service first.
 */
function scriptedTransport(spawnArgs: string) {
  postSSEMock.mockImplementation((_url: string, body: FakeBody) => {
    const sys = typeof body.messages[0]?.content === "string" ? body.messages[0].content : "";
    const hasToolResult = body.messages.some((m) => m.role === "tool");
    if (sys.startsWith("You are Atlas") && !hasToolResult) {
      return events([
        { type: "tool_call", id: "call_1", name: "spawn_subagents", arguments: spawnArgs },
        { type: "done", finishReason: "tool_calls" },
      ]);
    }
    if (sys.startsWith("You are Atlas") && hasToolResult) {
      return events([
        { type: "delta", text: "Both angles are in." },
        { type: "done", finishReason: "stop" },
      ]);
    }
    // A sub-agent's own turn: its system message is the role's prompt, not
    // `SESSION_SYSTEM`.
    return events([
      { type: "delta", text: "sub-agent finding" },
      { type: "done", finishReason: "stop" },
    ]);
  });
}

describe("runSessionTurn — sub-agent fan-out", () => {
  beforeEach(() => {
    postSSEMock.mockReset();
  });

  it("runs a real fan-out through lib/orchestra/run.ts and reports it via onRun", async () => {
    scriptedTransport(
      JSON.stringify({
        tasks: [
          { title: "graph angle", instruction: "what connects to model X" },
          { title: "cost angle", instruction: "what does model X cost" },
        ],
      }),
    );

    const runs: { status: string; events: number }[] = [];
    const result = await runSessionTurn(
      { modelId: "gpt-oss-120b", question: "investigate model X from two angles" },
      { onRun: (r) => runs.push({ status: r.status, events: r.events.length }), onApproval: () => true },
    );

    expect(result.errored).toBe(false);
    expect(result.run).not.toBeNull();
    expect(result.run?.status).toBe("done");
    // Two agents actually ran, not zero — the whole point of the wiring.
    expect(result.run?.events.filter((e) => e.kind === "agent_start")).toHaveLength(2);
    expect(result.run?.events.filter((e) => e.kind === "agent_end")).toHaveLength(2);
    // The dock observed live progress, not just a final snapshot.
    expect(runs.length).toBeGreaterThan(1);
    expect(result.content).toContain("Both angles are in.");
  });

  it("assigns roles round-robin, never a role the turn's tools cannot support", async () => {
    scriptedTransport(
      JSON.stringify({
        tasks: [{ title: "a", instruction: "a" }, { title: "b", instruction: "b" }, { title: "c", instruction: "c" }],
      }),
    );

    const result = await runSessionTurn(
      { modelId: "gpt-oss-120b", question: "three angles" },
      { onApproval: () => true },
    );
    const roles = result.run?.events.filter((e) => e.kind === "agent_start").map((e) => e.role);
    expect(roles).toBeDefined();
    // Every assigned role must be able to reach at least one of the four
    // default Atlas read tools this turn actually offers.
    for (const r of roles!) expect(["cartographer", "scout", "analyst", "critic"]).toContain(r);
  });

  it("does not offer spawn_subagents when no role would have anything to do", async () => {
    postSSEMock.mockImplementation((_url: string, body: FakeBody) => {
      // A turn with every optional surface off, including Atlas's own tools,
      // should never even offer the fan-out (nor any tool at all, here).
      expect(body.tools?.some((t) => t.function.name === "spawn_subagents") ?? false).toBe(false);
      return events([{ type: "delta", text: "no tools needed" }, { type: "done", finishReason: "stop" }]);
    });

    const result = await runSessionTurn({
      modelId: "gpt-oss-120b",
      question: "hello",
      availability: { atlasTools: false },
    });

    expect(result.run).toBeNull();
    expect(postSSEMock).toHaveBeenCalledTimes(1);
  });

  it("respects a caller's own budget ceiling", async () => {
    scriptedTransport(JSON.stringify({ tasks: [{ title: "a", instruction: "a" }] }));

    const result = await runSessionTurn(
      { modelId: "gpt-oss-120b", question: "one angle, tiny budget", subagentsBudgetUsd: 0.5 },
      { onApproval: () => true },
    );
    expect(result.run).not.toBeNull();

    // Sanity: the exported default is the one actually used when unset.
    expect(DEFAULT_ORCHESTRA_BUDGET_USD).toBeGreaterThan(0.3);
  });

  it("fails closed: a spend-classed tool never runs without an approval hook", async () => {
    scriptedTransport(JSON.stringify({ tasks: [{ title: "a", instruction: "a" }] }));

    // No `onApproval` supplied at all - the default for a surface with no way
    // to ask the user anything.
    const result = await runSessionTurn({ modelId: "gpt-oss-120b", question: "one angle" });

    // The model's tool call ran, but `spawn_subagents` itself refused rather
    // than silently spending: no agents actually started, and refusing a
    // tool call is not a turn error - the model gets the refusal as a tool
    // result and answers with what it has, exactly like any other tool error.
    expect(result.run).toBeNull();
    expect(result.errored).toBe(false);
  });

  it("fails closed: a decline through onApproval is honoured, not overridden", async () => {
    scriptedTransport(JSON.stringify({ tasks: [{ title: "a", instruction: "a" }] }));
    const approvals: string[] = [];

    const result = await runSessionTurn(
      { modelId: "gpt-oss-120b", question: "one angle" },
      {
        onApproval: ({ name }) => {
          approvals.push(name);
          return false;
        },
      },
    );

    expect(approvals).toEqual(["spawn_subagents"]);
    expect(result.run).toBeNull();
  });
});
