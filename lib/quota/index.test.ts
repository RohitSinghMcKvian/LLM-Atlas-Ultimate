import { beforeEach, describe, expect, it } from "vitest";
import { PROVIDERS } from "@/lib/catalog/providers";
import {
  bumpUsage,
  dropExhausted,
  laneQuotas,
  meterableLanes,
  quotaFor,
  resetLedgerMemory,
  type MeterableRoute,
} from "./index";

const NOW = Date.parse("2026-09-10T13:47:30.000Z");

// Groq's table entry is `rpm: 30, rpd: 1000` — a recurring tier, so meterable.
const GROQ_RPM = 30;

const route = (provider: MeterableRoute["provider"], operatorFunded = true): MeterableRoute => ({
  provider,
  operatorFunded,
});

/** Spend a lane's per-minute allowance. */
async function exhaustMinute(lane: "groq", n = GROQ_RPM) {
  for (let i = 0; i < n; i++) await bumpUsage("operator", lane, {}, NOW);
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  resetLedgerMemory();
});

describe("meterableLanes", () => {
  it("keeps providers with a recurring free tier", () => {
    expect(meterableLanes(["groq"])).toEqual(["groq"]);
  });

  it("drops providers with no countable allowance", () => {
    // Anthropic and OpenAI have no free tier; a grant has no window.
    expect(meterableLanes(["anthropic", "openai", "local"])).toEqual([]);
  });

  it("de-duplicates repeated lanes", () => {
    expect(meterableLanes(["groq", "groq"])).toEqual(["groq"]);
  });
});

describe("laneQuotas", () => {
  it("fills the table's ceilings in with recorded spend", async () => {
    await bumpUsage("operator", "groq", {}, NOW);
    const map = await laneQuotas(["groq"], NOW);
    const minute = map.get("groq")!.find((q) => q.kind === "minute" && q.unit === "requests")!;
    expect(minute.limit).toBe(GROQ_RPM);
    expect(minute.used).toBe(1);
    expect(minute.resetsAt).toBe(Date.parse("2026-09-10T13:48:00.000Z"));
  });

  it("reports zero use for a lane nothing has been spent on", async () => {
    const map = await laneQuotas(["groq"], NOW);
    expect(map.get("groq")!.every((q) => q.used === 0)).toBe(true);
  });

  it("has no entry for an unmeterable lane", async () => {
    expect((await laneQuotas(["anthropic"], NOW)).size).toBe(0);
  });
});

describe("dropExhausted", () => {
  it("keeps every candidate while allowance remains", async () => {
    const routes = [route("groq"), route("nvidia")];
    const { keep, blocked, retryAfterMs } = await dropExhausted(routes, NOW);
    expect(keep).toEqual(routes);
    expect(blocked).toEqual([]);
    expect(retryAfterMs).toBe(0);
  });

  // The behaviour the whole phase exists for: skipped, not attempted.
  it("removes a lane once its window is spent", async () => {
    await exhaustMinute("groq");
    const { keep, blocked, retryAfterMs } = await dropExhausted(
      [route("groq"), route("nvidia")],
      NOW,
    );
    expect(keep.map((r) => r.provider)).toEqual(["nvidia"]);
    expect(blocked).toEqual(["groq"]);
    // The minute window frees up 30s later.
    expect(retryAfterMs).toBe(30_000);
  });

  // The BYOK guarantee. The operator's ledger has no authority over a request
  // that spends the user's own allowance.
  it("never blocks a route carrying the user's own key", async () => {
    await exhaustMinute("groq");
    const { keep, blocked } = await dropExhausted([route("groq", false)], NOW);
    expect(keep.map((r) => r.provider)).toEqual(["groq"]);
    expect(blocked).toEqual([]);
  });

  it("blocks the operator's route but keeps the user's on the same lane", async () => {
    await exhaustMinute("groq");
    const { keep } = await dropExhausted([route("groq", true), route("groq", false)], NOW);
    expect(keep).toHaveLength(1);
    expect(keep[0].operatorFunded).toBe(false);
  });

  it("preserves failover order among the survivors", async () => {
    await exhaustMinute("groq");
    const { keep } = await dropExhausted(
      [route("nvidia"), route("groq"), route("openrouter")],
      NOW,
    );
    expect(keep.map((r) => r.provider)).toEqual(["nvidia", "openrouter"]);
  });

  it("can empty the candidate list, which is the caller's cue to refuse", async () => {
    await exhaustMinute("groq");
    const { keep, retryAfterMs } = await dropExhausted([route("groq")], NOW);
    expect(keep).toEqual([]);
    expect(retryAfterMs).toBeGreaterThan(0);
  });

  it("lets the lane back in once the window rolls over", async () => {
    await exhaustMinute("groq");
    const after = await dropExhausted([route("groq")], NOW + 60_000);
    expect(after.keep).toHaveLength(1);
    expect(after.blocked).toEqual([]);
  });

  it("leaves lanes with no countable quota alone entirely", async () => {
    // Anthropic can never be ledger-blocked: there is no allowance to spend.
    const routes = [route("anthropic")];
    expect((await dropExhausted(routes, NOW)).keep).toEqual(routes);
  });

  it("does not mutate the routes it was given", async () => {
    const routes = [route("groq"), route("nvidia")];
    const snapshot = JSON.stringify(routes);
    await exhaustMinute("groq");
    await dropExhausted(routes, NOW);
    expect(JSON.stringify(routes)).toBe(snapshot);
  });
});

describe("the provider table and the ledger agree", () => {
  it("meters exactly the providers whose free tier is recurring", () => {
    for (const meta of Object.values(PROVIDERS)) {
      const countable = quotaFor(meta).length > 0;
      const recurring = meta.freeTier?.quota.kind === "recurring";
      // A recurring tier with no stated numbers is legal but uncountable, so
      // the implication only runs one way.
      if (countable) expect(recurring).toBe(true);
    }
  });
});
