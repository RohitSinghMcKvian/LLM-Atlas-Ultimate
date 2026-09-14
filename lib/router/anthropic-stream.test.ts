import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeModel, makeSnapshot } from "@/lib/catalog/__fixtures__/snapshots";
import { installSnapshot, resetSnapshot } from "@/lib/catalog/snapshot";
import { streamChatEvents, type RouterEvent, type Usage } from "./index";

import { resetLedgerMemory } from "@/lib/quota";
// End-to-end proof that the protocol seam actually works: a real Anthropic SSE
// body driven through the real `streamChatEvents` loop.
//
// `protocol.test.ts` proves the frame translation in isolation. This proves the
// loop consumes it — that tool accumulation, the reasoning stream, usage and the
// BARREN check all still function when the bytes on the wire were never
// OpenAI-shaped to begin with.

const realFetch = globalThis.fetch;

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= chunks.length) {
        c.close();
        return;
      }
      c.enqueue(enc.encode(chunks[i++]));
    },
  });
}

/** The frame sequence a real Anthropic stream emits for a tool-using turn. */
const ANTHROPIC_FRAMES = [
  'data: {"type":"message_start","message":{"usage":{"input_tokens":11}}}\n\n',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}\n\n',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"weighing"}}\n\n',
  'data: {"type":"content_block_stop","index":0}\n\n',
  'data: {"type":"content_block_start","index":1,"content_block":{"type":"text"}}\n\n',
  'data: {"type":"ping"}\n\n',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":" there"}}\n\n',
  'data: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_9","name":"search"}}\n\n',
  'data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":"}}\n\n',
  'data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"\\"atlas\\"}"}}\n\n',
  'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":7}}\n\n',
  'data: {"type":"message_stop"}\n\n',
];

const claude = makeModel({
  id: "claude-test",
  name: "Claude Test",
  license: "proprietary",
  routes: [{ provider: "anthropic", model: "claude-sonnet-4-6" }],
  pricing: { inputPerM: 3, outputPerM: 15, effectiveFrom: "2026-01-01" },
});

let seen: { url: string; init: RequestInit } | null = null;

beforeEach(() => {
  // The ledger is process-global (see lib/quota/ledger.ts). Without this,
  // spend from earlier tests accumulates and a later one can be refused
  // for quota it never used — OpenRouter's free tier is only 20 rpm.
  resetLedgerMemory();
  resetSnapshot();
  installSnapshot(makeSnapshot([claude]));
  seen = null;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPERATOR_SERVE_PAID;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen = { url: String(url), init };
    return new Response(sseBody(ANTHROPIC_FRAMES), { status: 200 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  resetSnapshot();
});

async function run(): Promise<RouterEvent[]> {
  const out: RouterEvent[] = [];
  const gen = streamChatEvents({
    modelId: "claude-test",
    messages: [
      { role: "system", content: "Be terse." },
      { role: "user", content: "hi" },
    ],
    maxTokens: 256,
    // Also exercises Phase 1: a user's own key for a non-OpenRouter provider.
    userKeys: { anthropic: "sk-ant-test" },
  } as Parameters<typeof streamChatEvents>[0]);
  for await (const ev of gen) out.push(ev);
  return out;
}

describe("streaming a real Anthropic body through the router", () => {
  it("dials /messages with x-api-key rather than a bearer token", async () => {
    await run();
    expect(seen!.url).toBe("https://api.anthropic.com/v1/messages");
    const headers = seen!.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers.Authorization).toBeUndefined();
  });

  it("lifts the system prompt out of messages and always sends max_tokens", async () => {
    await run();
    const body = JSON.parse(seen!.init.body as string);
    expect(body.system).toBe("Be terse.");
    expect(body.messages).toEqual([{ role: "user", content: [{ type: "text", text: "hi" }] }]);
    expect(body.max_tokens).toBe(256);
  });

  it("yields visible text as tokens", async () => {
    const events = await run();
    const text = events.filter((e) => e.type === "token").map((e) => (e as { text: string }).text);
    expect(text.join("")).toBe("Hello there");
  });

  it("routes extended thinking onto the reasoning stream, not the transcript", async () => {
    const events = await run();
    const reasoning = events.filter((e) => e.type === "reasoning");
    expect(reasoning).toHaveLength(1);
    expect((reasoning[0] as { text: string }).text).toBe("weighing");
  });

  // The accumulator only works because `content_block_start` is remembered:
  // neither argument fragment names the call or the tool.
  it("reassembles a tool call split across argument fragments", async () => {
    const events = await run();
    const calls = events.filter((e) => e.type === "tool_call");
    expect(calls).toHaveLength(1);
    expect((calls[0] as { call: unknown }).call).toEqual({
      id: "toolu_9",
      name: "search",
      arguments: '{"q":"atlas"}',
    });
  });

  it("reports usage from both frames that carry it", async () => {
    const events = await run();
    const usage = events.filter(
      (e): e is { type: "usage"; usage: Usage } => e.type === "usage",
    );
    expect(usage.map((u) => u.usage.promptTokens).find(Boolean)).toBe(11);
    expect(usage.map((u) => u.usage.completionTokens).find(Boolean)).toBe(7);
  });

  it("terminates through the normal done path with the stop reason", async () => {
    // Anthropic never sends `[DONE]`; `message_stop` is translated into it so the
    // loop ends the way it does for every other provider.
    const events = await run();
    const done = events.filter((e) => e.type === "done");
    expect(done).toHaveLength(1);
    expect((done[0] as { finishReason?: string }).finishReason).toBe("tool_use");
  });
});
