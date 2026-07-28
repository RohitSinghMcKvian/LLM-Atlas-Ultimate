import { describe, it, expect, beforeEach } from "vitest";
import { makeModel, makeSnapshot, syntheticSnapshot } from "./__fixtures__/snapshots";
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
import { getModelById, routableModels } from "./index";
import { fallbackModelId, isLiveModelId, resolveModelId, resolveModelIds } from "./resolve";
import { installSnapshot, resetSnapshot } from "./snapshot";

// A stored model id can outlive the model it names now that the catalog is
// regenerated daily. Everything here exists so that never surfaces as a dead
// picker, a blank label, or a crash.

describe("resolveModelId", () => {
  beforeEach(() => {
    resetSnapshot();
    installSnapshot(
      makeSnapshot(
        [
          makeModel({ id: "live-model", name: "Live Model" }),
          makeModel({ id: "gpt-5-5", name: "GPT-5.5" }),
        ],
        {
          version: "resolve-fixture",
          aliases: {
            "old-name": "live-model",
            "claude-opus-5-20260601": "live-model",
            "gone-for-good": "",
          },
        },
      ),
    );
  });

  it("passes through an id that still exists", () => {
    expect(resolveModelId("live-model")).toBe("live-model");
  });

  it("follows an alias to the live id", () => {
    expect(resolveModelId("old-name")).toBe("live-model");
  });

  it("follows a date-stamped provider slug", () => {
    expect(resolveModelId("claude-opus-5-20260601")).toBe("live-model");
  });

  it("returns undefined for a tombstone with no successor", () => {
    expect(resolveModelId("gone-for-good")).toBeUndefined();
  });

  it("returns undefined for something that never existed", () => {
    expect(resolveModelId("never-existed")).toBeUndefined();
  });

  it("handles empty and nullish input", () => {
    expect(resolveModelId("")).toBeUndefined();
    expect(resolveModelId(null)).toBeUndefined();
    expect(resolveModelId(undefined)).toBeUndefined();
  });

  it("recovers from punctuation drift in a shared link", () => {
    // `/chat?model=gpt-5.5` should still land on `gpt-5-5`.
    expect(resolveModelId("gpt-5.5")).toBe("gpt-5-5");
    expect(resolveModelId("GPT_5_5")).toBe("gpt-5-5");
  });

  it("isLiveModelId agrees", () => {
    expect(isLiveModelId("live-model")).toBe(true);
    expect(isLiveModelId("gone-for-good")).toBe(false);
  });
});

describe("resolveModelIds", () => {
  beforeEach(() => {
    resetSnapshot();
    installSnapshot(
      makeSnapshot(
        [makeModel({ id: "a" }), makeModel({ id: "b" })],
        { version: "list-fixture", aliases: { "old-a": "a", dead: "" } },
      ),
    );
  });

  it("keeps live ids in order and drops the dead ones", () => {
    expect(resolveModelIds(["a", "dead", "b"])).toEqual(["a", "b"]);
  });

  it("de-duplicates after aliasing", () => {
    expect(resolveModelIds(["a", "old-a"])).toEqual(["a"]);
  });

  it("returns an empty list when nothing survives", () => {
    expect(resolveModelIds(["dead", "never"])).toEqual([]);
  });
});

describe("fallbackModelId", () => {
  const snapshots: [string, () => void][] = [
    ["baseline", () => installSnapshot(BASELINE_SNAPSHOT)],
    ["synthetic", () => installSnapshot(syntheticSnapshot(200))],
  ];

  for (const [name, install] of snapshots) {
    describe(name, () => {
      beforeEach(() => {
        resetSnapshot();
        install();
      });

      it("always returns a routable model", () => {
        const id = fallbackModelId();
        expect(getModelById(id)).toBeDefined();
        expect(routableModels().some((m) => m.id === id)).toBe(true);
      });

      it("honours the free preference", () => {
        const id = fallbackModelId({ free: true });
        expect(getModelById(id)!.access).toBe("free");
      });

      it("honours the tools preference", () => {
        const id = fallbackModelId({ tools: true });
        const model = getModelById(id)!;
        // Only assert when the catalog actually has a tool-using model.
        if (routableModels().some((m) => m.capabilities.toolUse)) {
          expect(model.capabilities.toolUse).toBe(true);
        }
      });
    });
  }

  it("returns an empty string rather than throwing on an empty catalog", () => {
    resetSnapshot();
    installSnapshot(makeSnapshot([], { version: "empty-catalog" }));
    expect(fallbackModelId()).toBe("");
  });
});

describe("default model sets", () => {
  const cases: [string, () => string[]][] = [
    ["chat", () => [defaultChatModel()]],
    ["compare", defaultCompareModels],
    ["bench", defaultBenchModels],
    ["cost", defaultCostModels],
    ["playground", defaultPlaygroundModels],
    ["flow", () => [defaultFlowModel()]],
    ["agent", () => [defaultAgentModel()]],
  ];

  // Runs against the synthetic catalog too, where *none* of the preferred ids
  // exist — this is what proves a default set degrades to real models instead of
  // handing a dangling id to `getModelById(...)!`.
  const snapshots: [string, () => void][] = [
    ["baseline", () => installSnapshot(BASELINE_SNAPSHOT)],
    ["synthetic", () => installSnapshot(syntheticSnapshot(200))],
  ];

  for (const [snapName, install] of snapshots) {
    describe(snapName, () => {
      beforeEach(() => {
        resetSnapshot();
        install();
      });

      for (const [name, get] of cases) {
        it(`${name} resolves entirely to live models`, () => {
          const ids = get();
          expect(ids.length).toBeGreaterThan(0);
          for (const id of ids) {
            expect(id, `${name} produced an empty id`).toBeTruthy();
            expect(getModelById(id), `${name} produced a dangling id: ${id}`).toBeDefined();
          }
        });

        it(`${name} has no duplicates`, () => {
          const ids = get();
          expect(new Set(ids).size).toBe(ids.length);
        });
      }

      it("free-tier defaults really are free", () => {
        for (const id of [defaultChatModel(), defaultFlowModel(), defaultAgentModel()]) {
          expect(getModelById(id)!.access).toBe("free");
        }
      });
    });
  }
});
