import { describe, expect, it } from "vitest";
import {
  buildAnthropicBody,
  endpointFor,
  newFrameState,
  normalizeFrame,
  protocolHeaders,
  toAnthropicMessages,
} from "./protocol";
import type { ChatMessage, StreamParams } from "./index";

// Anthropic is the only upstream that is not OpenAI-shaped. Rather than give the
// streaming loop a second control flow, frames are rewritten into the OpenAI
// chunk shape before the parser sees them — so these tests are really asserting
// that the loop can stay ignorant.

const route = { provider: "anthropic" as const, model: "claude-sonnet-4-6" };
const params = (over: Partial<StreamParams> = {}): StreamParams =>
  ({ modelId: "claude-sonnet-4-6", messages: [], ...over }) as StreamParams;

/** Feed a frame and get the parsed OpenAI chunk back. */
function frame(f: unknown, state = newFrameState()) {
  const out = normalizeFrame("anthropic", JSON.stringify(f), state);
  return out === null || out === "[DONE]" ? out : JSON.parse(out);
}

describe("endpointFor / protocolHeaders", () => {
  it("routes each protocol to its own endpoint", () => {
    expect(endpointFor("openai", "https://x/v1")).toBe("https://x/v1/chat/completions");
    expect(endpointFor("anthropic", "https://x/v1")).toBe("https://x/v1/messages");
  });

  it("accepts an Anthropic base URL written with or without /v1", () => {
    // `ANTHROPIC_BASE_URL` is a well-known variable that the Anthropic SDK and
    // Claude Code already set, usually to the bare root. Atlas resolves base
    // URLs from `${ID}_BASE_URL`, so that setting silently becomes Atlas's —
    // observed live, producing `https://api.anthropic.com/messages` and a 404.
    for (const base of [
      "https://api.anthropic.com",
      "https://api.anthropic.com/",
      "https://api.anthropic.com/v1",
      "https://api.anthropic.com/v1/",
    ]) {
      expect(endpointFor("anthropic", base)).toBe("https://api.anthropic.com/v1/messages");
    }
  });

  it("authenticates Anthropic with x-api-key, not a bearer token", () => {
    // Sending `Authorization: Bearer` to Anthropic is a 401, and sending
    // `x-api-key` to everyone else is too — hence the split.
    expect(protocolHeaders("anthropic", "sk-ant-abc")).toEqual({
      "x-api-key": "sk-ant-abc",
      "anthropic-version": "2023-06-01",
    });
    expect(protocolHeaders("openai", "sk-abc")).toEqual({ Authorization: "Bearer sk-abc" });
  });
});

describe("normalizeFrame on the OpenAI path", () => {
  it("is the identity function", () => {
    // The guarantee that adding Anthropic could not perturb any existing model.
    const state = newFrameState();
    const data = '{"choices":[{"delta":{"content":"hi"}}]}';
    expect(normalizeFrame("openai", data, state)).toBe(data);
    expect(normalizeFrame("openai", "[DONE]", state)).toBe("[DONE]");
    expect(normalizeFrame("openai", "not json", state)).toBe("not json");
  });
});

describe("normalizeFrame on the Anthropic path", () => {
  it("maps text deltas to OpenAI content", () => {
    expect(frame({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } }))
      .toEqual({ choices: [{ delta: { content: "Hi" } }] });
  });

  it("maps thinking deltas onto the separate reasoning stream", () => {
    // The loop already reads `reasoning_content` as its own stream, so extended
    // thinking lands where DeepSeek R1 and the o-series already land.
    expect(
      frame({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } }),
    ).toEqual({ choices: [{ delta: { reasoning_content: "hmm" } }] });
  });

  it("drops keepalives and structural frames", () => {
    expect(frame({ type: "ping" })).toBeNull();
    expect(frame({ type: "content_block_stop", index: 0 })).toBeNull();
    expect(frame({ type: "unknown_future_frame" })).toBeNull();
  });

  it("synthesises [DONE], which Anthropic never sends", () => {
    // Without this the loop would terminate by the body running out rather than
    // through its normal path.
    expect(frame({ type: "message_stop" })).toBe("[DONE]");
  });

  it("surfaces a mid-stream error in the shape the loop already handles", () => {
    expect(frame({ type: "error", error: { message: "overloaded" } })).toEqual({
      error: { message: "overloaded" },
    });
  });

  it("reports prompt and completion tokens from the two frames that carry them", () => {
    expect(frame({ type: "message_start", message: { usage: { input_tokens: 12 } } })).toEqual({
      choices: [{ delta: {} }],
      usage: { prompt_tokens: 12 },
    });
    expect(frame({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }))
      .toEqual({
        choices: [{ delta: {}, finish_reason: "end_turn" }],
        usage: { completion_tokens: 5 },
      });
  });

  // THE case the cross-frame state exists for: a block's identity arrives once,
  // and every later fragment is anonymous.
  it("carries a tool call's id and name across its argument fragments", () => {
    const state = newFrameState();
    const start = frame(
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "toolu_1", name: "search" },
      },
      state,
    );
    expect(start.choices[0].delta.tool_calls[0]).toEqual({
      index: 1,
      id: "toolu_1",
      function: { name: "search", arguments: "" },
    });

    const frag = frame(
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"q":' } },
      state,
    );
    // The fragment itself names neither the call nor the tool; without the
    // remembered block it would accumulate onto an anonymous entry.
    expect(frag.choices[0].delta.tool_calls[0]).toEqual({
      index: 1,
      id: "toolu_1",
      function: { name: "search", arguments: '{"q":' },
    });
  });

  it("lets a partial JSON payload through for the parser's own catch", () => {
    const state = newFrameState();
    expect(normalizeFrame("anthropic", '{"type":"content_bl', state)).toBe('{"type":"content_bl');
  });
});

describe("toAnthropicMessages", () => {
  it("lifts system messages into the top-level field", () => {
    const { system, messages } = toAnthropicMessages([
      { role: "system", content: "Be terse." },
      { role: "user", content: "Hi" },
    ] as ChatMessage[]);
    expect(system).toBe("Be terse.");
    expect(messages).toEqual([{ role: "user", content: [{ type: "text", text: "Hi" }] }]);
  });

  it("turns tool results into user messages carrying tool_result blocks", () => {
    const { messages } = toAnthropicMessages([
      { role: "tool", tool_call_id: "toolu_1", content: "42" },
    ] as ChatMessage[]);
    expect(messages).toEqual([
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "42" }] },
    ]);
  });

  it("merges consecutive same-role messages", () => {
    // Anthropic rejects a conversation whose roles do not alternate, and two
    // tool results in a row is the ordinary way to produce that.
    const { messages } = toAnthropicMessages([
      { role: "tool", tool_call_id: "a", content: "1" },
      { role: "tool", tool_call_id: "b", content: "2" },
    ] as ChatMessage[]);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toHaveLength(2);
  });

  it("converts assistant tool_calls into tool_use blocks with parsed input", () => {
    const { messages } = toAnthropicMessages([
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "toolu_1", type: "function", function: { name: "search", arguments: '{"q":"x"}' } },
        ],
      },
    ] as ChatMessage[]);
    expect(messages[0].content).toEqual([
      { type: "tool_use", id: "toolu_1", name: "search", input: { q: "x" } },
    ]);
  });

  it("does not fail a turn over half-streamed tool arguments", () => {
    const { messages } = toAnthropicMessages([
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "t", type: "function", function: { name: "s", arguments: '{"q":' } }],
      },
    ] as ChatMessage[]);
    expect(messages[0].content[0]).toMatchObject({ type: "tool_use", input: {} });
  });
});

describe("buildAnthropicBody", () => {
  it("always sends max_tokens, which the API requires", () => {
    // OpenAI treats it as optional, so a body built from the same params would
    // otherwise be rejected outright.
    expect(buildAnthropicBody(route, params()).max_tokens).toBe(4096);
    expect(buildAnthropicBody(route, params({ maxTokens: 100 })).max_tokens).toBe(100);
  });

  it("renames stop to stop_sequences", () => {
    expect(buildAnthropicBody(route, params({ stop: ["END"] })).stop_sequences).toEqual(["END"]);
  });

  it("reshapes tools into Anthropic's input_schema form", () => {
    const body = buildAnthropicBody(
      route,
      params({
        tools: [
          {
            type: "function",
            function: { name: "search", description: "d", parameters: { type: "object" } },
          },
        ],
      }),
    );
    expect(body.tools).toEqual([
      { name: "search", description: "d", input_schema: { type: "object" } },
    ]);
  });

  it("omits tools when asked, for the retry-without-tools path", () => {
    const body = buildAnthropicBody(
      route,
      params({ tools: [{ type: "function", function: { name: "s" } }] }),
      true,
    );
    expect(body.tools).toBeUndefined();
  });
});
