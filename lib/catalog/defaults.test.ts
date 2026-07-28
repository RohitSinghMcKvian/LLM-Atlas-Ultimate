import { beforeEach, describe, expect, it } from "vitest";
import { makeModel, makeSnapshot } from "./__fixtures__/snapshots";
import { BASELINE_SNAPSHOT } from "./baseline";
import {
  defaultAgentModel,
  defaultBenchModels,
  defaultChatModel,
  defaultCompareModels,
  defaultCostModels,
  defaultFlowModel,
  defaultPlaygroundModels,
} from "./defaults";
import { getModelById, modelAccess } from "./index";
import { installSnapshot, resetSnapshot } from "./snapshot";

// Defaults are applied *without the user choosing them* — `activeModelId` on a
// fresh visit, the initial bench set, the flow agent node. So a default that
// cannot be run is worse than most bugs: the user's first action fails and there
// is nothing in the UI explaining why.
//
// These pin two things: every default resolves to a real model, and a default
// that asks for `free` never returns a metered one.

const FREE_DEFAULTS: [string, () => string | string[]][] = [
  ["defaultChatModel", defaultChatModel],
  ["defaultBenchModels", defaultBenchModels],
  ["defaultFlowModel", defaultFlowModel],
  ["defaultAgentModel", defaultAgentModel],
];

const ALL_DEFAULTS: [string, () => string | string[]][] = [
  ...FREE_DEFAULTS,
  ["defaultCompareModels", defaultCompareModels],
  ["defaultCostModels", defaultCostModels],
  ["defaultPlaygroundModels", defaultPlaygroundModels],
];

const idsOf = (v: string | string[]) => (Array.isArray(v) ? v : [v]).filter(Boolean);

describe("against the bundled baseline", () => {
  beforeEach(() => {
    resetSnapshot();
    installSnapshot(BASELINE_SNAPSHOT);
  });

  it("every default resolves to a live model", () => {
    for (const [name, fn] of ALL_DEFAULTS) {
      const ids = idsOf(fn());
      expect(ids.length, name).toBeGreaterThan(0);
      for (const id of ids) expect(getModelById(id), `${name} → ${id}`).toBeDefined();
    }
  });

  it("free-preferring defaults never return a metered model", () => {
    for (const [name, fn] of FREE_DEFAULTS) {
      for (const id of idsOf(fn())) {
        expect(modelAccess(getModelById(id)!), `${name} → ${id}`).toBe("free");
      }
    }
  });

  it("tool-requiring defaults return a tool-capable model", () => {
    for (const id of idsOf(defaultFlowModel())) {
      expect(getModelById(id)!.capabilities.toolUse, id).toBe(true);
    }
    for (const id of idsOf(defaultAgentModel())) {
      expect(getModelById(id)!.capabilities.toolUse, id).toBe(true);
    }
  });

  it("returns the requested count where the catalog allows", () => {
    expect(defaultCompareModels()).toHaveLength(3);
    expect(defaultBenchModels()).toHaveLength(3);
    expect(defaultPlaygroundModels()).toHaveLength(2);
    expect(defaultCostModels()).toHaveLength(6);
  });
});

describe("when every preferred id has been delisted", () => {
  // The realistic post-sync state: `llama-3-3-70b` was retired for hanging, and
  // several other preferred ids are gone. The defaults must degrade, not break.
  beforeEach(() => {
    resetSnapshot();
    installSnapshot(
      makeSnapshot([
        makeModel({
          id: "some-free-tool-model",
          name: "Free Tools",
          routes: [{ provider: "nvidia", model: "vendor/free-tools" }],
          capabilities: {
            toolUse: true,
            structuredOutput: true,
            reasoning: false,
            caching: false,
          },
        }),
        makeModel({
          id: "some-paid-model",
          name: "Paid",
          license: "proprietary",
          routes: [{ provider: "openrouter", model: "vendor/paid" }],
          pricing: { inputPerM: 5, outputPerM: 15, effectiveFrom: "2026-01-01" },
        }),
      ]),
    );
  });

  it("still returns a live model for every default", () => {
    for (const [name, fn] of ALL_DEFAULTS) {
      const ids = idsOf(fn());
      expect(ids.length, name).toBeGreaterThan(0);
      for (const id of ids) expect(getModelById(id), `${name} → ${id}`).toBeDefined();
    }
  });

  it("still refuses to hand a metered model to a free-preferring default", () => {
    // The last-resort tier relaxes `tools` and `vision` before it relaxes `free`.
    for (const [name, fn] of FREE_DEFAULTS) {
      for (const id of idsOf(fn())) {
        expect(modelAccess(getModelById(id)!), `${name} → ${id}`).toBe("free");
      }
    }
  });

  it("never returns an empty string for the single-model defaults", () => {
    expect(defaultChatModel()).not.toBe("");
    expect(defaultFlowModel()).not.toBe("");
    expect(defaultAgentModel()).not.toBe("");
  });
});

describe("when the catalog has no free models at all", () => {
  beforeEach(() => {
    resetSnapshot();
    installSnapshot(
      makeSnapshot([
        makeModel({
          id: "only-paid",
          name: "Only Paid",
          license: "proprietary",
          routes: [{ provider: "openrouter", model: "vendor/only-paid" }],
          pricing: { inputPerM: 3, outputPerM: 9, effectiveFrom: "2026-01-01" },
        }),
      ]),
    );
  });

  it("falls back to the paid model rather than returning nothing", () => {
    // An empty picker is a dead end; a model the user must connect a key for at
    // least has a path forward (the key modal).
    expect(defaultChatModel()).toBe("only-paid");
  });
});
