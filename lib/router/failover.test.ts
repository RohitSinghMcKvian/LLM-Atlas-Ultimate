import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeModel, makeSnapshot } from "@/lib/catalog/__fixtures__/snapshots";
import { installSnapshot, resetSnapshot } from "@/lib/catalog/snapshot";
import {
  CONNECT_TIMEOUT_MS,
  FIRST_CHUNK_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  idleTimeoutFor,
  MAX_IDLE_TIMEOUT_MS,
  PATIENT_DEADLINE_MS,
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

/**
 * A body whose first chunk arrives after `ms`.
 *
 * The Nemotron 3 Ultra shape: the provider is working, it is just not finished
 * thinking yet.
 */
function slowBody(ms: number, text = "late"): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let sent = false;
  return new ReadableStream({
    async pull(c) {
      if (sent) {
        c.close();
        return;
      }
      sent = true;
      await new Promise<void>((r) => setTimeout(r, ms));
      c.enqueue(enc.encode(`data: {"choices":[{"delta":{"content":"${text}"}}]}\n\n`));
    },
  });
}

/** Headers withheld for `ms`, then a normal stream — what NVIDIA NIM does. */
type Step = Response | "hang-headers" | "hang-body" | { slowHeaders: number } | { slowBody: number };

/** Queue of scripted responses; each call shifts one. Records the URLs hit. */
function scriptFetch(steps: Step[]) {
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
    if (typeof step === "object" && "slowHeaders" in step) {
      return new Promise<Response>((resolve, reject) => {
        const t = setTimeout(() => resolve(ok("late")), step.slowHeaders);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }
    if (typeof step === "object" && "slowBody" in step) {
      return new Response(slowBody(step.slowBody), { status: 200 });
    }
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

  // Same remedy, for `tools`. Without it a route that rejects tool calling is
  // spent rather than downgraded — and since most NIM-only models have exactly
  // one route, the queue empties and the whole turn fails with
  // `all_routes_failed` instead of just answering without tools.
  it("retries the same route without tools when the route rejects them", async () => {
    const bodies: string[] = [];
    let call = 0;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      call += 1;
      if (call === 1) return fail(400, '{"message":"This model does not support function calling."}');
      return ok("answered");
    }) as unknown as typeof fetch;

    const events = await drain(
      stream("two-route", { tools: [{ type: "function", function: { name: "f" } }] }),
    );
    expect(events).toContainEqual({ type: "token", text: "answered" });
    expect(JSON.parse(bodies[0]).tools).toBeDefined();
    expect(JSON.parse(bodies[1]).tools).toBeUndefined();
    // Same route both times: a compatibility quirk must not consume a provider.
    expect(JSON.parse(bodies[1]).model).toBe(JSON.parse(bodies[0]).model);
  });

  // Never silent. The turn produced a real answer with no tool access, and the
  // caller has to be able to both say so and remember it.
  it("announces the downgrade before the first token", async () => {
    let call = 0;
    globalThis.fetch = (async () => {
      call += 1;
      if (call === 1) return fail(400, '{"error":{"message":"Unknown field: tools"}}');
      return ok("answered");
    }) as unknown as typeof fetch;

    const events = await drain(
      stream("two-route", { tools: [{ type: "function", function: { name: "f" } }] }),
    );
    const capability = events.findIndex((e) => e.type === "capability");
    const firstToken = events.findIndex((e) => e.type === "token");
    expect(capability).toBeGreaterThanOrEqual(0);
    expect(capability).toBeLessThan(firstToken);
    expect(events[capability]).toEqual({
      type: "capability",
      capability: "tools",
      supported: false,
    });
  });

  it("says nothing about capabilities when tools were accepted", async () => {
    scriptFetch([ok("fine")]);
    const events = await drain(
      stream("two-route", { tools: [{ type: "function", function: { name: "f" } }] }),
    );
    expect(events.some((e) => e.type === "capability")).toBe(false);
  });

  // A tool-shaped error that is not a capability refusal — a malformed
  // `tool_call_id`, an unknown function name — must not cost a second call, and
  // must not teach the client a 30-day negative.
  it("does not retry an ordinary tool error", async () => {
    const { seen } = scriptFetch([fail(400, '{"error":{"message":"Invalid tool_call_id"}}'), ok()]);
    const events = await drain(
      stream("two-route", { tools: [{ type: "function", function: { name: "f" } }] }),
    );
    expect(seen).toHaveLength(2); // advanced to the next route, did not downgrade
    expect(events.some((e) => e.type === "capability")).toBe(false);
  });

  it("does not downgrade when the caller offered no tools", async () => {
    const { seen } = scriptFetch([fail(400, "tools are not supported"), ok()]);
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
    // Both routes are parked at the failover deadline and only give up at the
    // patient one — a hang is now distinguished from a wait by how long it
    // lasts, not by which deadline it missed.
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS * 2 + PATIENT_DEADLINE_MS * 2 + 100);
    await assertion;
  });
});

/**
 * A route that is slow is not a route that is down.
 *
 * Measured on `nvidia/nemotron-3-ultra-550b-a55b`: 56–60 s to first byte for a
 * five-token prompt, because NIM withholds headers until generation starts. The
 * failover deadlines killed it at ten seconds, on every route, so the one model
 * in the catalog with a million-token window could not be called at all. These
 * pin both halves of the fix: the queue still moves on immediately, and a route
 * that nothing else beats is still waited for.
 */
describe("slow routes are parked, not killed", () => {
  it("waits out a lone slow route rather than failing the turn", async () => {
    vi.useFakeTimers();
    const { seen } = scriptFetch([{ slowHeaders: 60_000 }, fail(404)]);
    const p = drain(stream("two-route"));
    await vi.advanceTimersByTimeAsync(60_000 + 100);
    const events = await p;
    expect(events).toContainEqual({ type: "token", text: "late" });
    // The second route was still dialled at the ten-second mark: parking costs
    // the queue nothing.
    expect(seen).toHaveLength(2);
  });

  it("parks a slow first chunk too, not only slow headers", async () => {
    vi.useFakeTimers();
    scriptFetch([{ slowBody: 60_000 }, fail(500)]);
    const p = drain(stream("two-route"));
    await vi.advanceTimersByTimeAsync(60_000 + 100);
    expect(await p).toContainEqual({ type: "token", text: "late" });
  });

  it("still prefers a route that answers now over one that is thinking", async () => {
    vi.useFakeTimers();
    scriptFetch([{ slowHeaders: 60_000 }, ok("fast")]);
    const p = drain(stream("two-route"));
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS + 10);
    const events = await p;
    expect(events).toContainEqual({ type: "token", text: "fast" });
    expect(events).not.toContainEqual({ type: "token", text: "late" });
  });

  it("does not park past the patient deadline", async () => {
    vi.useFakeTimers();
    scriptFetch([{ slowHeaders: PATIENT_DEADLINE_MS * 3 }, fail(404)]);
    const p = drain(stream("two-route"));
    const assertion = expect(p).rejects.toBeInstanceOf(RouterError);
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS + PATIENT_DEADLINE_MS + 100);
    await assertion;
  });

  it("Stop still wins over a parked route", async () => {
    const ac = new AbortController();
    scriptFetch([{ slowHeaders: 60_000 }, { slowHeaders: 60_000 }]);
    const p = drain(stream("two-route", { signal: ac.signal }));
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
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

describe("usage", () => {
  const usageFrame = (usage: unknown) =>
    new Response(
      sseBody([
        `data: {"choices":[{"delta":{"content":"hi"}}]}\n\n`,
        `data: {"choices":[{"delta":{}}],"usage":${JSON.stringify(usage)}}\n\n`,
        "data: [DONE]\n\n",
      ]),
      { status: 200 },
    );

  const usageOf = (events: RouterEvent[]) =>
    events.find((e): e is Extract<RouterEvent, { type: "usage" }> => e.type === "usage")?.usage;

  it("reports token counts", async () => {
    scriptFetch([usageFrame({ prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 })]);
    const u = usageOf(await drain(stream("two-route")));
    expect(u).toMatchObject({ promptTokens: 11, completionTokens: 22, totalTokens: 33 });
  });

  it("omits imageTokens when the provider does not report any", async () => {
    // Absent must stay absent rather than becoming 0: "not reported" and "no
    // image tokens" price the same today, but only one of them is a claim.
    scriptFetch([usageFrame({ prompt_tokens: 1, completion_tokens: 2 })]);
    expect(usageOf(await drain(stream("two-route")))?.imageTokens).toBeUndefined();
  });

  it("picks up image tokens from completion_tokens_details (§P13)", async () => {
    scriptFetch([
      usageFrame({
        prompt_tokens: 10,
        completion_tokens: 1_500,
        completion_tokens_details: { image_tokens: 1_290 },
      }),
    ]);
    const u = usageOf(await drain(stream("two-route")));
    // A subset of the completion total, not an addition to it.
    expect(u?.imageTokens).toBe(1_290);
    expect(u?.completionTokens).toBe(1_500);
  });

  it("accepts the output_tokens_details spelling too", async () => {
    scriptFetch([
      usageFrame({
        prompt_tokens: 10,
        completion_tokens: 1_500,
        output_tokens_details: { image_output_tokens: 900 },
      }),
    ]);
    expect(usageOf(await drain(stream("two-route")))?.imageTokens).toBe(900);
  });

  it("ignores a zero or non-numeric image count", async () => {
    scriptFetch([
      usageFrame({
        prompt_tokens: 1,
        completion_tokens: 2,
        completion_tokens_details: { image_tokens: "lots" },
      }),
    ]);
    expect(usageOf(await drain(stream("two-route")))?.imageTokens).toBeUndefined();
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

/**
 * Bytes are not an answer.
 *
 * Both of these were seen live, in the same failed build: OpenRouter opens every
 * stream with `: OPENROUTER PROCESSING` comment lines while the upstream
 * provider queues, and delivers a provider failure as a `data:` frame with an
 * `error` object and no `choices`. Between them, a route that had nothing won
 * the race against a route that was still producing the page, and the user was
 * shown an empty assistant message with no error at all.
 */
describe("a route that committed but said nothing", () => {
  /** What OpenRouter actually sends before the upstream provider replies. */
  const KEEPALIVE = ": OPENROUTER PROCESSING\n\n";

  function keepaliveThen(...rest: string[]): Response {
    return new Response(sseBody([KEEPALIVE, KEEPALIVE, ...rest]), { status: 200 });
  }

  it("does not commit on keepalive comments alone", async () => {
    // Route one sends keepalives and closes; route two answers.
    scriptFetch([keepaliveThen(), ok("second")]);
    expect(await drain(stream("two-route"))).toContainEqual({ type: "token", text: "second" });
  });

  it("still commits once a real data frame arrives after the keepalives", async () => {
    const { seen } = scriptFetch([
      keepaliveThen(`data: {"choices":[{"delta":{"content":"first"}}]}\n\n`, "data: [DONE]\n\n"),
    ]);
    expect(await drain(stream("two-route"))).toContainEqual({ type: "token", text: "first" });
    expect(seen).toHaveLength(1);
  });

  it("reports a mid-stream error instead of ending silently", async () => {
    scriptFetch([
      new Response(
        sseBody([`data: {"error":{"message":"Rate limit exceeded","code":429}}\n\n`]),
        { status: 200 },
      ),
      new Response(sseBody([`data: {"error":{"message":"Rate limit exceeded"}}\n\n`]), {
        status: 200,
      }),
    ]);
    await expect(drain(stream("two-route"))).rejects.toMatchObject({
      code: "upstream_error",
      message: "Rate limit exceeded",
    });
  });

  it("falls back to a parked route when the winner turns out to be empty", async () => {
    vi.useFakeTimers();
    // NVIDIA is slow (parked). OpenRouter answers at once — with nothing.
    scriptFetch([{ slowHeaders: 60_000 }, keepaliveThen("data: [DONE]\n\n")]);
    const p = drain(stream("two-route"));
    await vi.advanceTimersByTimeAsync(60_000 + 100);
    // The page the slow route was producing all along.
    expect(await p).toContainEqual({ type: "token", text: "late" });
  });

  it("does not treat a tool call as nothing", async () => {
    scriptFetch([
      new Response(
        sseBody([
          `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"workspace","arguments":"{}"}}]}}]}\n\n`,
          "data: [DONE]\n\n",
        ]),
        { status: 200 },
      ),
    ]);
    const events = await drain(stream("two-route"));
    expect(events.some((e) => e.type === "tool_call")).toBe(true);
    expect(events).toContainEqual({ type: "done", finishReason: undefined });
  });
});

/**
 * The idle gap has to know how slow the model is.
 *
 * Observed live, mid-build: Nemotron 3 Ultra streamed reasoning, went quiet
 * while composing the next step, and was cut at sixty seconds as `stalled` — the
 * one finish reason nothing retries, because `shouldContinue` correctly treats
 * it as the failover layer's problem and the failover layer cannot act after the
 * route is committed. The build ended empty, with no error.
 */
describe("idleTimeoutFor", () => {
  it("gives a slow reasoning model longer than sixty seconds", () => {
    expect(idleTimeoutFor({ throughputTps: 70 })).toBeGreaterThan(IDLE_TIMEOUT_MS);
  });

  it("leaves a fast model on exactly the gap it has today", () => {
    expect(idleTimeoutFor({ throughputTps: 400 })).toBe(IDLE_TIMEOUT_MS);
    expect(idleTimeoutFor(null)).toBe(IDLE_TIMEOUT_MS);
    expect(idleTimeoutFor({})).toBe(IDLE_TIMEOUT_MS);
  });

  it("never shortens the gap for any model", () => {
    for (const tps of [1, 33, 70, 100, 400, 5_000]) {
      expect(idleTimeoutFor({ throughputTps: tps })).toBeGreaterThanOrEqual(IDLE_TIMEOUT_MS);
    }
  });

  // A silent connection is eventually dead rather than thinking, and holding it
  // open costs the user the turn either way.
  it("is bounded", () => {
    expect(idleTimeoutFor({ throughputTps: 0.001 })).toBe(MAX_IDLE_TIMEOUT_MS);
  });
});
