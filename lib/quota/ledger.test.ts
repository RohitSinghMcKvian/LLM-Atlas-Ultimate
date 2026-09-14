import { beforeEach, describe, expect, it } from "vitest";
import { bumpUsage, counterKey, readUsage, resetLedgerMemory } from "./ledger";

// The in-process tier. Supabase is deliberately not configured here: this is
// exactly the deployment the fallback exists for, and it is the tier every
// self-hosted install actually runs on.

const NOW = Date.parse("2026-09-10T13:47:30.000Z");
const MINUTE = 60_000;
const DAY = 86_400_000;

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  resetLedgerMemory();
});

describe("bumpUsage / readUsage", () => {
  it("records a request against every window at once", async () => {
    await bumpUsage("operator", "groq", {}, NOW);
    const usage = await readUsage("operator", ["groq"], NOW);
    expect(usage.get(counterKey("groq", "minute", "requests"))).toBe(1);
    expect(usage.get(counterKey("groq", "day", "requests"))).toBe(1);
    expect(usage.get(counterKey("groq", "month", "requests"))).toBe(1);
  });

  it("accumulates across calls", async () => {
    for (let i = 0; i < 3; i++) await bumpUsage("operator", "groq", { tokens: 100 }, NOW);
    const usage = await readUsage("operator", ["groq"], NOW);
    expect(usage.get(counterKey("groq", "day", "requests"))).toBe(3);
    expect(usage.get(counterKey("groq", "day", "tokens"))).toBe(300);
  });

  it("keeps lanes and subjects separate", async () => {
    await bumpUsage("operator", "groq", {}, NOW);
    await bumpUsage("operator", "nvidia", {}, NOW);
    await bumpUsage("someone-else", "groq", {}, NOW);

    const operator = await readUsage("operator", ["groq", "nvidia"], NOW);
    expect(operator.get(counterKey("groq", "day", "requests"))).toBe(1);
    expect(operator.get(counterKey("nvidia", "day", "requests"))).toBe(1);

    const other = await readUsage("someone-else", ["groq"], NOW);
    expect(other.get(counterKey("groq", "day", "requests"))).toBe(1);
  });

  // The property that makes the whole ledger self-healing: nothing has to
  // actively reset a counter, because the next window simply has no row.
  it("starts from zero in the next window without any cleanup", async () => {
    await bumpUsage("operator", "groq", { tokens: 50 }, NOW);

    const nextMinute = await readUsage("operator", ["groq"], NOW + MINUTE);
    expect(nextMinute.get(counterKey("groq", "minute", "requests"))).toBeUndefined();
    // The longer windows containing both instants still hold the spend.
    expect(nextMinute.get(counterKey("groq", "day", "requests"))).toBe(1);

    const nextDay = await readUsage("operator", ["groq"], NOW + DAY);
    expect(nextDay.get(counterKey("groq", "day", "requests"))).toBeUndefined();
    expect(nextDay.get(counterKey("groq", "month", "requests"))).toBe(1);
  });

  it("omits a counter that was never touched rather than reporting zero", async () => {
    const usage = await readUsage("operator", ["groq"], NOW);
    expect(usage.size).toBe(0);
    // Tokens stay absent when only requests were counted, so a request-only
    // provider never shows a fabricated token figure.
    await bumpUsage("operator", "groq", {}, NOW);
    const after = await readUsage("operator", ["groq"], NOW);
    expect(after.get(counterKey("groq", "day", "tokens"))).toBeUndefined();
  });

  it("returns an empty map when asked about no lanes", async () => {
    expect((await readUsage("operator", [], NOW)).size).toBe(0);
  });

  it("ignores a nonsensical token count instead of poisoning the counter", async () => {
    // A malformed usage frame must not make a lane read as exhausted forever.
    await bumpUsage("operator", "groq", { tokens: Number.NaN }, NOW);
    await bumpUsage("operator", "groq", { tokens: -500 }, NOW);
    const usage = await readUsage("operator", ["groq"], NOW);
    expect(usage.get(counterKey("groq", "day", "tokens"))).toBeUndefined();
    expect(usage.get(counterKey("groq", "day", "requests"))).toBe(2);
  });

  it("does not grow without bound as minute windows roll past", async () => {
    // Each distinct minute would otherwise leave three rows behind forever.
    for (let i = 0; i < 700; i++) await bumpUsage("operator", "groq", {}, NOW + i * MINUTE);
    // The sweep is size-triggered; what matters is that the live window is
    // still correct afterwards and old windows read as empty.
    const live = await readUsage("operator", ["groq"], NOW + 699 * MINUTE);
    expect(live.get(counterKey("groq", "minute", "requests"))).toBe(1);
    const old = await readUsage("operator", ["groq"], NOW);
    expect(old.get(counterKey("groq", "minute", "requests"))).toBeUndefined();
  });
});
