import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUDGET,
  STRIKE_LIMIT,
  applyVerdict,
  classifyProbeResult,
  healthKey,
  isVerdictFresh,
  probeModels,
  readHealth,
  selectProbeTargets,
  type ProbeTarget,
  type RouteHealth,
} from "./probe";
import type { ProviderRuntime } from "@/lib/router";

// All pure except the last block, which stubs fetch. No network.

const NOW = "2026-07-26T12:00:00.000Z";
const now = Date.parse(NOW);
const day = 86_400_000;

describe("classifyProbeResult", () => {
  it("calls 2xx ok", () => {
    expect(classifyProbeResult({ status: 200 })).toBe("ok");
    expect(classifyProbeResult({ status: 204 })).toBe("ok");
  });

  it("calls 404/400/422 definitively dead", () => {
    // `404 Function not found` is what 11 published NVIDIA routes returned.
    expect(classifyProbeResult({ status: 404 })).toBe("dead");
    expect(classifyProbeResult({ status: 400 })).toBe("dead");
    expect(classifyProbeResult({ status: 422 })).toBe("dead");
  });

  it("treats a timeout or network error as inconclusive, not dead", () => {
    expect(classifyProbeResult({ error: "timeout" })).toBe("inconclusive");
    expect(classifyProbeResult({ error: "network" })).toBe("inconclusive");
  });

  it("treats 5xx as inconclusive", () => {
    expect(classifyProbeResult({ status: 500 })).toBe("inconclusive");
    expect(classifyProbeResult({ status: 503 })).toBe("inconclusive");
  });

  it("does not blame the model for a rate limit or a bad key", () => {
    expect(classifyProbeResult({ status: 429 })).toBe("rate_limited");
    expect(classifyProbeResult({ status: 401 })).toBe("rate_limited");
    expect(classifyProbeResult({ status: 403 })).toBe("rate_limited");
  });
});

describe("applyVerdict", () => {
  it("records a pass and clears strikes", () => {
    const e = applyVerdict({ ok: false, checkedAt: "2026-01-01", strikes: 1 }, "ok", NOW);
    expect(e).toEqual({ ok: true, checkedAt: NOW, strikes: 0, reason: "ok" });
  });

  it("retires a dead route immediately", () => {
    const e = applyVerdict(undefined, "dead", NOW);
    expect(e).toMatchObject({ ok: false, strikes: STRIKE_LIMIT, reason: "not_found" });
  });

  it("writes nothing for a rate limit or bad key", () => {
    expect(applyVerdict(undefined, "rate_limited", NOW)).toBeNull();
    expect(
      applyVerdict({ ok: true, checkedAt: "2026-01-01" }, "rate_limited", NOW),
    ).toBeNull();
  });

  // The fix for the old behaviour: a hang cached NO verdict, so the 7 hanging
  // NVIDIA models were re-probed on every run and never retired.
  it("writes an entry even when inconclusive", () => {
    const e = applyVerdict(undefined, "inconclusive", NOW, "timeout");
    expect(e).not.toBeNull();
    expect(e).toMatchObject({ strikes: 1, reason: "timeout" });
  });

  it("keeps a route alive after one ambiguous failure", () => {
    const e = applyVerdict(undefined, "inconclusive", NOW, "timeout");
    expect(e!.ok).toBe(true);
  });

  it("retires a route on the STRIKE_LIMIT-th consecutive failure", () => {
    let entry = applyVerdict(undefined, "inconclusive", NOW, "timeout");
    expect(entry!.ok).toBe(true);
    entry = applyVerdict(entry!, "inconclusive", NOW, "timeout");
    expect(entry!.strikes).toBe(STRIKE_LIMIT);
    expect(entry!.ok).toBe(false);
  });

  it("lets a recovered route reset and survive a later blip", () => {
    let entry = applyVerdict(undefined, "inconclusive", NOW, "timeout");
    entry = applyVerdict(entry!, "ok", NOW);
    expect(entry!.strikes).toBe(0);
    entry = applyVerdict(entry!, "inconclusive", NOW, "timeout");
    expect(entry!.ok).toBe(true);
  });
});

describe("health keys", () => {
  it("scopes by provider", () => {
    expect(healthKey("nvidia", "openai/gpt-oss-20b")).toBe("nvidia:openai/gpt-oss-20b");
    expect(healthKey("groq", "openai/gpt-oss-20b")).not.toBe(
      healthKey("nvidia", "openai/gpt-oss-20b"),
    );
  });

  it("reads pre-migration bare-id keys so verdicts are not lost", () => {
    const health: RouteHealth = { "meta/llama-3.3-70b-instruct": { ok: false, checkedAt: NOW } };
    expect(readHealth(health, "nvidia", "meta/llama-3.3-70b-instruct")?.ok).toBe(false);
  });

  it("prefers a provider-scoped entry over a bare one", () => {
    const health: RouteHealth = {
      "m": { ok: false, checkedAt: NOW },
      "nvidia:m": { ok: true, checkedAt: NOW },
    };
    expect(readHealth(health, "nvidia", "m")?.ok).toBe(true);
  });
});

describe("isVerdictFresh", () => {
  it("is false with no entry", () => {
    expect(isVerdictFresh(undefined, now)).toBe(false);
  });

  it("expires a pass after the recheck window", () => {
    expect(isVerdictFresh({ ok: true, checkedAt: new Date(now - 2 * day).toISOString() }, now)).toBe(
      true,
    );
    expect(
      isVerdictFresh({ ok: true, checkedAt: new Date(now - 30 * day).toISOString() }, now),
    ).toBe(false);
  });

  it("rejects an unparseable date rather than trusting it", () => {
    expect(isVerdictFresh({ ok: true, checkedAt: "not a date" }, now)).toBe(false);
  });
});

describe("selectProbeTargets", () => {
  const t = (provider: ProbeTarget["provider"], model: string): ProbeTarget => ({
    provider,
    model,
  });

  it("skips routes with a fresh verdict", () => {
    const health: RouteHealth = { "nvidia:a": { ok: true, checkedAt: NOW } };
    const out = selectProbeTargets([t("nvidia", "a"), t("nvidia", "b")], health, 10, now);
    expect(out.map((x) => x.model)).toEqual(["b"]);
  });

  it("honours the budget", () => {
    const targets = ["a", "b", "c", "d"].map((m) => t("nvidia", m));
    expect(selectProbeTargets(targets, {}, 2, now)).toHaveLength(2);
    expect(selectProbeTargets(targets, {}, 0, now)).toHaveLength(0);
  });

  // Decision 2: adding GROQ_API_KEY must converge in ONE run, not starve behind
  // a queue of stale NVIDIA rechecks.
  it("prioritises a provider with no cached verdicts at all", () => {
    const health: RouteHealth = {
      "nvidia:a": { ok: true, checkedAt: new Date(now - 30 * day).toISOString() },
      "nvidia:b": { ok: true, checkedAt: new Date(now - 29 * day).toISOString() },
    };
    const targets = [t("nvidia", "a"), t("nvidia", "b"), t("groq", "z")];
    const out = selectProbeTargets(targets, health, 1, now);
    expect(out).toEqual([t("groq", "z")]);
  });

  it("puts never-checked ids ahead of stale ones within a known provider", () => {
    const health: RouteHealth = {
      "nvidia:a": { ok: true, checkedAt: new Date(now - 30 * day).toISOString() },
    };
    const out = selectProbeTargets([t("nvidia", "a"), t("nvidia", "new")], health, 1, now);
    expect(out).toEqual([t("nvidia", "new")]);
  });
});

describe("probeModels", () => {
  const runtime: ProviderRuntime = {
    id: "nvidia",
    baseUrl: "https://nim.test/v1",
    headers: { "Content-Type": "application/json" },
  };

  function stub(byModel: Record<string, number>) {
    const hit: string[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      hit.push(body.model);
      return new Response("{}", { status: byModel[body.model] ?? 200 });
    }) as unknown as typeof fetch;
    return hit;
  }

  const real = globalThis.fetch;

  it("records a verdict per provider-scoped key", async () => {
    stub({ dead: 404, live: 200 });
    const out = await probeModels(
      [
        { provider: "nvidia", model: "live" },
        { provider: "nvidia", model: "dead" },
      ],
      { runtimes: { nvidia: runtime }, now: NOW, budget: { concurrency: 1 } },
    );
    globalThis.fetch = real;
    expect(out.health["nvidia:live"]).toMatchObject({ ok: true });
    expect(out.health["nvidia:dead"]).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("abandons the rest of a provider after a 429", async () => {
    const hit = stub({ a: 429, b: 200, c: 200 });
    const out = await probeModels(
      ["a", "b", "c"].map((model) => ({ provider: "nvidia" as const, model })),
      { runtimes: { nvidia: runtime }, now: NOW, budget: { concurrency: 1 } },
    );
    globalThis.fetch = real;
    expect(out.rateLimited).toEqual(["nvidia"]);
    // Only the rate-limited call was made; b and c were skipped.
    expect(hit).toEqual(["a"]);
    expect(Object.keys(out.health)).toHaveLength(0);
  });

  it("skips a target whose provider has no runtime", async () => {
    stub({});
    const out = await probeModels([{ provider: "groq", model: "x" }], {
      runtimes: { nvidia: runtime },
      now: NOW,
    });
    globalThis.fetch = real;
    expect(Object.keys(out.health)).toHaveLength(0);
  });

  it("caps at budget.max", async () => {
    const hit = stub({});
    await probeModels(
      ["a", "b", "c", "d"].map((model) => ({ provider: "nvidia" as const, model })),
      { runtimes: { nvidia: runtime }, now: NOW, budget: { max: 2, concurrency: 1 } },
    );
    globalThis.fetch = real;
    expect(hit).toHaveLength(2);
  });

  it("accumulates a strike against the previous health", async () => {
    stub({ flaky: 500 });
    const out = await probeModels([{ provider: "nvidia", model: "flaky" }], {
      runtimes: { nvidia: runtime },
      previousHealth: { "nvidia:flaky": { ok: true, checkedAt: "2026-01-01", strikes: 1 } },
      now: NOW,
    });
    globalThis.fetch = real;
    expect(out.health["nvidia:flaky"]).toMatchObject({ ok: false, strikes: 2 });
  });

  it("has a sane default budget", () => {
    expect(DEFAULT_BUDGET.max).toBeGreaterThan(DEFAULT_BUDGET.concurrency);
    expect(DEFAULT_BUDGET.timeoutMs).toBeLessThan(DEFAULT_BUDGET.ms);
  });
});
