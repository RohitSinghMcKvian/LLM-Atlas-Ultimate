import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeModel, makeSnapshot } from "@/lib/catalog/__fixtures__/snapshots";
import { installSnapshot, resetSnapshot } from "@/lib/catalog/snapshot";
import { PROVIDERS } from "@/lib/catalog/providers";
import { bumpUsage, quotaFor, resetLedgerMemory } from "@/lib/quota";
import { RouterError, streamChatEvents, type RouterEvent } from "./index";

// Pre-flight blocking, proven through the real streaming path.
//
// The claim being tested is narrow and load-bearing: an exhausted lane is
// SKIPPED, not attempted. A test that only asserted the final error would pass
// just as happily against a reactive 429 handler, so every case here also
// checks which URLs were actually dialled.

const realFetch = globalThis.fetch;

/** nvidia first, openrouter second — the standard two-free-route shape. */
const twoRoute = makeModel({
  id: "two-route",
  name: "Two Route",
  routes: [
    { provider: "nvidia", model: "google/gemma-3-12b-it" },
    { provider: "openrouter", model: "google/gemma-3-12b-it:free" },
  ],
});

function okStream(text: string): Response {
  const body = `data: {"choices":[{"delta":{"content":${JSON.stringify(text)}}}]}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200 });
}

let seen: string[] = [];

function scriptFetch(headers: Record<string, string> = {}) {
  seen = [];
  globalThis.fetch = vi.fn(async (url: string | URL) => {
    seen.push(String(url));
    const res = okStream("hi");
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    return res;
  }) as unknown as typeof fetch;
}

async function drain(modelId = "two-route"): Promise<RouterEvent[]> {
  const out: RouterEvent[] = [];
  for await (const ev of streamChatEvents({
    modelId,
    messages: [{ role: "user", content: "hi" }],
  } as Parameters<typeof streamChatEvents>[0])) {
    out.push(ev);
  }
  return out;
}

/** Spend a lane's tightest request window down to zero. */
async function exhaust(lane: "nvidia" | "openrouter") {
  const rpm = quotaFor(PROVIDERS[lane]).find(
    (q) => q.kind === "minute" && q.unit === "requests",
  );
  const rpd = quotaFor(PROVIDERS[lane]).find((q) => q.kind === "day" && q.unit === "requests");
  const n = rpm?.limit ?? rpd!.limit;
  for (let i = 0; i < n; i++) await bumpUsage("operator", lane, {});
}

beforeEach(() => {
  resetSnapshot();
  installSnapshot(makeSnapshot([twoRoute]));
  resetLedgerMemory();
  delete process.env.SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NVIDIA_API_KEY = "nvapi-test";
  process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
  delete process.env.OPERATOR_SERVE_PAID;
  scriptFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  resetSnapshot();
  resetLedgerMemory();
});

describe("pre-flight quota blocking", () => {
  it("dials the preferred lane while it still has allowance", async () => {
    const events = await drain();
    expect(events).toContainEqual({ type: "token", text: "hi" });
    expect(seen[0]).toContain("nvidia");
  });

  // THE test: skipped, never attempted.
  it("does not even dial a lane whose window is spent", async () => {
    await exhaust("nvidia");
    const events = await drain();

    expect(seen.some((u) => u.includes("nvidia"))).toBe(false);
    expect(seen.some((u) => u.includes("openrouter"))).toBe(true);
    // And the caller still gets their answer, from the surviving lane.
    expect(events).toContainEqual({ type: "token", text: "hi" });
    expect(events).toContainEqual({ type: "provider", provider: "openrouter" });
  });

  it("refuses with quota_exhausted once every lane is spent", async () => {
    await exhaust("nvidia");
    await exhaust("openrouter");

    await expect(drain()).rejects.toMatchObject({
      code: "quota_exhausted",
      status: 429,
    });
    // Nothing was dialled at all — the point of a ledger over a 429 handler.
    expect(seen).toEqual([]);
  });

  it("says when the allowance comes back, not just that it is gone", async () => {
    await exhaust("nvidia");
    await exhaust("openrouter");
    try {
      await drain();
      expect.unreachable("should have refused");
    } catch (e) {
      const err = e as RouterError;
      expect(err.retryAfterMs).toBeGreaterThan(0);
      // The message has to be actionable: when, and the way around it.
      expect(err.message).toMatch(/resets in about/);
      expect(err.message).toMatch(/your own\s+key/);
    }
  });

  it("lets the lane back in after its window rolls over", async () => {
    await exhaust("nvidia");
    // NVIDIA's tier is stated per *day* (rpd 1000, no rpm), so the day window is
    // the one that has to roll. Tomorrow is a different row entirely, which is
    // what lets the lane recover without anything having to reset a counter.
    const later = Date.now() + 86_400_000 + 60_000;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(later);
    try {
      await drain();
      expect(seen.some((u) => u.includes("nvidia"))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

// The promise the `quota_exhausted` message makes, kept.
//
// `runtimeFor` prefers the operator's key on a free route, so a BYOK user's key
// normally sits unused. That is right while the operator can still pay and
// wrong the moment they cannot — otherwise the app tells someone to connect a
// key they already connected.
describe("falling back to the user's own key when the operator's runs out", () => {
  it("serves an exhausted lane on the user's key instead of refusing", async () => {
    await exhaust("nvidia");
    await exhaust("openrouter");

    const out: RouterEvent[] = [];
    for await (const ev of streamChatEvents({
      modelId: "two-route",
      messages: [{ role: "user", content: "hi" }],
      userKeys: { nvidia: "nvapi-mine" },
    } as Parameters<typeof streamChatEvents>[0])) {
      out.push(ev);
    }

    expect(out).toContainEqual({ type: "token", text: "hi" });
    expect(seen.some((u) => u.includes("nvidia"))).toBe(true);
  });

  it("uses the user's key for the request, so the operator is not charged", async () => {
    await exhaust("nvidia");
    await exhaust("openrouter");
    const before = (await import("@/lib/quota")).readUsage;

    for await (const _ of streamChatEvents({
      modelId: "two-route",
      messages: [{ role: "user", content: "hi" }],
      userKeys: { nvidia: "nvapi-mine" },
    } as Parameters<typeof streamChatEvents>[0])) {
      // drain
    }

    const { counterKey } = await import("@/lib/quota");
    const usage = await before("operator", ["nvidia"]);
    // Still exactly the spend the test seeded — the rescued turn added nothing.
    const rpd = quotaFor(PROVIDERS.nvidia).find((q) => q.unit === "requests")!.limit;
    expect(usage.get(counterKey("nvidia", "day", "requests"))).toBe(rpd);
  });

  it("still refuses when the user has no key for any exhausted lane", async () => {
    await exhaust("nvidia");
    await exhaust("openrouter");
    await expect(
      (async () => {
        for await (const _ of streamChatEvents({
          modelId: "two-route",
          messages: [{ role: "user", content: "hi" }],
          userKeys: { groq: "gsk_unrelated" },
        } as Parameters<typeof streamChatEvents>[0])) {
          // drain
        }
      })(),
    ).rejects.toMatchObject({ code: "quota_exhausted" });
  });
});

describe("recording spend", () => {
  it("counts a committed request against the lane that served it", async () => {
    await drain();
    // Second turn should still work, but the counter must have moved: spend the
    // rest of the window and confirm the lane drops out one request early.
    const rpm = quotaFor(PROVIDERS.nvidia).find(
      (q) => q.kind === "minute" && q.unit === "requests",
    );
    const budget = rpm?.limit ?? quotaFor(PROVIDERS.nvidia).find((q) => q.unit === "requests")!.limit;
    for (let i = 0; i < budget - 1; i++) await bumpUsage("operator", "nvidia", {});

    scriptFetch();
    await drain();
    expect(seen.some((u) => u.includes("nvidia"))).toBe(false);
  });

  it("adopts the provider's own count when its headers disagree with ours", async () => {
    // The reconciliation path: Atlas has counted one request, the provider says
    // the key is already spent. Provider truth wins, and the lane goes.
    scriptFetch({ "x-ratelimit-remaining-requests": "0", "x-ratelimit-limit-requests": "1000" });
    await drain();

    scriptFetch();
    await drain();
    expect(seen.some((u) => u.includes("nvidia"))).toBe(false);
    expect(seen.some((u) => u.includes("openrouter"))).toBe(true);
  });

  // Token ceilings are not decoration: Groq caps at 30k tokens/minute and
  // Mistral's entire free tier is stated as tokens per month. Counting requests
  // only would leave those meters reading zero forever.
  it("counts the tokens the stream reported, not just the request", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      seen.push(String(url));
      return new Response(
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
          'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":40,"completion_tokens":60}}\n\n' +
          "data: [DONE]\n\n",
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await drain();

    const { readUsage, counterKey } = await import("@/lib/quota");
    const usage = await readUsage("operator", ["nvidia"]);
    expect(usage.get(counterKey("nvidia", "day", "requests"))).toBe(1);
    expect(usage.get(counterKey("nvidia", "day", "tokens"))).toBe(100);
  });

  it("counts a split usage report once, not once per frame", async () => {
    // Anthropic sends prompt tokens on `message_start` and completion tokens on
    // `message_delta`. Adding every frame would double-count a provider that
    // reports cumulative totals instead, so the running maximum per field is
    // what gets recorded.
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      seen.push(String(url));
      return new Response(
        'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":40}}\n\n' +
          'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
          'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":40,"completion_tokens":60}}\n\n' +
          "data: [DONE]\n\n",
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await drain();

    const { readUsage, counterKey } = await import("@/lib/quota");
    const usage = await readUsage("operator", ["nvidia"]);
    expect(usage.get(counterKey("nvidia", "day", "tokens"))).toBe(100);
  });

  it("never counts a request that ran on the user's own key", async () => {
    resetLedgerMemory();
    delete process.env.NVIDIA_API_KEY;
    scriptFetch();

    for await (const _ of streamChatEvents({
      modelId: "two-route",
      messages: [{ role: "user", content: "hi" }],
      userKeys: { nvidia: "nvapi-mine" },
    } as Parameters<typeof streamChatEvents>[0])) {
      // drain
    }
    expect(seen.some((u) => u.includes("nvidia"))).toBe(true);

    // Their key, their quota: the operator's ledger must be untouched, so the
    // very next operator-funded turn still sees a full allowance.
    const { readUsage, counterKey } = await import("@/lib/quota");
    const usage = await readUsage("operator", ["nvidia"]);
    expect(usage.get(counterKey("nvidia", "day", "requests"))).toBeUndefined();
  });
});
