import { describe, it, expect, beforeEach } from "vitest";
import { makeModel, makeSnapshot } from "./__fixtures__/snapshots";
import type { CatalogModel } from "./types";
import { installSnapshot, resetSnapshot } from "./snapshot";
import { NO_PROVIDERS, type RouteEnv } from "./availability";
import {
  BRAND_LIMIT,
  FREE_LIMIT,
  PER_BRAND_LIMIT,
  RECENT_LIMIT,
  firstPickable,
  pickerSections,
} from "./picker";

// The picker's contract, pinned.
//
// Two of these are load-bearing rather than cosmetic, and the rest of the app
// leans on them: nothing that is not free may appear under Free, and nothing the
// sync retired may appear anywhere. Everything else here is ordering and caps.

const OPERATOR: RouteEnv = { configured: ["nvidia", "openrouter"] };
const OPERATOR_WITH_KEY: RouteEnv = { ...OPERATOR, userOpenRouterKey: true };

/** A model served free by the operator's NVIDIA key. */
function freeModel(id: string, over: Partial<CatalogModel> = {}) {
  return makeModel({
    id,
    provider: "Meta",
    license: "open",
    routes: [{ provider: "nvidia", model: `meta/${id}` }],
    pricing: { inputPerM: 0, outputPerM: 0, effectiveFrom: "2026-01-01" },
    ...over,
  });
}

/** A metered OpenRouter model — free to nobody. */
function paidModel(id: string, brand: string, price: number, over: Partial<CatalogModel> = {}) {
  return makeModel({
    id,
    provider: brand,
    license: "proprietary",
    routes: [{ provider: "openrouter", model: `${brand.toLowerCase()}/${id}` }],
    pricing: { inputPerM: price, outputPerM: price * 4, effectiveFrom: "2026-01-01" },
    ...over,
  });
}

function score(id: string, value: number) {
  return {
    benchmarks: [
      { key: "mmlu", score: value, source: "t", sourceUrl: "https://t", measuredAt: "2026-01-01" },
    ],
  };
}

beforeEach(() => {
  resetSnapshot();
});

describe("free comes first, and only free is in it", () => {
  beforeEach(() => {
    installSnapshot(
      makeSnapshot([
        freeModel("free-a", score("free-a", 70)),
        freeModel("free-b", score("free-b", 60)),
        paidModel("paid-a", "Anthropic", 3, score("paid-a", 95)),
        paidModel("paid-b", "OpenAI", 2, score("paid-b", 90)),
      ]),
    );
  });

  it("puts every zero-cost model in `free` and nothing else", () => {
    const { free } = pickerSections(OPERATOR);
    expect(free.map((r) => r.model.id).sort()).toEqual(["free-a", "free-b"]);
    for (const row of free) expect(row.availability.kind).toBe("free");
  });

  it("never leaks a metered model into `free`, even a very capable one", () => {
    // `paid-a` outscores both free models; ordering must not promote it.
    for (const env of [NO_PROVIDERS, OPERATOR, OPERATOR_WITH_KEY]) {
      const { free } = pickerSections(env);
      expect(free.some((r) => r.model.id === "paid-a")).toBe(false);
      for (const row of free) expect(row.availability.kind).toBe("free");
    }
  });

  it("orders free by capability, strongest first", () => {
    expect(pickerSections(OPERATOR).free.map((r) => r.model.id)).toEqual(["free-a", "free-b"]);
  });

  it("shows paid models as BYOK whether or not the user has connected a key", () => {
    const withoutKey = pickerSections(OPERATOR);
    const withKey = pickerSections(OPERATOR_WITH_KEY);
    const brands = (s: typeof withKey) => s.byok.map((g) => g.brand).sort();
    expect(brands(withoutKey)).toEqual(["Anthropic", "OpenAI"]);
    expect(brands(withKey)).toEqual(["Anthropic", "OpenAI"]);
    // What changes is who pays, not whether it is offered.
    expect(withoutKey.byok[0].models[0].availability.kind).toBe("needs_key");
    expect(withKey.byok[0].models[0].availability.kind).toBe("your_key");
  });
});

describe("BYOK grouping", () => {
  beforeEach(() => {
    installSnapshot(
      makeSnapshot([
        freeModel("free-a"),
        paidModel("claude", "Anthropic", 3, score("claude", 95)),
        paidModel("claude-mini", "Anthropic", 1, score("claude-mini", 80)),
        paidModel("gpt", "OpenAI", 2, score("gpt", 92)),
        paidModel("cheap-1", "Volume", 1, score("cheap-1", 40)),
        paidModel("cheap-2", "Volume", 1, score("cheap-2", 39)),
        paidModel("cheap-3", "Volume", 1, score("cheap-3", 38)),
      ]),
    );
  });

  it("groups by brand", () => {
    const { byok } = pickerSections(OPERATOR);
    const anthropic = byok.find((g) => g.brand === "Anthropic");
    expect(anthropic?.models.map((r) => r.model.id)).toEqual(["claude", "claude-mini"]);
  });

  it("ranks brands by their best model, not by how many they have", () => {
    // Volume has the most models and the weakest; it must not lead.
    expect(pickerSections(OPERATOR).byok.map((g) => g.brand)).toEqual([
      "Anthropic",
      "OpenAI",
      "Volume",
    ]);
  });

  it("reports what a capped brand group is hiding", () => {
    const many = Array.from({ length: PER_BRAND_LIMIT + 4 }, (_, i) =>
      paidModel(`big-${i}`, "Wide", 1, score(`big-${i}`, 50 - i)),
    );
    installSnapshot(makeSnapshot([freeModel("free-a"), ...many], { version: "wide" }));

    const group = pickerSections(OPERATOR).byok.find((g) => g.brand === "Wide")!;
    expect(group.models).toHaveLength(PER_BRAND_LIMIT);
    expect(group.more).toBe(4);
  });

  it("caps how many brand groups render before the user types", () => {
    const models = Array.from({ length: BRAND_LIMIT + 5 }, (_, i) =>
      paidModel(`m-${i}`, `Brand${i}`, 1, score(`m-${i}`, 90 - i)),
    );
    installSnapshot(makeSnapshot([freeModel("free-a"), ...models], { version: "brands" }));
    expect(pickerSections(OPERATOR).byok).toHaveLength(BRAND_LIMIT);
  });
});

describe("retired models are gone", () => {
  beforeEach(() => {
    installSnapshot(
      makeSnapshot([
        freeModel("live"),
        // What the sync produces for a model the providers stopped serving:
        // deprecated, with its routes stripped.
        freeModel("retired", { status: "deprecated", routes: [] }),
        makeModel({ id: "announced", status: "upcoming", routes: [] }),
      ]),
    );
  });

  it("omits a deprecated model from every section", () => {
    const s = pickerSections(OPERATOR);
    const ids = [
      ...s.recent.map((r) => r.model.id),
      ...s.free.map((r) => r.model.id),
      ...s.byok.flatMap((g) => g.models.map((r) => r.model.id)),
    ];
    expect(ids).not.toContain("retired");
    expect(ids).not.toContain("announced");
    expect(ids).toContain("live");
  });

  it("omits it from a search too, so it cannot be typed back into existence", () => {
    const s = pickerSections(OPERATOR, { query: "retired" });
    expect(s.free).toEqual([]);
    expect(s.byok).toEqual([]);
  });

  it("drops it from recents rather than offering a dead pick", () => {
    const s = pickerSections(OPERATOR, { recentIds: ["retired", "live"] });
    expect(s.recent.map((r) => r.model.id)).toEqual(["live"]);
  });

  it("refuses to resolve it through firstPickable", () => {
    expect(firstPickable(OPERATOR, ["retired", "live"])).toBe("live");
    expect(firstPickable(OPERATOR, ["retired"])).toBeUndefined();
  });
});

describe("recents", () => {
  beforeEach(() => {
    installSnapshot(
      makeSnapshot([freeModel("a"), freeModel("b"), freeModel("c"), paidModel("p", "Acme", 2)]),
    );
  });

  it("leads with recent picks, in the order given", () => {
    const s = pickerSections(OPERATOR, { recentIds: ["c", "a"] });
    expect(s.recent.map((r) => r.model.id)).toEqual(["c", "a"]);
  });

  it("does not repeat a recent pick in the tier sections", () => {
    const s = pickerSections(OPERATOR, { recentIds: ["c"] });
    expect(s.free.map((r) => r.model.id)).not.toContain("c");
  });

  it("caps recents", () => {
    const ids = ["a", "b", "c", "p", "a", "b"];
    expect(pickerSections(OPERATOR, { recentIds: ids }).recent.length).toBeLessThanOrEqual(
      RECENT_LIMIT,
    );
  });

  it("stands down while searching — a query is not a request for history", () => {
    expect(pickerSections(OPERATOR, { recentIds: ["c"], query: "a" }).recent).toEqual([]);
  });
});

describe("capability requirements and exclusions", () => {
  beforeEach(() => {
    installSnapshot(
      makeSnapshot([
        freeModel("plain"),
        freeModel("agentic", {
          capabilities: { toolUse: true, structuredOutput: true, reasoning: false, caching: false },
        }),
        freeModel("seeing", { modalities: ["text", "vision"] }),
      ]),
    );
  });

  it("honours a tools requirement", () => {
    const s = pickerSections(OPERATOR, { require: { tools: true } });
    expect(s.free.map((r) => r.model.id)).toEqual(["agentic"]);
  });

  it("honours a vision requirement", () => {
    const s = pickerSections(OPERATOR, { require: { vision: true } });
    expect(s.free.map((r) => r.model.id)).toEqual(["seeing"]);
  });

  it("omits already-selected models so a multi-picker cannot double-add", () => {
    const s = pickerSections(OPERATOR, { exclude: ["plain", "agentic"] });
    expect(s.free.map((r) => r.model.id)).toEqual(["seeing"]);
  });

  it("applies requirements to firstPickable too", () => {
    expect(firstPickable(OPERATOR, ["plain", "agentic"], { tools: true })).toBe("agentic");
  });
});

describe("an unknown environment shows nothing rather than guessing", () => {
  beforeEach(() => {
    installSnapshot(makeSnapshot([freeModel("a"), paidModel("p", "Acme", 2)]));
  });

  it("returns empty sections until the provider list has loaded", () => {
    const s = pickerSections(null);
    expect(s.free).toEqual([]);
    expect(s.byok).toEqual([]);
    expect(s.counts.total).toBe(0);
    expect(firstPickable(null, ["a"])).toBeUndefined();
  });
});

describe("counts describe the whole catalog, not the visible slice", () => {
  it("counts past the display caps so the browse affordance can be honest", () => {
    const many = Array.from({ length: FREE_LIMIT + 7 }, (_, i) =>
      freeModel(`f-${i}`, score(`f-${i}`, 90 - i)),
    );
    installSnapshot(makeSnapshot(many, { version: "many" }));

    const s = pickerSections(OPERATOR);
    expect(s.free).toHaveLength(FREE_LIMIT);
    expect(s.freeMore).toBe(7);
    expect(s.counts.free).toBe(FREE_LIMIT + 7);
    expect(s.counts.total).toBe(FREE_LIMIT + 7);
  });

  it("counts what the picker would offer, not what the catalog holds", () => {
    // A section heading that says 3 while listing 1 is the small dishonesty this
    // whole module exists to remove — so `require` narrows the counts too.
    installSnapshot(
      makeSnapshot(
        [
          freeModel("plain-a"),
          freeModel("plain-b"),
          freeModel("agentic", {
            capabilities: {
              toolUse: true,
              structuredOutput: false,
              reasoning: false,
              caching: false,
            },
          }),
        ],
        { version: "caps" },
      ),
    );

    expect(pickerSections(OPERATOR).counts.free).toBe(3);
    const narrowed = pickerSections(OPERATOR, { require: { tools: true } });
    expect(narrowed.counts.free).toBe(1);
    expect(narrowed.free).toHaveLength(1);
    // The browse-all footer still offers the whole catalog, so `total` does not
    // narrow with it.
    expect(narrowed.counts.total).toBe(3);
  });

  it("does not count models a multi-picker has already selected", () => {
    installSnapshot(
      makeSnapshot([freeModel("a"), freeModel("b"), freeModel("c")], { version: "excl" }),
    );
    expect(pickerSections(OPERATOR, { exclude: ["a", "b"] }).counts.free).toBe(1);
  });
});
