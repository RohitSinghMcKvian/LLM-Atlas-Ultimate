import { describe, it, expect } from "vitest";
import { makeModel } from "../__fixtures__/snapshots";
import { BASELINE_SNAPSHOT } from "../baseline";
import type { CatalogSnapshotRecord, CatalogSourceResult } from "../snapshot";
import { modelAccess } from "../stats";
import type { CatalogModel } from "../types";
import { STRIKE_LIMIT, healthKey } from "./probe";
import { NVIDIA_SAMPLE, OPENROUTER_SAMPLE } from "./__fixtures__/providers";
import { REMOVAL_GRACE_SYNCS, ROUTE_PRIORITY, mergeSnapshot, type MergeInput } from "./merge";
import { normalizeNvidia } from "./nvidia";
import { normalizeOpenRouter } from "./openrouter";

// Reconciliation is where a bug is most expensive: it decides what disappears
// from the product. These tests exist mostly to pin the *refusals* — the cases
// where the engine must decline to remove something.

const NOW = "2026-07-25T04:00:00.000Z";
const LATER = "2026-07-26T04:00:00.000Z";
const LATER_STILL = "2026-07-27T04:00:00.000Z";

const OK: CatalogSourceResult = { status: "ok", count: 10 };
const FAILED: CatalogSourceResult = { status: "failed", count: 0, error: "503" };

const drafts = () => normalizeOpenRouter(OPENROUTER_SAMPLE, { today: NOW.slice(0, 10) });
const nvChat = () => normalizeNvidia(NVIDIA_SAMPLE).chat;

/** A small curated overlay big enough to clear the "never below baseline" gate. */
function overlayOf(...models: CatalogModel[]): CatalogModel[] {
  return models;
}

function merge(over: Partial<MergeInput> = {}): CatalogSnapshotRecord {
  return mergeSnapshot({
    overlay: [],
    openrouter: drafts(),
    nvidia: nvChat(),
    previous: null,
    sources: { openrouter: OK, nvidia: OK },
    now: NOW,
    ...over,
  });
}

const byId = (record: CatalogSnapshotRecord) => new Map(record.models.map((m) => [m.id, m]));

describe("basic assembly", () => {
  const record = merge();

  it("produces one entry per distinct model", () => {
    const ids = record.models.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("emits url-safe ids", () => {
    for (const m of record.models) expect(m.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });

  it("is sorted deterministically by brand then name", () => {
    const keys = record.models.map((m) => `${m.provider}|${m.name}`);
    expect(keys).toEqual([...keys].sort());
  });

  it("merges a model served by both providers into one entry with both routes", () => {
    const llama = byId(record).get("llama-3-3-70b-instruct")!;
    expect(llama).toBeDefined();
    expect(llama.routes.map((r) => r.provider)).toEqual(["nvidia", "openrouter"]);
  });

  it("orders routes by failover priority, free tier first", () => {
    for (const m of record.models) {
      const ranks = m.routes.map((r) => ROUTE_PRIORITY.indexOf(r.provider));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
    const deepseek = byId(record).get("deepseek-v4-pro")!;
    expect(deepseek.routes[0].model).toContain(":free");
  });

  it("withholds an unprobed NVIDIA-only model", () => {
    // NIM lists models the account cannot actually invoke — 9 of 11 sampled
    // answered 404. An entry that fails the moment it is selected is worse than
    // one we do not offer yet, so it waits for a liveness verdict.
    expect(byId(record).get("llama-3-3-nemotron-super-49b-v1-5")).toBeUndefined();
  });

  it("adds a NVIDIA-only model once a probe confirms it", () => {
    const probed = merge({
      routeHealth: {
        "nvidia/llama-3.3-nemotron-super-49b-v1.5": { ok: true, checkedAt: NOW },
      },
    });
    const nemotron = byId(probed).get("llama-3-3-nemotron-super-49b-v1-5")!;
    expect(nemotron).toBeDefined();
    expect(modelAccess(nemotron)).toBe("free");
    expect(nemotron.metaConfidence).toBe("derived");
    expect(nemotron.routes).toEqual([
      { provider: "nvidia", model: "nvidia/llama-3.3-nemotron-super-49b-v1.5" },
    ]);
  });

  it("keeps withholding one a probe rejected", () => {
    const probed = merge({
      routeHealth: {
        "nvidia/llama-3.3-nemotron-super-49b-v1.5": { ok: false, checkedAt: NOW },
      },
    });
    expect(byId(probed).get("llama-3-3-nemotron-super-49b-v1-5")).toBeUndefined();
  });

  it("never withholds a model OpenRouter corroborates", () => {
    // Cross-listed models need no probe: OpenRouter's listing is corroboration,
    // and the OpenRouter route works even if the NIM one does not.
    const llama = byId(record).get("llama-3-3-70b-instruct")!;
    expect(llama).toBeDefined();
    expect(llama.routes.some((r) => r.provider === "nvidia")).toBe(true);
  });

  it("marks a NIM-served model free even when OpenRouter charges for it", () => {
    // The operator's NIM key pays, so the user does not need one. Derived from
    // the surviving nvidia route — which means it stops being free the moment a
    // probe condemns that route, instead of claiming free forever.
    expect(modelAccess(byId(record).get("llama-3-3-70b-instruct")!)).toBe("free");
  });
});

describe("the curated overlay wins where it should", () => {
  const curated = makeModel({
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    provider: "DeepSeek",
    family: "DeepSeek V4",
    license: "open",
    access: "byok",
    trending: true,
    releaseDate: "2025-11-01",
    contextWindow: 163_840,
    maxOutput: 32_768,
    blurb: "A hand-written blurb that no provider API could produce.",
    benchmarks: [
      {
        key: "gpqa",
        score: 81.2,
        source: "DeepSeek",
        sourceUrl: "https://deepseek.com",
        measuredAt: "2026-01-01",
      },
      {
        key: "aa-intelligence",
        score: 99,
        source: "Curated",
        sourceUrl: "https://example.test",
        measuredAt: "2026-01-01",
      },
    ],
    latencyMs: 480,
    throughputTps: 95,
    rating: 4.8,
    tags: ["curated-tag"],
    routes: [{ provider: "openrouter", model: "deepseek/deepseek-v4-pro" }],
  });

  const record = merge({ overlay: overlayOf(curated) });
  const merged = byId(record).get("deepseek-v4-pro")!;

  it("keeps the curated id verbatim", () => {
    // This is what preserves /chat?model=…, persisted store values, and every
    // default-model constant across a regenerated catalog.
    expect(merged.id).toBe("deepseek-v4-pro");
  });

  it("keeps editorial fields the provider cannot know", () => {
    expect(merged.blurb).toBe(curated.blurb);
    expect(merged.name).toBe("DeepSeek V4 Pro");
    expect(merged.family).toBe("DeepSeek V4");
    expect(merged.trending).toBe(true);
    expect(merged.latencyMs).toBe(480);
    expect(merged.throughputTps).toBe(95);
    expect(merged.rating).toBe(4.8);
    expect(merged.releaseDate).toBe("2025-11-01");
  });

  it("does not carry the legacy access tier onto the merged model", () => {
    // The field is no longer written at all. It was audited when every free model
    // was NVIDIA-served and went stale once live OpenRouter routes arrived: 38
    // entries claimed "free" while their only live route answered 402. Access is
    // derived from `routes` — see `lib/catalog/availability.ts`.
    expect(merged.access).toBeUndefined();
  });

  it("derives access from the surviving routes", () => {
    // The upstream fixture lists a `deepseek/deepseek-v4-pro:free` variant, so
    // the merged model genuinely does have a zero-cost route — free is correct
    // here *because of the route*, not because the overlay asserted it.
    expect(merged.routes.some((r) => r.model.endsWith(":free"))).toBe(true);
    expect(modelAccess(merged)).toBe("free");
  });

  it("lets curated benchmark scores win, while keeping synced-only keys", () => {
    const scores = new Map(merged.benchmarks.map((b) => [b.key, b.score]));
    expect(scores.get("gpqa")).toBe(81.2);
    expect(scores.get("aa-intelligence")).toBe(99); // curated overrides the synced 58.2
    expect(scores.get("aa-coding")).toBe(71); // synced-only key survives
  });

  it("takes live pricing and routes from the provider", () => {
    expect(merged.pricing.inputPerM).toBe(0.4);
    expect(merged.routes.map((r) => r.model)).toEqual([
      "deepseek/deepseek-v4-pro:free",
      "deepseek/deepseek-v4-pro",
    ]);
  });

  it("unions tags", () => {
    expect(merged.tags).toContain("curated-tag");
    expect(merged.tags).toContain("open");
  });
});

describe("curated entries the sync cannot verify", () => {
  const googleOnly = makeModel({
    id: "gemini-3-1-flash-lite",
    name: "Gemini 3.1 Flash Lite",
    provider: "Google",
    routes: [{ provider: "google", model: "gemini-3.1-flash-lite" }],
  });
  const groqOnly = makeModel({
    id: "groq-compound",
    name: "Groq Compound",
    provider: "Groq",
    routes: [{ provider: "groq", model: "compound-beta" }],
  });
  const upcoming = makeModel({
    id: "llama-5",
    name: "Llama 5",
    provider: "Meta",
    status: "upcoming",
    routes: [],
  });

  const record = merge({ overlay: overlayOf(googleOnly, groqOnly, upcoming) });

  it("keeps google/groq/local-routed models — absence is not evidence", () => {
    // Neither provider list can be enumerated, so a missing entry means nothing.
    for (const original of [googleOnly, groqOnly]) {
      const kept = byId(record).get(original.id)!;
      expect(kept).toBeDefined();
      expect(kept.status).toBe("ga");
      expect(kept.routes).toEqual(original.routes);
      expect({ ...kept, addedAt: undefined }).toEqual({ ...original, addedAt: undefined });
    }
  });

  it("keeps upcoming models, which were never expected in a provider list", () => {
    const kept = byId(record).get("llama-5")!;
    expect(kept).toBeDefined();
    expect(kept.status).toBe("upcoming");
    expect(kept.routes).toEqual([]);
    // Every model carries an addedAt; nothing else about it may change.
    expect({ ...kept, addedAt: undefined }).toEqual({ ...upcoming, addedAt: undefined });
  });

  it("promotes an upcoming model the moment a provider starts serving it", () => {
    const announced = makeModel({
      id: "claude-opus-5",
      name: "Claude Opus 5",
      provider: "Anthropic",
      status: "upcoming",
      routes: [],
    });
    const promoted = byId(merge({ overlay: overlayOf(announced) })).get("claude-opus-5")!;
    expect(promoted.status).toBe("ga");
    expect(promoted.routes.length).toBeGreaterThan(0);
  });
});

describe("removal grace period", () => {
  const retiring = makeModel({
    id: "old-model",
    name: "Old Model",
    provider: "Acme",
    routes: [{ provider: "openrouter", model: "acme/old-model" }],
  });

  const first = merge({ overlay: overlayOf(retiring) });

  it("first absence deprecates and unroutes, but does not delete", () => {
    const model = byId(first).get("old-model")!;
    expect(model).toBeDefined();
    expect(model.status).toBe("deprecated");
    expect(model.routes).toEqual([]);
    expect(first.missCount["old-model"]).toBe(1);
    expect(first.tombstones).toEqual([]);
  });

  it("a deprecated model is hidden from pickers but kept in the catalog", () => {
    // `isSelectable` (and therefore every picker selector) excludes it, while
    // the leaderboard still lists it.
    expect(first.models.some((m) => m.id === "old-model")).toBe(true);
    expect(first.stats.deprecated).toBeGreaterThan(0);
  });

  it("second consecutive absence removes it entirely", () => {
    const second = merge({ overlay: [], previous: first, now: LATER });
    expect(byId(second).get("old-model")).toBeUndefined();
    expect(second.tombstones.map((t) => t.id)).toContain("old-model");
    expect(second.aliases["old-model"]).toBe("");
    expect(second.diff.some((d) => d.kind === "deprecation" && d.modelId === "old-model")).toBe(true);
  });

  it("takes exactly REMOVAL_GRACE_SYNCS consecutive misses", () => {
    expect(first.missCount["old-model"]).toBe(REMOVAL_GRACE_SYNCS - 1);
  });

  it("a model that comes back clears its counter", () => {
    const recovered = merge({ overlay: overlayOf(retiring), previous: first, now: LATER });
    // `retiring` is still absent from the provider lists, so use a model that
    // *is* present to prove recovery.
    const present = byId(recovered).get("llama-3-3-70b-instruct")!;
    expect(present.status).toBe("ga");
    expect(recovered.missCount["llama-3-3-70b-instruct"]).toBeUndefined();
  });
});

describe("a failed provider removes nothing", () => {
  const previous = merge();

  it("carries every OpenRouter-sourced model forward untouched", () => {
    const degraded = merge({
      openrouter: null,
      previous,
      sources: { openrouter: FAILED, nvidia: OK },
      now: LATER,
    });

    expect(degraded.tombstones).toEqual([]);
    for (const before of previous.models) {
      const after = byId(degraded).get(before.id);
      expect(after, `${before.id} was dropped after an OpenRouter failure`).toBeDefined();
      // No model may be *newly* deprecated; one already retired upstream stays so.
      expect(after!.status).toBe(before.status);
      expect(after!.routes).toEqual(before.routes);
    }
  });

  it("records the failure as a visible warning, not a silent log line", () => {
    const degraded = merge({
      openrouter: null,
      previous,
      sources: { openrouter: FAILED, nvidia: OK },
      now: LATER,
    });
    expect(degraded.warnings.join(" ")).toContain("openrouter");
  });

  it("keeps the previous catalog wholesale when both providers fail", () => {
    const dead = merge({
      openrouter: null,
      nvidia: null,
      previous,
      sources: { openrouter: FAILED, nvidia: FAILED },
      now: LATER,
    });
    expect(dead.models).toEqual(previous.models);
    expect(dead.warnings.some((w) => w.includes("No provider model list"))).toBe(true);
  });
});

describe("sanity gates", () => {
  const previous = merge();

  it("rejects a truncated response that would mass-deprecate the catalog", () => {
    // The dangerous shape: the provider answers 200 with a handful of models.
    // Catalog size barely moves (everything is carried into the grace period),
    // but almost every model silently leaves the pickers.
    const tiny = mergeSnapshot({
      overlay: BASELINE_SNAPSHOT.models,
      openrouter: drafts(),
      nvidia: null,
      previous: null,
      sources: { openrouter: OK, nvidia: { status: "skipped", count: 0 } },
      now: NOW,
    });
    expect(tiny.warnings.some((w) => w.includes("truncated provider response"))).toBe(true);
    expect(tiny.models.length).toBe(BASELINE_SNAPSHOT.models.length);
    expect(tiny.models.every((m) => m.status !== "deprecated")).toBe(true);
  });

  it("accepts the real first sync, where a handful of curated routes have gone stale", () => {
    // ~7 of the 97 curated entries have a route that no longer resolves. That is
    // normal drift and must not trip the gate.
    const overlay = BASELINE_SNAPSHOT.models;
    const stale = overlay.slice(0, 7);
    const live = overlay.slice(7).map((m, i) => ({
      atlasId: m.id,
      matchKey: m.id.replace(/[^a-z0-9]/g, ""),
      sourceProviders: ["openrouter" as const],
      aliasIds: [],
      model: { ...m, metaConfidence: "verified" as const },
    }));
    const record = mergeSnapshot({
      overlay,
      openrouter: live,
      nvidia: null,
      previous: null,
      sources: { openrouter: OK, nvidia: { status: "skipped", count: 0 } },
      now: NOW,
    });
    expect(record.warnings.filter((w) => w.includes("keeping the previous"))).toEqual([]);
    expect(record.models.length).toBeGreaterThanOrEqual(overlay.length);
    expect(stale.length).toBe(7);
  });

  it("rejects a sync that loses more than 20% of the catalog", () => {
    const shrunk = mergeSnapshot({
      overlay: [],
      openrouter: drafts().slice(0, 2),
      nvidia: null,
      previous,
      sources: { openrouter: OK, nvidia: { status: "skipped", count: 0 } },
      now: LATER,
    });
    expect(shrunk.warnings.some((w) => w.includes("keeping the previous catalog"))).toBe(true);
    expect(shrunk.models).toEqual(previous.models);
  });

  it("does not advance removal bookkeeping on a rejected run", () => {
    // Otherwise two rejected syncs in a row would silently delete the catalog.
    const shrunk = mergeSnapshot({
      overlay: [],
      openrouter: drafts().slice(0, 2),
      nvidia: null,
      previous,
      sources: { openrouter: OK, nvidia: { status: "skipped", count: 0 } },
      now: LATER,
    });
    expect(shrunk.missCount).toEqual(previous.missCount);
    expect(shrunk.tombstones).toEqual(previous.tombstones);
  });

  it("still records the attempt so a rejected run is observable", () => {
    const shrunk = mergeSnapshot({
      overlay: [],
      openrouter: drafts().slice(0, 2),
      nvidia: null,
      previous,
      sources: { openrouter: OK, nvidia: { status: "skipped", count: 0 } },
      now: LATER,
    });
    expect(shrunk.syncedAt).toBe(LATER);
    expect(shrunk.sources.openrouter?.status).toBe("ok");
  });

  it("rejects a catalog-wide price explosion (suspected unit change)", () => {
    // The shape of a provider switching from per-token to per-million quoting:
    // every price moves by orders of magnitude at once.
    const fillers = Array.from({ length: 30 }, (_, i) => makeDraft(i));
    const before = mergeSnapshot({
      overlay: [],
      openrouter: fillers,
      nvidia: null,
      previous: null,
      sources: { openrouter: OK },
      now: NOW,
    });

    const inflated = fillers.map((d) => ({
      ...d,
      model: {
        ...d.model,
        pricing: {
          ...d.model.pricing,
          inputPerM: d.model.pricing.inputPerM * 1_000_000,
          outputPerM: d.model.pricing.outputPerM * 1_000_000,
        },
      },
    }));

    const after = mergeSnapshot({
      overlay: [],
      openrouter: inflated,
      nvidia: null,
      previous: before,
      sources: { openrouter: OK },
      now: LATER,
    });

    expect(after.warnings.some((w) => w.includes("unit change"))).toBe(true);
    expect(after.models).toEqual(before.models);
  });
});

/** A priced draft, for gates that need more than the fixture's handful of models. */
function makeDraft(i: number) {
  return {
    atlasId: `filler-${i}`,
    matchKey: `filler${i}`,
    sourceProviders: ["openrouter" as const],
    aliasIds: [],
    model: {
      ...makeModel({ id: `filler-${i}`, name: `Filler ${i}` }),
      pricing: { inputPerM: 1, outputPerM: 2, effectiveFrom: NOW.slice(0, 10) },
      metaConfidence: "verified" as const,
    },
  };
}

describe("addedAt stability", () => {
  it("does not present the whole catalog as new on the first sync", () => {
    const first = merge();
    expect(first.diff).toEqual([]);
    expect(Object.keys(first.firstSeen).length).toBe(first.models.length);
  });

  it("keeps addedAt stable across resyncs", () => {
    const first = merge();
    const second = merge({ previous: first, now: LATER });
    for (const m of second.models) {
      const before = byId(first).get(m.id);
      if (before) expect(m.addedAt).toBe(before.addedAt);
    }
  });

  it("stamps a genuinely new model with today, and reports it once", () => {
    const first = mergeSnapshot({
      overlay: [],
      openrouter: drafts().filter((d) => d.atlasId !== "glm-5-turbo"),
      nvidia: nvChat(),
      previous: null,
      sources: { openrouter: OK, nvidia: OK },
      now: NOW,
    });
    const second = merge({ previous: first, now: LATER });

    const added = byId(second).get("glm-5-turbo")!;
    expect(added.addedAt).toBe(LATER.slice(0, 10));
    expect(second.diff.filter((d) => d.modelId === "glm-5-turbo" && d.kind === "new_model")).toHaveLength(1);
  });
});

describe("version hashing", () => {
  it("is identical for identical inputs", () => {
    expect(merge().version).toBe(merge().version);
  });

  it("is unchanged by a resync with no upstream change", () => {
    // Otherwise every daily sync would re-render every catalog consumer for
    // nothing, and every snapshot row would be a fresh 200 KB of storage.
    const first = merge();
    const second = merge({ previous: first, now: LATER });
    expect(second.version).toBe(first.version);
  });

  it("changes when a price moves", () => {
    const first = merge();
    const repriced = drafts().map((d) =>
      d.atlasId === "claude-opus-5"
        ? { ...d, model: { ...d.model, pricing: { ...d.model.pricing, inputPerM: 7 } } }
        : d,
    );
    const second = merge({ openrouter: repriced, previous: first, now: LATER });
    expect(second.version).not.toBe(first.version);
  });
});

describe("identity preservation", () => {
  it("reuses unchanged model objects so derivation caches stay warm", () => {
    const first = merge();
    const second = merge({ previous: first, now: LATER });
    const before = byId(first);
    let reused = 0;
    for (const m of second.models) {
      if (before.get(m.id) === m) reused++;
    }
    expect(reused).toBe(second.models.length);
  });
});

describe("diff reporting", () => {
  it("reports a price change with direction", () => {
    const first = merge();
    const repriced = drafts().map((d) =>
      d.atlasId === "claude-opus-5"
        ? { ...d, model: { ...d.model, pricing: { ...d.model.pricing, inputPerM: 2.5 } } }
        : d,
    );
    const second = merge({ openrouter: repriced, previous: first, now: LATER });
    const entry = second.diff.find((d) => d.modelId === "claude-opus-5" && d.kind === "price_change");
    expect(entry).toBeDefined();
    expect(entry!.detail).toContain("down");
  });

  it("ignores price noise below the reporting threshold", () => {
    const first = merge();
    const nudged = drafts().map((d) =>
      d.atlasId === "claude-opus-5"
        ? { ...d, model: { ...d.model, pricing: { ...d.model.pricing, inputPerM: 5.001 } } }
        : d,
    );
    const second = merge({ openrouter: nudged, previous: first, now: LATER });
    expect(second.diff.some((d) => d.kind === "price_change")).toBe(false);
  });
});

describe("aliases", () => {
  const record = merge();

  it("maps a date-stamped canonical slug to the live id", () => {
    expect(record.aliases["claude-opus-5-20260601"]).toBe("claude-opus-5");
  });

  it("needs no alias for a :free variant — it normalizes to the base id already", () => {
    expect(byId(record).has("deepseek-v4-pro")).toBe(true);
    expect(byId(record).has("deepseek-v4-pro-free")).toBe(false);
  });

  it("never aliases an id to itself", () => {
    for (const [from, to] of Object.entries(record.aliases)) {
      expect(from).not.toBe(to);
    }
  });

  it("resolves every non-empty alias to a real model", () => {
    const ids = new Set(record.models.map((m) => m.id));
    for (const to of Object.values(record.aliases)) {
      if (to) expect(ids.has(to)).toBe(true);
    }
  });

  it("accumulates across syncs so old links keep working", () => {
    const second = merge({ previous: record, now: LATER_STILL });
    for (const key of Object.keys(record.aliases)) {
      expect(second.aliases).toHaveProperty(key);
    }
  });
});

describe("stats", () => {
  it("agrees with the model list", () => {
    const record = merge();
    expect(record.stats.models).toBe(record.models.length);
    expect(record.stats.free + record.stats.byok + record.stats.upcoming + record.stats.deprecated).toBe(
      record.models.length,
    );
  });
});

describe("access no longer comes from the overlay", () => {
  // The measured defect, reproduced: a curated entry hand-labelled `free` whose
  // only live route is a metered OpenRouter endpoint. It answered 402 in
  // production while the picker advertised it as free.
  const curated = makeModel({
    id: "command-a",
    name: "Command A",
    access: "free",
    license: "proprietary",
    pricing: { inputPerM: 2.5, outputPerM: 10, effectiveFrom: "2026-01-01" },
    routes: [{ provider: "openrouter", model: "cohere/command-a" }],
  });

  it("derives byok despite the curated free label", () => {
    const record = mergeSnapshot({
      overlay: overlayOf(curated),
      openrouter: [
        {
          atlasId: "command-a",
          matchKey: "commanda",
          aliasIds: [],
          sourceProviders: ["openrouter"],
          model: makeModel({
            id: "command-a",
            license: "proprietary",
            pricing: { inputPerM: 2.5, outputPerM: 10, effectiveFrom: "2026-01-01" },
            routes: [{ provider: "openrouter", model: "cohere/command-a" }],
          }),
        },
      ],
      nvidia: [],
      previous: null,
      sources: { openrouter: OK, nvidia: OK },
      now: NOW,
    });
    const merged = byId(record).get("command-a")!;
    expect(merged.access).toBeUndefined();
    expect(modelAccess(merged)).toBe("byok");
  });

  it("does not let a NIM listing alone force a model free", () => {
    // A NIM *listing* is not a guarantee — 11 listed routes answered 404. The
    // route is attached (so it can be probed and failed over), but nothing
    // stamps `access` any more.
    const record = merge();
    for (const m of record.models) expect(m.access).toBeUndefined();
  });
});

describe("route health prunes dead routes", () => {
  const nvidiaId = nvChat()[0].id;

  it("drops a route a probe condemned", () => {
    const clean = merge();
    const before = byId(clean)
      .get(
        clean.models.find((m) => m.routes.some((r) => r.provider === "nvidia"))!.id,
      )!
      .routes.filter((r) => r.provider === "nvidia").length;
    expect(before).toBeGreaterThan(0);

    const pruned = merge({
      routeHealth: { [healthKey("nvidia", nvidiaId)]: { ok: false, checkedAt: NOW } },
    });
    for (const m of pruned.models) {
      expect(m.routes.some((r) => r.provider === "nvidia" && r.model === nvidiaId)).toBe(false);
    }
  });

  it("keeps a route that only accumulated one strike", () => {
    const record = merge({
      routeHealth: {
        [healthKey("nvidia", nvidiaId)]: {
          ok: true,
          checkedAt: NOW,
          strikes: STRIKE_LIMIT - 1,
        },
      },
    });
    const kept = record.models.some((m) =>
      m.routes.some((r) => r.provider === "nvidia" && r.model === nvidiaId),
    );
    expect(kept).toBe(true);
  });

  it("reads a pre-migration bare-id health key", () => {
    const record = merge({ routeHealth: { [nvidiaId]: { ok: false, checkedAt: NOW } } });
    for (const m of record.models) {
      expect(m.routes.some((r) => r.provider === "nvidia" && r.model === nvidiaId)).toBe(false);
    }
  });
});

describe("the denylist withdraws already-published entries", () => {
  it("tombstones a carried-forward meta-router instead of re-admitting it", () => {
    const previous = {
      ...merge(),
      models: [
        ...merge().models,
        makeModel({
          id: "auto",
          name: "Auto Router",
          routes: [{ provider: "openrouter", model: "openrouter/auto" }],
        }),
      ],
    } as CatalogSnapshotRecord;

    const next = merge({ previous, now: LATER });
    expect(next.models.some((m) => m.id === "auto")).toBe(false);
    expect(next.tombstones.some((t) => t.id === "auto" && t.reason === "non_chat")).toBe(true);
    // Resolvable to nothing, so a stale link degrades to the fallback model.
    expect(next.aliases).toHaveProperty("auto", "");
  });

  it("tombstones a carried-forward media model by its upstream route", () => {
    const previous = {
      ...merge(),
      models: [
        ...merge().models,
        makeModel({
          id: "lyria-3-pro-preview",
          name: "Lyria 3 Pro",
          routes: [{ provider: "openrouter", model: "google/lyria-3-pro-preview" }],
        }),
      ],
    } as CatalogSnapshotRecord;

    const next = merge({ previous, now: LATER });
    expect(next.models.some((m) => m.id === "lyria-3-pro-preview")).toBe(false);
    expect(next.tombstones.some((t) => t.reason === "non_chat")).toBe(true);
  });

  it("leaves real models alone", () => {
    const record = merge();
    expect(record.tombstones.filter((t) => t.reason === "non_chat")).toHaveLength(0);
  });
});

describe("route ordering", () => {
  it("sends a provider missing from ROUTE_PRIORITY to the back, not the front", () => {
    // `indexOf` returns -1 for an unknown provider, which used to sort it ahead
    // of nvidia and hand it the first failover slot.
    expect(ROUTE_PRIORITY[0]).toBe("nvidia");
    const record = merge();
    for (const m of record.models) {
      const ranks = m.routes.map((r) => {
        const i = ROUTE_PRIORITY.indexOf(r.provider);
        return i === -1 ? 99 : i;
      });
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });
});
