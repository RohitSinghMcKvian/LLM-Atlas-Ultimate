import { describe, it, expect, beforeEach } from "vitest";
import { syntheticSnapshot } from "./__fixtures__/snapshots";
import { BASELINE_SNAPSHOT } from "./baseline";
import { SEARCH_LIMIT, modelShortlist, scoreModel, searchModels } from "./search";
import { getModelById, modelAccess, routableModels } from "./index";
import { installSnapshot, resetSnapshot } from "./snapshot";

// The pickers render only what these return, so a bad ranking here is the
// difference between finding a model and concluding it is missing.

describe("searchModels", () => {
  beforeEach(() => {
    resetSnapshot();
    installSnapshot(BASELINE_SNAPSHOT);
  });

  it("returns nothing for an empty query", () => {
    expect(searchModels("")).toEqual([]);
    expect(searchModels("   ")).toEqual([]);
  });

  it("ranks an exact name above a substring match", () => {
    const results = searchModels("GPT-5.5");
    expect(results[0]?.name).toBe("GPT-5.5");
  });

  it("finds models by brand", () => {
    const results = searchModels("anthropic");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((m) => m.provider === "Anthropic")).toBe(true);
  });

  it("finds models by a name fragment", () => {
    expect(searchModels("nemotron").every((m) => /nemotron/i.test(m.name))).toBe(true);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(searchModels("  CLAUDE ").length).toBe(searchModels("claude").length);
  });

  it("caps the result count", () => {
    // A single letter matches a large share of the catalog.
    expect(searchModels("a").length).toBeLessThanOrEqual(SEARCH_LIMIT);
  });

  it("honours the cap override", () => {
    expect(searchModels("a", { limit: 5 }).length).toBeLessThanOrEqual(5);
  });

  it("only ever returns routable models", () => {
    const routable = new Set(routableModels().map((m) => m.id));
    for (const m of searchModels("a")) expect(routable.has(m.id)).toBe(true);
  });

  it("can restrict to tool-capable models", () => {
    for (const m of searchModels("a", { toolsOnly: true })) {
      expect(m.capabilities.toolUse).toBe(true);
    }
  });

  it("returns nothing for gibberish", () => {
    expect(searchModels("zzzzqqqqxxxx")).toEqual([]);
  });

  it("scores a non-match as zero", () => {
    const model = routableModels()[0];
    expect(scoreModel(model, "zzzzqqqqxxxx")).toBe(0);
  });
});

describe("modelShortlist", () => {
  const snapshots: [string, () => void][] = [
    ["baseline", () => installSnapshot(BASELINE_SNAPSHOT)],
    ["synthetic", () => installSnapshot(syntheticSnapshot(400))],
  ];

  for (const [name, install] of snapshots) {
    describe(name, () => {
      beforeEach(() => {
        resetSnapshot();
        install();
      });

      it("stays short — the whole point is not rendering the catalog", () => {
        const s = modelShortlist();
        expect(s.free.length + s.frontier.length + s.recent.length).toBeLessThanOrEqual(24);
      });

      it("reports the full routable count for the search affordance", () => {
        expect(modelShortlist().total).toBe(routableModels().length);
      });

      it("puts recent picks first and never duplicates them below", () => {
        const first = routableModels()[0].id;
        const s = modelShortlist([first]);
        expect(s.recent.map((m) => m.id)).toEqual([first]);
        expect(s.free.some((m) => m.id === first)).toBe(false);
        expect(s.frontier.some((m) => m.id === first)).toBe(false);
      });

      it("ignores recent ids that no longer resolve", () => {
        expect(modelShortlist(["a-retired-model"]).recent).toEqual([]);
      });

      it("separates free from frontier correctly", () => {
        // Via `modelAccess`, not the legacy `.access` field — the field lies.
        const s = modelShortlist();
        for (const m of s.free) expect(modelAccess(getModelById(m.id)!)).toBe("free");
        for (const m of s.frontier) expect(modelAccess(getModelById(m.id)!)).toBe("byok");
      });
    });
  }
});
