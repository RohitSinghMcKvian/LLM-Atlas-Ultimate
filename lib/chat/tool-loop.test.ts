import { describe, it, expect, vi } from "vitest";
import { runToolLoop, type LoopMessage, type WireEvent } from "./tool-loop";
import type { ToolDef } from "@/lib/router";
import type { ToolResult } from "./tools";
import { DEFAULT_TRIM, isStub, trimToolTranscript } from "./transcript-trim";

const DEFS: ToolDef[] = [
  { type: "function", function: { name: "web_search", description: "d", parameters: {} } },
];

const START: LoopMessage[] = [
  { role: "system", content: "sys" },
  { role: "user", content: "hi" },
];

/** Turn arrays of events into the async iterables the loop consumes. */
function scriptedStream(rounds: WireEvent[][]) {
  const seen: { messages: LoopMessage[]; tools?: ToolDef[] }[] = [];
  let i = 0;
  const stream = (messages: LoopMessage[], tools?: ToolDef[]) => {
    // Snapshot: the loop mutates its own array between rounds.
    seen.push({ messages: JSON.parse(JSON.stringify(messages)), tools });
    const events = rounds[Math.min(i, rounds.length - 1)] ?? [];
    i++;
    return (async function* () {
      for (const e of events) yield e;
    })();
  };
  return { stream, seen, get calls() { return i; } };
}

const ok = (content: string, sources?: ToolResult["sources"]): ToolResult => ({ content, sources });

describe("no tools offered", () => {
  it("streams once and returns the text", async () => {
    const s = scriptedStream([[{ type: "delta", text: "hello " }, { type: "delta", text: "world" }]]);
    const r = await runToolLoop(START, { stream: s.stream, runTool: vi.fn(), toolDefs: [] });
    expect(r.content).toBe("hello world");
    expect(r.rounds).toBe(0);
    expect(s.calls).toBe(1);
  });

  it("passes undefined for tools when the registry is empty", async () => {
    const s = scriptedStream([[{ type: "delta", text: "x" }]]);
    await runToolLoop(START, { stream: s.stream, runTool: vi.fn(), toolDefs: [] });
    expect(s.seen[0].tools).toBeUndefined();
  });

  it("never calls a tool even if the model asks", async () => {
    const s = scriptedStream([[{ type: "tool_call", id: "1", name: "web_search", arguments: "{}" }]]);
    const runTool = vi.fn();
    const r = await runToolLoop(START, { stream: s.stream, runTool, toolDefs: [] });
    expect(runTool).not.toHaveBeenCalled();
    expect(r.rounds).toBe(0);
  });
});

describe("single tool round", () => {
  const script: WireEvent[][] = [
    [
      { type: "delta", text: "Let me look that up. " },
      { type: "tool_call", id: "c1", name: "web_search", arguments: '{"search_query":"atlas"}' },
    ],
    [{ type: "delta", text: "The answer is 42." }],
  ];

  it("executes the tool and streams a second time", async () => {
    const s = scriptedStream(script);
    const runTool = vi.fn(async () => ok("result body"));
    const r = await runToolLoop(START, { stream: s.stream, runTool, toolDefs: DEFS });
    // The call id travels with the arguments so a streaming tool's output can
    // be routed to the right step in the UI rather than to the turn at large.
    expect(runTool).toHaveBeenCalledWith(
      "web_search",
      '{"search_query":"atlas"}',
      expect.any(String),
    );
    expect(s.calls).toBe(2);
    expect(r.rounds).toBe(1);
  });

  // The preamble is narration of the research, not part of the answer.
  it("drops pre-tool preamble from the final content", async () => {
    const s = scriptedStream(script);
    const r = await runToolLoop(START, {
      stream: s.stream,
      runTool: async () => ok("body"),
      toolDefs: DEFS,
    });
    expect(r.content).toBe("The answer is 42.");
    expect(r.content).not.toContain("Let me look that up");
  });

  it("echoes the assistant tool_calls before the tool result", async () => {
    const s = scriptedStream(script);
    await runToolLoop(START, { stream: s.stream, runTool: async () => ok("body"), toolDefs: DEFS });
    const second = s.seen[1].messages;
    const asst = second[second.length - 2];
    const toolMsg = second[second.length - 1];
    expect(asst.role).toBe("assistant");
    expect(asst.tool_calls?.[0]).toMatchObject({
      id: "c1",
      function: { name: "web_search" },
    });
    expect(toolMsg).toMatchObject({ role: "tool", tool_call_id: "c1", content: "body" });
  });

  it("records the result on the stored call for the UI", async () => {
    const s = scriptedStream(script);
    const r = await runToolLoop(START, {
      stream: s.stream,
      runTool: async () => ok("body"),
      toolDefs: DEFS,
    });
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0].result).toBe("body");
  });

  it("collects and de-duplicates sources across rounds", async () => {
    const s = scriptedStream([
      [{ type: "tool_call", id: "a", name: "web_search", arguments: "{}" }],
      [{ type: "tool_call", id: "b", name: "web_search", arguments: "{}" }],
      [{ type: "delta", text: "done" }],
    ]);
    const r = await runToolLoop(START, {
      stream: s.stream,
      runTool: async () =>
        ok("x", [
          { title: "A", url: "https://a.test", snippet: "s" },
          { title: "Dup", url: "https://a.test", snippet: "s" },
        ]),
      toolDefs: DEFS,
    });
    expect(r.sources.map((x) => x.url)).toEqual(["https://a.test"]);
  });
});

describe("parallel calls in one round", () => {
  it("runs every call and appends one tool message each", async () => {
    const s = scriptedStream([
      [
        { type: "tool_call", id: "c1", name: "web_search", arguments: '{"search_query":"a"}' },
        { type: "tool_call", id: "c2", name: "web_search", arguments: '{"search_query":"b"}' },
      ],
      [{ type: "delta", text: "combined" }],
    ]);
    const runTool = vi.fn(async (_n: string, a: string) => ok(`for ${a}`));
    const r = await runToolLoop(START, { stream: s.stream, runTool, toolDefs: DEFS });

    expect(runTool).toHaveBeenCalledTimes(2);
    const second = s.seen[1].messages;
    const toolMsgs = second.filter((m) => m.role === "tool");
    expect(toolMsgs.map((m) => m.tool_call_id)).toEqual(["c1", "c2"]);
    expect(r.toolCalls).toHaveLength(2);
    // One round, even though two tools ran.
    expect(r.rounds).toBe(1);
  });
});

describe("round cap", () => {
  it("stops after maxRounds and withholds tools on the last attempt", async () => {
    // A model that always wants another tool call.
    const always: WireEvent[] = [{ type: "tool_call", id: "x", name: "web_search", arguments: "{}" }];
    const s = scriptedStream([always]);
    const runTool = vi.fn(async () => ok("again"));
    const r = await runToolLoop(
      START,
      { stream: s.stream, runTool, toolDefs: DEFS, maxRounds: 2 },
      {},
    );
    expect(r.rounds).toBe(2);
    expect(runTool).toHaveBeenCalledTimes(2);
    expect(r.hitRoundCap).toBe(true);
    // Rounds 0 and 1 are offered tools; the third (index 2) is not.
    expect(s.seen[0].tools).toBeDefined();
    expect(s.seen[1].tools).toBeDefined();
    expect(s.seen[2].tools).toBeUndefined();
  });

  it("does not flag the cap when the model finishes on its own", async () => {
    const s = scriptedStream([
      [{ type: "tool_call", id: "a", name: "web_search", arguments: "{}" }],
      [{ type: "delta", text: "done" }],
    ]);
    const r = await runToolLoop(START, {
      stream: s.stream,
      runTool: async () => ok("r"),
      toolDefs: DEFS,
      maxRounds: 4,
    });
    expect(r.hitRoundCap).toBe(false);
    expect(r.content).toBe("done");
  });
});

describe("failure paths", () => {
  it("stops on a stream error and reports it", async () => {
    const onError = vi.fn();
    const s = scriptedStream([[{ type: "error", message: "no credit", code: "no_credit" }]]);
    const runTool = vi.fn();
    const r = await runToolLoop(
      START,
      { stream: s.stream, runTool, toolDefs: DEFS },
      { onError },
    );
    expect(r.errored).toBe(true);
    expect(onError).toHaveBeenCalledWith({ message: "no credit", code: "no_credit" });
    expect(runTool).not.toHaveBeenCalled();
  });

  it("does not run tools after an error in the same round", async () => {
    const s = scriptedStream([
      [
        { type: "tool_call", id: "c1", name: "web_search", arguments: "{}" },
        { type: "error", message: "upstream died" },
      ],
    ]);
    const runTool = vi.fn();
    const r = await runToolLoop(START, { stream: s.stream, runTool, toolDefs: DEFS });
    expect(runTool).not.toHaveBeenCalled();
    expect(r.errored).toBe(true);
  });

  it("keeps going when a tool returns an error result", async () => {
    const s = scriptedStream([
      [{ type: "tool_call", id: "c1", name: "web_search", arguments: "{}" }],
      [{ type: "delta", text: "recovered" }],
    ]);
    const r = await runToolLoop(START, {
      stream: s.stream,
      runTool: async () => ({ content: "Tool failed: offline", isError: true }),
      toolDefs: DEFS,
    });
    // A tool failure is information for the model, not a turn-ending error.
    expect(r.errored).toBe(false);
    expect(r.content).toBe("recovered");
    expect(r.toolCalls[0].result).toContain("offline");
  });

  it("propagates an abort out of the loop", async () => {
    const s = scriptedStream([[{ type: "tool_call", id: "c1", name: "web_search", arguments: "{}" }]]);
    await expect(
      runToolLoop(START, {
        stream: s.stream,
        runTool: async () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          throw e;
        },
        toolDefs: DEFS,
      }),
    ).rejects.toThrow(/aborted/);
  });
});

describe("callbacks", () => {
  it("reports accumulated text, reasoning and usage", async () => {
    const onText = vi.fn();
    const onReasoning = vi.fn();
    const onUsage = vi.fn();
    const s = scriptedStream([
      [
        { type: "reasoning", text: "thinking" },
        { type: "delta", text: "a" },
        { type: "delta", text: "b" },
        { type: "usage", promptTokens: 10, completionTokens: 3 },
      ],
    ]);
    await runToolLoop(
      START,
      { stream: s.stream, runTool: vi.fn(), toolDefs: [] },
      { onText, onReasoning, onUsage },
    );
    // Accumulated, not incremental — the caller renders the whole string.
    expect(onText).toHaveBeenNthCalledWith(1, "a");
    expect(onText).toHaveBeenNthCalledWith(2, "ab");
    expect(onReasoning).toHaveBeenCalledWith("thinking");
    expect(onUsage).toHaveBeenCalledWith({ promptTokens: 10, completionTokens: 3 });
  });

  it("clears displayed text when preamble is discarded", async () => {
    const onText = vi.fn();
    const s = scriptedStream([
      [
        { type: "delta", text: "searching..." },
        { type: "tool_call", id: "c1", name: "web_search", arguments: "{}" },
      ],
      [{ type: "delta", text: "final" }],
    ]);
    await runToolLoop(
      START,
      { stream: s.stream, runTool: async () => ok("r"), toolDefs: DEFS },
      { onText },
    );
    expect(onText.mock.calls.map((c) => c[0])).toEqual(["searching...", "", "final"]);
  });

  it("does not mutate the caller's message array", async () => {
    const s = scriptedStream([
      [{ type: "tool_call", id: "c1", name: "web_search", arguments: "{}" }],
      [{ type: "delta", text: "done" }],
    ]);
    const start: LoopMessage[] = [...START];
    await runToolLoop(start, { stream: s.stream, runTool: async () => ok("r"), toolDefs: DEFS });
    expect(start).toHaveLength(2);
  });
});

// A landing page is 400–900 lines and providers stop at their output limit. The
// loop used to ignore `finish_reason` entirely, so the fragment was presented as
// a finished answer — and because it ended mid-fence, no artifact was detected.
describe("image output", () => {
  const A = "data:image/png;base64,AAAA";
  const B = "data:image/png;base64,BBBB";

  it("collects images in order and reports them live", async () => {
    const s = scriptedStream([
      [
        { type: "image", url: A, mime: "image/png" },
        { type: "delta", text: "here it is" },
        { type: "image", url: B, mime: "image/png" },
      ],
    ]);
    const onImages = vi.fn();
    const r = await runToolLoop(
      START,
      { stream: s.stream, runTool: vi.fn(), toolDefs: [] },
      { onImages },
    );
    expect(r.images.map((i) => i.url)).toEqual([A, B]);
    expect(r.content).toBe("here it is");
    // Painted as they arrive: an image model often sends the picture first.
    expect(onImages).toHaveBeenCalledTimes(2);
    expect(onImages.mock.calls[0][0]).toHaveLength(1);
  });

  it("de-duplicates an image repeated across a resume", async () => {
    // A resumed turn re-sends the whole message, images included.
    const s = scriptedStream([
      [{ type: "image", url: A }, { type: "delta", text: "one" }, { type: "done", finishReason: "length" }],
      [{ type: "image", url: A }, { type: "delta", text: " two" }, { type: "done", finishReason: "stop" }],
    ]);
    const r = await runToolLoop(START, { stream: s.stream, runTool: vi.fn(), toolDefs: [] });
    expect(r.images).toHaveLength(1);
  });

  it("returns an empty list for a text turn", async () => {
    const s = scriptedStream([[{ type: "delta", text: "x" }]]);
    const r = await runToolLoop(START, { stream: s.stream, runTool: vi.fn(), toolDefs: [] });
    expect(r.images).toEqual([]);
  });

  it("re-validates the URL instead of trusting the wire event", async () => {
    // The image lands in an <img src> AND in the download button's <a href>,
    // where a javascript: URL executes. Validating only in the router would
    // put the whole allowlist behind one hop.
    const s = scriptedStream([
      [
        { type: "image", url: "javascript:alert(1)" },
        { type: "image", url: "data:text/html;base64,PHNjcmlwdD4=" },
        { type: "image", url: "http://cdn.example/i.png" },
        { type: "image", url: A },
      ],
    ]);
    const r = await runToolLoop(START, { stream: s.stream, runTool: vi.fn(), toolDefs: [] });
    expect(r.images.map((i) => i.url)).toEqual([A]);
  });
});

describe("truncated answers", () => {
  it("resumes a length-truncated answer and joins the halves", async () => {
    const s = scriptedStream([
      [{ type: "delta", text: "<div cla" }, { type: "done", finishReason: "length" }],
      [{ type: "delta", text: 'ss="hero">' }, { type: "done", finishReason: "stop" }],
    ]);
    const r = await runToolLoop(START, { stream: s.stream, runTool: vi.fn(), toolDefs: [] });
    expect(r.content).toBe('<div class="hero">');
    expect(r.continuations).toBe(1);
    expect(r.truncated).toBe(false);
  });

  it("sends the partial answer back as context with a resume instruction", async () => {
    const s = scriptedStream([
      [{ type: "delta", text: "part one" }, { type: "done", finishReason: "length" }],
      [{ type: "delta", text: " and two" }, { type: "done", finishReason: "stop" }],
    ]);
    await runToolLoop(START, { stream: s.stream, runTool: vi.fn(), toolDefs: [] });
    const second = s.seen[1].messages;
    expect(second).toHaveLength(4);
    expect(second[2]).toEqual({ role: "assistant", content: "part one" });
    expect(String(second[3].content)).toContain("hit the output limit");
  });

  it("keeps the resume exchange out of the permanent history", async () => {
    const s = scriptedStream([
      [{ type: "delta", text: "a" }, { type: "done", finishReason: "length" }],
      [
        { type: "delta", text: "b" },
        { type: "tool_call", id: "c1", name: "web_search", arguments: "{}" },
      ],
      [{ type: "delta", text: "final" }],
    ]);
    await runToolLoop(START, { stream: s.stream, runTool: async () => ok("r"), toolDefs: DEFS });
    // The third stream sees the original two messages, the model's tool request
    // and the tool result — not the resume scaffolding from the first round.
    const third = s.seen[2].messages;
    expect(third.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
  });

  it("stops at the cap and reports the answer as still truncated", async () => {
    const s = scriptedStream([[{ type: "delta", text: "x" }, { type: "done", finishReason: "length" }]]);
    const r = await runToolLoop(START, { stream: s.stream, runTool: vi.fn(), toolDefs: [] });
    expect(r.continuations).toBe(3);
    expect(r.truncated).toBe(true);
    expect(s.calls).toBe(4); // the first attempt plus three resumes
  });

  it("can be disabled", async () => {
    const s = scriptedStream([[{ type: "delta", text: "x" }, { type: "done", finishReason: "length" }]]);
    const r = await runToolLoop(START, {
      stream: s.stream,
      runTool: vi.fn(),
      toolDefs: [],
      maxContinuations: 0,
    });
    expect(s.calls).toBe(1);
    expect(r.truncated).toBe(true);
  });

  // Half a JSON argument object cannot be resumed into a valid call, so the
  // tool round takes priority over the continuation.
  it("does not resume when the round asked for a tool", async () => {
    const s = scriptedStream([
      [
        { type: "tool_call", id: "c1", name: "web_search", arguments: "{}" },
        { type: "done", finishReason: "length" },
      ],
      [{ type: "delta", text: "answer" }],
    ]);
    const r = await runToolLoop(START, {
      stream: s.stream,
      runTool: async () => ok("r"),
      toolDefs: DEFS,
    });
    expect(r.continuations).toBe(0);
    expect(r.content).toBe("answer");
  });

  it("reports each resume attempt to the caller", async () => {
    const onContinue = vi.fn();
    const s = scriptedStream([
      [{ type: "delta", text: "a" }, { type: "done", finishReason: "length" }],
      [{ type: "delta", text: "b" }, { type: "done", finishReason: "length" }],
      [{ type: "delta", text: "c" }, { type: "done", finishReason: "stop" }],
    ]);
    await runToolLoop(START, { stream: s.stream, runTool: vi.fn(), toolDefs: [] }, { onContinue });
    expect(onContinue.mock.calls).toEqual([[1, 3], [2, 3]]);
  });
});

/**
 * Transcript trimming.
 *
 * The loop appends every round's tool call and result to one array and re-sends
 * all of it every round, so round fifteen carries rounds one to fourteen in
 * full. That is the real ceiling on how long a build can run.
 */
describe("trimTranscript", () => {
  /** N rounds of a tool that returns a large result, then an answer. */
  function bigRounds(n: number, resultChars: number) {
    const script: WireEvent[][] = [];
    for (let i = 0; i < n; i++) {
      script.push([{ type: "tool_call", id: `c${i}`, name: "workspace", arguments: "{}" }]);
    }
    script.push([{ type: "delta", text: "done" }]);
    return {
      script,
      runTool: async () => ok(`Created /workspace/f.html\n${"x".repeat(resultChars)}`),
    };
  }

  it("keeps a long build's request under the ceiling", async () => {
    const { script, runTool } = bigRounds(15, 8_000);
    const s = scriptedStream(script);
    await runToolLoop(START, {
      stream: s.stream,
      runTool,
      toolDefs: DEFS,
      maxRounds: 20,
      trimTranscript: (convo, boundary) => trimToolTranscript(convo, boundary),
    });

    const last = s.seen[s.seen.length - 1].messages;
    const chars = last.reduce(
      (n, m) => n + (typeof m.content === "string" ? m.content.length : 0),
      0,
    );
    expect(chars).toBeLessThanOrEqual(DEFAULT_TRIM.maxTotalChars);
  });

  // Untrimmed behaviour must be byte-identical, which is why the dep is optional.
  it("changes nothing when no policy is given", async () => {
    const { script, runTool } = bigRounds(6, 5_000);
    const withOut = scriptedStream(script.map((r) => [...r]));
    await runToolLoop(START, { stream: withOut.stream, runTool, toolDefs: DEFS, maxRounds: 20 });
    const last = withOut.seen[withOut.seen.length - 1].messages;
    expect(last.filter((m) => m.role === "tool").every((m) => !isStub(m.content))).toBe(true);
  });

  it("reports the request size every round", async () => {
    const { script, runTool } = bigRounds(4, 2_000);
    const s = scriptedStream(script);
    const sizes: number[] = [];
    await runToolLoop(
      START,
      { stream: s.stream, runTool, toolDefs: DEFS, maxRounds: 20 },
      { onContextGrowth: (n) => sizes.push(n) },
    );
    expect(sizes.length).toBeGreaterThan(1);
    expect(sizes[sizes.length - 1]).toBeGreaterThan(sizes[0]);
  });

  // The pairing rule, end to end: a provider rejects an orphaned tool result.
  it("never leaves a tool result without its call", async () => {
    const { script, runTool } = bigRounds(15, 8_000);
    const s = scriptedStream(script);
    await runToolLoop(START, {
      stream: s.stream,
      runTool,
      toolDefs: DEFS,
      maxRounds: 20,
      trimTranscript: (convo, boundary) => trimToolTranscript(convo, boundary),
    });

    const last = s.seen[s.seen.length - 1].messages;
    const callIds = new Set(last.flatMap((m) => (m.tool_calls ?? []).map((c) => c.id)));
    for (const m of last) {
      if (m.role === "tool") expect(callIds.has(m.tool_call_id!)).toBe(true);
    }
  });
});

/**
 * The budget hook.
 *
 * The loop cannot judge wall-clock, money or "is this build going anywhere", so
 * it asks. What it owns is the shape of the stop: tools are withheld for one
 * final round rather than the turn being cut off mid-thought, so the model gets
 * a chance to answer with what it has.
 */
describe("shouldStop", () => {
  const toolThenAnswer: WireEvent[][] = [
    [{ type: "tool_call", id: "1", name: "web_search", arguments: "{}" }],
    [{ type: "tool_call", id: "2", name: "web_search", arguments: "{}" }],
    [{ type: "delta", text: "final answer" }],
  ];

  it("does not interfere while it returns null", async () => {
    const s = scriptedStream(toolThenAnswer);
    const r = await runToolLoop(START, {
      stream: s.stream,
      runTool: async () => ok("result"),
      toolDefs: DEFS,
      shouldStop: () => null,
    });
    expect(r.stoppedBy).toBeUndefined();
    expect(r.content).toBe("final answer");
    expect(r.rounds).toBe(2);
  });

  it("is not consulted before the first round, so a turn always runs once", async () => {
    const s = scriptedStream([[{ type: "delta", text: "answered" }]]);
    const shouldStop = vi.fn(() => ({ reason: "rounds", message: "stop now" }));
    const r = await runToolLoop(START, {
      stream: s.stream,
      runTool: vi.fn(),
      toolDefs: DEFS,
      shouldStop,
    });
    expect(shouldStop).not.toHaveBeenCalled();
    expect(r.content).toBe("answered");
  });

  it("withholds tools and reports the reason once it fires", async () => {
    const s = scriptedStream(toolThenAnswer);
    let rounds = 0;
    const r = await runToolLoop(START, {
      stream: s.stream,
      runTool: async () => {
        rounds++;
        return ok("result");
      },
      toolDefs: DEFS,
      shouldStop: () =>
        rounds >= 1 ? { reason: "cost", message: "Stopped at the budget." } : null,
    });
    expect(r.stoppedBy).toBe("Stopped at the budget.");
    // The machine-readable reason travels with the prose, because the UI has to
    // offer a different control for a cost ceiling than for a round cap.
    expect(r.stopReason).toBe("cost");
    // Round 2 ran with no tools offered, so the model had to answer.
    expect(s.seen[1].tools).toBeUndefined();
    expect(rounds).toBe(1);
  });

  it("reports each completed round's calls, so the caller can judge progress", async () => {
    const s = scriptedStream(toolThenAnswer);
    const seen: string[][] = [];
    await runToolLoop(
      START,
      { stream: s.stream, runTool: async () => ok("r"), toolDefs: DEFS },
      { onRoundComplete: (calls) => seen.push(calls.map((c) => c.name)) },
    );
    expect(seen).toEqual([["web_search"], ["web_search"]]);
  });
});

/**
 * A stall is not a finished answer.
 *
 * Observed live on Nemotron 3 Ultra: the model streamed reasoning, went quiet
 * while composing the next step, the router's idle timeout ended the stream as
 * `stalled`, and the loop returned an empty answer that looked exactly like a
 * model with nothing to say. `shouldContinue` declines to resume a stall, which
 * is right — but nothing else noticed it either.
 */
describe("a stalled stream", () => {
  it("is reported rather than passed off as a finished answer", async () => {
    const s = scriptedStream([[{ type: "delta", text: "" }, { type: "done", finishReason: "stalled" }]]);
    const r = await runToolLoop(START, { stream: s.stream, runTool: vi.fn(), toolDefs: DEFS });
    expect(r.stalled).toBe(true);
    // Not truncation: there is nothing to resume and no fragment to stitch.
    expect(r.truncated).toBe(false);
  });

  it("does not burn continuations trying to resume one", async () => {
    const s = scriptedStream([[{ type: "done", finishReason: "stalled" }]]);
    const r = await runToolLoop(START, { stream: s.stream, runTool: vi.fn(), toolDefs: DEFS });
    expect(r.continuations).toBe(0);
    expect(s.calls).toBe(1);
  });

  it("stays false for an ordinary answer", async () => {
    const s = scriptedStream([[{ type: "delta", text: "done" }, { type: "done", finishReason: "stop" }]]);
    const r = await runToolLoop(START, { stream: s.stream, runTool: vi.fn(), toolDefs: DEFS });
    expect(r.stalled).toBe(false);
  });
});
