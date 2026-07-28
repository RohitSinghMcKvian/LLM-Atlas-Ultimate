import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeModel, makeSnapshot } from "@/lib/catalog/__fixtures__/snapshots";
import { installSnapshot, resetSnapshot } from "@/lib/catalog/snapshot";
import {
  CONNECT_TIMEOUT_MS,
  FIRST_CHUNK_TIMEOUT_MS,
  RouterError,
  resolveCandidates,
  streamChatEvents,
  type RouterEvent,
} from "./index";

// Failover semantics, pinned against the measured production failures.
//
// The bug this file exists to prevent: `if (status !== 429 && status < 500) break`
// meant a 404 from the first route ended the request. NVIDIA sorts first in
// ROUTE_PRIORITY and advertises models it does not serve, so 15 models with a
// working OpenRouter route were unreachable in the UI.

/** An SSE body that yields `chunks` then closes. */
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

/** A body that never produces anything and never closes. */
function hangingBody(): ReadableStream<Uint8Array> {
  return new ReadableStream({ pull() { return new Promise<void>(() => {}); } });
}

function ok(text = "hi"): Response {
  return new Response(
    sseBody([`data: {"choices":[{"delta":{"content":"${text}"}}]}\n\n`, "data: [DONE]\n\n"]),
    { status: 200 },
  );
}

function fail(status: number, body = "nope"): Response {
  return new Response(body, { status });
}

/** Queue of scripted responses; each call shifts one. Records the URLs hit. */
function scriptFetch(steps: (Response | "hang-headers" | "hang-body")[]) {
  const seen: string[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    seen.push(String(url));
    const step = steps.shift();
    if (step === undefined) throw new Error(`unexpected fetch: ${url}`);
    if (step === "hang-headers") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    }
    if (step === "hang-body") return new Response(hangingBody(), { status: 200 });
    return step;
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return { seen, fn };
}

const realFetch = globalThis.fetch;

/** nvidia first (dead), openrouter :free second (works) — the gemma-3-12b shape. */
const twoRoute = makeModel({
  id: "two-route",
  name: "Two Route",
  routes: [
    { provider: "nvidia", model: "google/gemma-3-12b-it" },
    { provider: "openrouter", model: "google/gemma-3-12b-it:free" },
  ],
});

/** Only a metered OpenRouter route — the command-a shape. */
const meteredOnly = makeModel({
  id: "metered-only",
  name: "Metered Only",
  license: "proprietary",
  routes: [{ provider: "openrouter", model: "cohere/command-a" }],
  pricing: { inputPerM: 2.5, outputPerM: 10, effectiveFrom: "2026-01-01" },
});

async function drain(gen: AsyncGenerator<RouterEvent>): Promise<RouterEvent[]> {
  const out: RouterEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

function stream(modelId: string, extra: Record<string, unknown> = {}) {
  return streamChatEvents({
    modelId,
    messages: [{ role: "user", content: "hi" }],
    ...extra,
  } as Parameters<typeof streamChatEvents>[0]);
}

beforeEach(() => {
  resetSnapshot();
  installSnapshot(makeSnapshot([twoRoute, meteredOnly]));
  process.env.NVIDIA_API_KEY = "nvapi-test";
  process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
  delete process.env.GROQ_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.LOCAL_BASE_URL;
  delete process.env.OPERATOR_SERVE_PAID;
  delete process.env.ATLAS_FREE_OPEN_CEILING_PER_M;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  resetSnapshot();
  vi.useRealTimers();
});

describe("resolveCandidates", () => {
  it("offers both free routes in order", () => {
    const c = resolveCandidates("two-route");
    expect(c.map((r) => r.route.provider)).toEqual(["nvidia", "openrouter"]);
  });

  it("refuses a metered-only model with no user key", () => {
    expect(() => resolveCandidates("metered-only")).toThrow(RouterError);
    try {
      resolveCandidates("metered-only");
    } catch (e) {
      expect((e as RouterError).code).toBe("key_required");
      expect((e as RouterError).status).toBe(402);
    }
  });

  it("offers the metered route once the user supplies a key", () => {
    const c = resolveCandidates("metered-only", { openrouter: "sk-or-v1-user" });
    expect(c).toHaveLength(1);
    expect(c[0].runtime.apiKey).toBe("sk-or-v1-user");
  });

  it("throws model_not_found for an unknown id", () => {
    try {
      resolveCandidates("nope");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as RouterError).code).toBe("model_not_found");
    }
  });
});

describe("failover advances past every terminal status", () => {
  // THE regression test. Before the fix this threw instead of advancing.
  it("advances to the next route on 404", async () => {
    const { seen } = scriptFetch([fail(404, "Function not found"), ok("yes")]);
    const events = await drain(stream("two-route"));
    expect(seen).toHaveLength(2);
    expect(events).toEqual(
      expect.arrayContaining([
        { type: "provider", provider: "openrouter" },
        { type: "token", text: "yes" },
      ]),
    );
  });

  it("advances on 402", async () => {
    const { seen } = scriptFetch([fail(402, "no credit"), ok()]);
    await drain(stream("two-route"));
    expect(seen).toHaveLength(2);
  });

  it("advances on 400 and 401", async () => {
    scriptFetch([fail(400), ok()]);
    expect(await drain(stream("two-route"))).toContainEqual({ type: "token", text: "hi" });

    scriptFetch([fail(401), ok()]);
    expect(await drain(stream("two-route"))).toContainEqual({ type: "token", text: "hi" });
  });

  it("advances on 429 and 500 (the old behaviour, preserved)", async () => {
    scriptFetch([fail(429), ok()]);
    expect(await drain(stream("two-route"))).toContainEqual({ type: "token", text: "hi" });

    scriptFetch([fail(503), ok()]);
    expect(await drain(stream("two-route"))).toContainEqual({ type: "token", text: "hi" });
  });

  it("advances when a route returns 200 but streams nothing", async () => {
    // Measured on deepseek-v4-flash: meta frame, then done, no content.
    const { seen } = scriptFetch([new Response(sseBody([]), { status: 200 }), ok("real")]);
    const events = await drain(stream("two-route"));
    expect(seen).toHaveLength(2);
    expect(events).toContainEqual({ type: "token", text: "real" });
  });

  // Measured on NVIDIA's `google/gemma-2-2b-it`, which answers
  // `422 body -> stream_options Extra inputs are not permitted`. The model works;
  // the endpoint just rejects that one field.
  it("retries the same route without stream_options on a 422 naming it", async () => {
    const bodies: string[] = [];
    let call = 0;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      call += 1;
      if (call === 1) {
        return fail(422, "body -> stream_options\n  Extra inputs are not permitted");
      }
      return ok("worked");
    }) as unknown as typeof fetch;

    const events = await drain(stream("two-route"));
    expect(events).toContainEqual({ type: "token", text: "worked" });
    // Same provider both times — it did not burn the OpenRouter route on a quirk.
    expect(JSON.parse(bodies[0]).stream_options).toBeDefined();
    expect(JSON.parse(bodies[1]).stream_options).toBeUndefined();
    expect(JSON.parse(bodies[1]).model).toBe(JSON.parse(bodies[0]).model);
  });

  it("does not retry a 422 that is unrelated to stream_options", async () => {
    const { seen } = scriptFetch([fail(422, "context length exceeded"), ok()]);
    await drain(stream("two-route"));
    expect(seen).toHaveLength(2);
  });

  it("advances on a network throw", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(ok("recovered")) as unknown as typeof fetch;
    const events = await drain(stream("two-route"));
    expect(events).toContainEqual({ type: "token", text: "recovered" });
  });

  it("does not attempt a second route when the first succeeds", async () => {
    const { seen } = scriptFetch([ok()]);
    await drain(stream("two-route"));
    expect(seen).toHaveLength(1);
  });

  it("omits the provider event when the preferred route served it", async () => {
    scriptFetch([ok()]);
    const events = await drain(stream("two-route"));
    expect(events.some((e) => e.type === "provider")).toBe(false);
  });
});

describe("aggregate errors are actionable", () => {
  it("reports no_credit when every route answers 402", async () => {
    scriptFetch([fail(402), fail(402)]);
    await expect(drain(stream("two-route"))).rejects.toMatchObject({
      code: "no_credit",
      status: 402,
    });
  });

  it("reports route_dead naming both providers when every route 404s", async () => {
    scriptFetch([fail(404), fail(404)]);
    try {
      await drain(stream("two-route"));
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as RouterError;
      expect(err.code).toBe("route_dead");
      expect(err.message).toContain("nvidia");
      expect(err.message).toContain("openrouter");
      expect(err.attempts).toHaveLength(2);
    }
  });

  it("reports provider_key_invalid when every route rejects the key", async () => {
    scriptFetch([fail(401), fail(403)]);
    await expect(drain(stream("two-route"))).rejects.toMatchObject({
      code: "provider_key_invalid",
    });
  });

  it("reports all_routes_failed for mixed failures", async () => {
    scriptFetch([fail(404), fail(500)]);
    await expect(drain(stream("two-route"))).rejects.toMatchObject({
      code: "all_routes_failed",
    });
  });

  it("scrubs credentials out of the recorded upstream detail", async () => {
    scriptFetch([
      fail(400, 'bad key: sk-or-v1-abcdef1234567890 and nvapi-ZZZZZZZZZZZZ'),
      fail(400, "plain"),
    ]);
    try {
      await drain(stream("two-route"));
    } catch (e) {
      const detail = (e as RouterError).attempts?.[0].detail ?? "";
      expect(detail).not.toContain("abcdef1234567890");
      expect(detail).not.toContain("ZZZZZZZZZZZZ");
      expect(detail).toContain("sk-or-v1-***");
    }
  });
});

describe("timeouts", () => {
  it("advances to the next route when headers never arrive", async () => {
    vi.useFakeTimers();
    const { seen } = scriptFetch(["hang-headers", ok("second")]);
    const p = drain(stream("two-route"));
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS + 10);
    const events = await p;
    expect(seen).toHaveLength(2);
    expect(events).toContainEqual({ type: "token", text: "second" });
  });

  it("advances when headers arrive but the first chunk never does", async () => {
    vi.useFakeTimers();
    const { seen } = scriptFetch(["hang-body", ok("second")]);
    const p = drain(stream("two-route"));
    await vi.advanceTimersByTimeAsync(FIRST_CHUNK_TIMEOUT_MS + 10);
    const events = await p;
    expect(seen).toHaveLength(2);
    expect(events).toContainEqual({ type: "token", text: "second" });
  });

  it("reports all_routes_timed_out when every route hangs", async () => {
    vi.useFakeTimers();
    scriptFetch(["hang-headers", "hang-headers"]);
    const p = drain(stream("two-route"));
    const assertion = expect(p).rejects.toMatchObject({
      code: "all_routes_timed_out",
      status: 504,
    });
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS * 2 + 100);
    await assertion;
  });
});

describe("caller abort", () => {
  it("rethrows instead of advancing to the next route", async () => {
    const ac = new AbortController();
    const { seen } = scriptFetch(["hang-headers", ok()]);
    const p = drain(stream("two-route", { signal: ac.signal }));
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    // Crucially: the second route was never dialled.
    expect(seen).toHaveLength(1);
  });
});

describe("cost safety", () => {
  it("never dials a metered route while serving a free verdict", async () => {
    // A model with a free route and a metered twin: only the free one may be hit.
    const mixed = makeModel({
      id: "mixed",
      routes: [
        { provider: "openrouter", model: "x/y:free" },
        { provider: "openrouter", model: "x/y" },
      ],
      pricing: { inputPerM: 5, outputPerM: 5, effectiveFrom: "2026-01-01" },
    });
    resetSnapshot();
    installSnapshot(makeSnapshot([mixed]));

    scriptFetch([fail(404), fail(404)]);
    try {
      await drain(stream("mixed"));
    } catch (e) {
      const attempts = (e as RouterError).attempts ?? [];
      expect(attempts).toHaveLength(1);
      expect(attempts[0].routeModel).toBe("x/y:free");
    }
  });
});
