import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { BASELINE_SNAPSHOT } from "../baseline";
import { isSelectable, modelAccess } from "../stats";
import type { CatalogSnapshotRecord } from "../snapshot";
import { runSync } from "./index";

// End-to-end against the real NVIDIA NIM and OpenRouter endpoints.
//
// The fixture tests pin the rules; this one is the only thing that can catch a
// provider changing its payload shape underneath them. It is skipped unless keys
// are configured, so CI without secrets stays green.

/**
 * Minimal `.env.local` reader. The repo has no dotenv dependency and vitest does
 * not load Next's env files, so without this the test would silently skip for the
 * one developer most likely to want it: the one who already configured the app.
 */
function loadEnvLocal(): void {
  const file = path.resolve(__dirname, "../../../.env.local");
  if (!fs.existsSync(file)) return;

  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
}

loadEnvLocal();

const HAS_KEYS = Boolean(process.env.OPENROUTER_API_KEY || process.env.NVIDIA_API_KEY);

describe.skipIf(!HAS_KEYS)("live provider sync", () => {
  let record: CatalogSnapshotRecord;
  let excluded: string[];

  beforeAll(async () => {
    const result = await runSync({ probeBudget: 8 });
    record = result.record;
    excluded = result.excludedNonChat;
    expect(result.ok, `sync failed: ${JSON.stringify(record.sources)}`).toBe(true);
  }, 90_000);

  it("reaches both providers", () => {
    expect(record.sources.openrouter?.status).toBe("ok");
    expect(record.sources.nvidia?.status).toBe("ok");
  });

  it("was accepted by the sanity gates", () => {
    expect(record.warnings.filter((w) => w.includes("keeping the previous catalog"))).toEqual([]);
    expect(record.origin).toBe("synced");
  });

  it("produces substantially more models than the bundled catalog", () => {
    expect(record.models.length).toBeGreaterThan(BASELINE_SNAPSHOT.models.length);
    expect(record.models.length).toBeGreaterThan(300);
    expect(record.models.length).toBeLessThanOrEqual(600);
  });

  it("has no duplicate ids and every id is url-safe", () => {
    const ids = record.models.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });

  it("keeps every curated model that still has a live or unverifiable route", () => {
    // The whole point of the overlay: a regenerated catalog must not silently
    // drop hand-audited entries, and must not renumber their ids.
    const ids = new Set(record.models.map((m) => m.id));
    const missing = BASELINE_SNAPSHOT.models.filter((m) => !ids.has(m.id)).map((m) => m.id);
    expect(missing).toEqual([]);
  });

  it("gives every routable model a usable route", () => {
    for (const m of record.models) {
      if (!isSelectable(m)) continue;
      for (const r of m.routes) {
        expect(r.model, `${m.id} has an empty route model id`).toBeTruthy();
        expect(r.provider).toBeTruthy();
      }
    }
  });

  it("has finite, non-negative pricing everywhere", () => {
    for (const m of record.models) {
      expect(Number.isFinite(m.pricing.inputPerM), m.id).toBe(true);
      expect(Number.isFinite(m.pricing.outputPerM), m.id).toBe(true);
      expect(m.pricing.inputPerM, m.id).toBeGreaterThanOrEqual(0);
      expect(m.pricing.outputPerM, m.id).toBeGreaterThanOrEqual(0);
    }
  });

  it("has a sane context window and output cap everywhere", () => {
    for (const m of record.models) {
      if (m.status === "upcoming") continue;
      expect(m.contextWindow, m.id).toBeGreaterThan(0);
      expect(m.maxOutput, m.id).toBeGreaterThan(0);
      expect(m.maxOutput, m.id).toBeLessThanOrEqual(m.contextWindow);
    }
  });

  it("keeps the free tier honest — a paid model is never marked free", () => {
    // The billing rule: only NIM-routed models and genuinely $0 OpenRouter tiers.
    const ceiling = Number(process.env.ATLAS_FREE_OPEN_CEILING_PER_M ?? 0);
    for (const m of record.models) {
      if (modelAccess(m) !== "free") continue;
      const blended = (m.pricing.inputPerM * 3 + m.pricing.outputPerM) / 4;
      if (blended <= ceiling) continue;

      const servedFree =
        m.routes.some((r) => r.provider === "nvidia") ||
        m.routes.some((r) => r.model.endsWith(":free")) ||
        // Curated entries carry a hand-audited access tier.
        BASELINE_SNAPSHOT.models.some((c) => c.id === m.id);
      expect(servedFree, `${m.id} is free at $${blended.toFixed(2)}/Mtok with no free route`).toBe(true);
    }
  });

  it("excludes NVIDIA's non-chat endpoints", () => {
    expect(excluded.length).toBeGreaterThan(10);
    const ids = new Set(record.models.map((m) => m.id));
    for (const id of excluded) {
      const bare = id.split("/").pop()!.replace(/[._]/g, "-");
      expect(ids.has(bare), `non-chat endpoint ${id} leaked into the catalog`).toBe(false);
    }
  });

  it("carries Artificial Analysis scores for a meaningful share of the catalog", () => {
    const scored = record.models.filter((m) =>
      m.benchmarks.some((b) => b.key === "aa-intelligence"),
    );
    expect(scored.length).toBeGreaterThan(50);
  });

  it("never puts Design Arena Elo in the LMSYS arena column", () => {
    const curatedArena = new Map(
      BASELINE_SNAPSHOT.models.map((m) => [m.id, m.benchmarks.find((b) => b.key === "arena")?.score]),
    );
    for (const m of record.models) {
      const arena = m.benchmarks.find((b) => b.key === "arena");
      if (!arena) continue;
      // Any `arena` score present must be the curated one, untouched.
      expect(arena.score, m.id).toBe(curatedArena.get(m.id));
    }
  });

  it("is deterministic — the same previous and the same upstream hash identically", async () => {
    // Note this cannot compare run 1 with run 2: the grace period means a model
    // that went missing is deprecated on one run and removed on the next, which
    // is a real state change, not nondeterminism.
    const [a, b] = await Promise.all([runSync({ previous: record, probeBudget: 0 }), runSync({ previous: record, probeBudget: 0 })]);
    expect(a.record.version).toBe(b.record.version);
  }, 90_000);

  it("reaches a steady state where a resync changes nothing", async () => {
    const second = await runSync({ previous: record, probeBudget: 0 });
    const third = await runSync({ previous: second.record, probeBudget: 0 });
    expect(third.record.version).toBe(second.record.version);
    expect(third.record.diff).toEqual([]);
  }, 120_000);

  it("retires only a handful of curated models, and never a live one", async () => {
    // Curated entries are matched to provider listings by their recorded upstream
    // route id, so only genuinely dead routes should end up deprecated.
    const retired = record.models.filter(
      (m) => m.status === "deprecated" && BASELINE_SNAPSHOT.models.some((c) => c.id === m.id),
    );
    expect(
      retired.map((m) => m.id).length,
      `unexpectedly retiring: ${retired.map((m) => m.id).join(", ")}`,
    ).toBeLessThanOrEqual(10);
  });

  it("stays within the client payload budget", () => {
    // Measured target: ~30 KB gzipped for the wire snapshot. Uncompressed JSON is
    // the cheap proxy — if this balloons, `clampBlurb` is the first suspect.
    const bytes = JSON.stringify(record.models).length;
    expect(bytes).toBeLessThan(1_200_000);
  });
});
