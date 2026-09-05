import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installSnapshot, resetSnapshot } from "@/lib/catalog/snapshot";
import { makeModel, makeSnapshot } from "@/lib/catalog/__fixtures__/snapshots";
import { postSSE } from "@/lib/sse-client";
import { resetRouterCalls, routerCalls } from "./telemetry";

// The `postSSE` tap, end to end.
//
// The point of testing at this seam rather than at `beginRouterCall` is that the
// seam is the load-bearing part: eighteen call sites across the app get router
// telemetry precisely because none of them had to ask for it. A unit test of the
// recorder would pass just as happily with the tap unwired.

const MODEL = makeModel({
  id: "test-model",
  name: "Test Model",
  pricing: { inputPerM: 2, outputPerM: 8, effectiveFrom: "2026-01-01" },
});

/**
 * A model with a real list price that NVIDIA also serves.
 *
 * The interesting case for pricing: NVIDIA is `billing: "operator-funded"`, so
 * this costs the user nothing on that route while the catalog still quotes
 * $2/$8 per Mtok for it. Most open-weight models in the live catalog look
 * exactly like this.
 */
const DUAL_ROUTED = makeModel({
  id: "dual-model",
  name: "Dual Routed",
  pricing: { inputPerM: 2, outputPerM: 8, effectiveFrom: "2026-01-01" },
  routes: [
    { provider: "nvidia", model: "meta/dual" },
    { provider: "openrouter", model: "meta/dual" },
  ],
});

/** A Response whose body streams the given SSE frames. */
function sseResponse(frames: unknown[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const f of frames) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(f)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

async function drain(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

beforeEach(() => {
  resetSnapshot();
  installSnapshot(makeSnapshot([MODEL, DUAL_ROUTED]));
  resetRouterCalls();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the postSSE router tap", () => {
  it("records a successful call with provider, timing, tokens and cost", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          { type: "meta", provider: "nvidia" },
          { type: "delta", text: "hi" },
          { type: "usage", promptTokens: 1000, completionTokens: 500 },
          { type: "done", finishReason: "stop" },
        ]),
      ),
    );

    const events = await drain(
      postSSE("/api/v1/router/chat", { modelId: "test-model", messages: [] }),
    );
    expect(events).toHaveLength(4);

    const [call] = routerCalls();
    expect(call.modelId).toBe("test-model");
    expect(call.modelName).toBe("Test Model");
    expect(call.provider).toBe("nvidia");
    expect(call.status).toBe("ok");
    expect(call.fellBack).toBe(false);
    expect(call.promptTokens).toBe(1000);
    expect(call.completionTokens).toBe(500);
    // 1000 in at $2/M + 500 out at $8/M.
    expect(call.costUsd).toBeCloseTo(0.002 + 0.004, 6);
    expect(call.ttftMs).toBeGreaterThanOrEqual(0);
    expect(call.totalMs).toBeGreaterThanOrEqual(0);
  });

  it("marks a fallback when a second provider serves the same request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          { type: "meta", provider: "nvidia" },
          // The router fell through after a 429 upstream.
          { type: "meta", provider: "openrouter" },
          { type: "delta", text: "hi" },
          { type: "done" },
        ]),
      ),
    );

    await drain(postSSE("/api/v1/router/chat", { modelId: "test-model", messages: [] }));

    const [call] = routerCalls();
    expect(call.provider).toBe("openrouter");
    expect(call.fellBack).toBe(true);
  });

  it("records an error frame as a failed call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([{ type: "error", code: "key_required", message: "Connect your key." }]),
      ),
    );

    await drain(postSSE("/api/v1/router/chat", { modelId: "test-model", messages: [] }));

    const [call] = routerCalls();
    expect(call.status).toBe("error");
    expect(call.error).toBe("Connect your key.");
  });

  it("records an HTTP failure before any frame arrives", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "No provider configured" }, { status: 503 })),
    );

    await expect(
      drain(postSSE("/api/v1/router/chat", { modelId: "test-model", messages: [] })),
    ).rejects.toThrow();

    const [call] = routerCalls();
    expect(call.status).toBe("error");
    expect(call.error).toBe("No provider configured");
  });

  it("closes the record when the consumer stops reading early", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          { type: "meta", provider: "nvidia" },
          { type: "delta", text: "a" },
          { type: "delta", text: "b" },
          { type: "done" },
        ]),
      ),
    );

    // Break out mid-stream, the way a Stop button does.
    for await (const _ev of postSSE("/api/v1/router/chat", {
      modelId: "test-model",
      messages: [],
    })) {
      break;
    }

    const [call] = routerCalls();
    // Not left "streaming" forever — an abandoned stream still resolves.
    expect(call.status).toBe("ok");
  });

  it("charges nothing for a call a free route served, whatever the list price says", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          // NVIDIA is operator-funded, so this costs the user nothing even
          // though the catalog prices the model at $2 / $8 per Mtok.
          { type: "meta", provider: "nvidia" },
          { type: "usage", promptTokens: 1_000_000, completionTokens: 1_000_000 },
          { type: "done" },
        ]),
      ),
    );

    await drain(postSSE("/api/v1/router/chat", { modelId: "dual-model", messages: [] }));
    expect(routerCalls()[0].costUsd).toBe(0);
  });

  it("charges the list price when a metered route served the same model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          { type: "meta", provider: "openrouter" },
          { type: "usage", promptTokens: 1_000_000, completionTokens: 1_000_000 },
          { type: "done" },
        ]),
      ),
    );

    await drain(postSSE("/api/v1/router/chat", { modelId: "dual-model", messages: [] }));
    expect(routerCalls()[0].costUsd).toBeCloseTo(10, 6);
  });

  it("re-prices when a request falls through from a free route to a metered one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          { type: "meta", provider: "nvidia" },
          // NVIDIA 429'd; OpenRouter picked it up and is billing for it.
          { type: "meta", provider: "openrouter" },
          { type: "usage", promptTokens: 1_000_000, completionTokens: 1_000_000 },
          { type: "done" },
        ]),
      ),
    );

    await drain(postSSE("/api/v1/router/chat", { modelId: "dual-model", messages: [] }));
    const [call] = routerCalls();
    expect(call.fellBack).toBe(true);
    expect(call.costUsd).toBeCloseTo(10, 6);
  });

  it("ignores every other route", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([{ type: "done" }])));

    await drain(postSSE("/api/v1/compare/lanes", { modelId: "test-model" }));
    await drain(postSSE("/api/v1/learn/grade", { modelId: "test-model" }));

    expect(routerCalls()).toHaveLength(0);
  });

  it("ignores a router call with no model id rather than recording a blank row", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([{ type: "done" }])));
    await drain(postSSE("/api/v1/router/chat", { messages: [] }));
    expect(routerCalls()).toHaveLength(0);
  });

  it("keeps the newest calls first and bounds what it retains", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([{ type: "done" }])));

    for (let i = 0; i < 30; i++) {
      await drain(postSSE("/api/v1/router/chat", { modelId: "test-model", messages: [] }));
    }

    const calls = routerCalls();
    expect(calls.length).toBeLessThanOrEqual(25);
    // Newest first: ids are monotonic, so the head must be the last one made.
    expect(calls[0].startedAt).toBeGreaterThanOrEqual(calls[calls.length - 1].startedAt);
  });

  it("names a model the catalog no longer has rather than rendering blank", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([{ type: "done" }])));
    await drain(postSSE("/api/v1/router/chat", { modelId: "retired-yesterday", messages: [] }));
    expect(routerCalls()[0].modelName).toBe("retired-yesterday");
  });
});
