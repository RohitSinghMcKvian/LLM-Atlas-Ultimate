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
  servableChatModel,
  servableModelId,
} from "./defaults";
import { modelAvailability, type RouteEnv } from "./availability";
import { getModelById, modelAccess, routableModels } from "./index";
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

describe("servableModelId — what the connected providers can actually serve", () => {
  beforeEach(() => {
    resetSnapshot();
    installSnapshot(BASELINE_SNAPSHOT);
  });

  it("keeps the preferred default when its provider is connected", () => {
    expect(servableChatModel({ configured: ["nvidia"] })).toBe(defaultChatModel());
  });

  it("moves off a default no connected provider can reach", () => {
    // The bug this exists for: `gpt-oss-120b` routes via groq/nvidia/openrouter/
    // local, so a Google-only operator was parked on a model that 503s on every
    // question while Google-served models sat unselected.
    const google = servableChatModel({ configured: ["google"] });
    expect(google).toBeDefined();
    expect(google).not.toBe(defaultChatModel());
    const routes = getModelById(google!)!.routes.map((r) => r.provider);
    expect(routes).toContain("google");
  });

  it("returns something runnable for every single-provider configuration", () => {
    for (const provider of ["nvidia", "google", "groq", "local"] as const) {
      const id = servableChatModel({ configured: [provider] });
      expect(id, provider).toBeDefined();
      expect(
        modelAvailability(getModelById(id!)!, { configured: [provider] }).kind,
        `${provider} → ${id}`,
      ).toBe("free");
    }
  });

  it("returns undefined rather than a guess when nothing is configured", () => {
    // The caller leaves the selection alone and lets the "connect a key" banner
    // show; swapping in another unreachable model would only hide the error.
    expect(servableChatModel({ configured: [] })).toBeUndefined();
  });

  it("never offers a metered model to a free-only request", () => {
    // OpenRouter is metered as a provider, so an operator key alone unlocks only
    // its `:free` variants — never a priced model.
    const id = servableChatModel({ configured: ["openrouter"] });
    if (id) {
      expect(modelAvailability(getModelById(id)!, { configured: ["openrouter"] }).kind).toBe(
        "free",
      );
    }
  });

  it("honours capability preferences, and degrades them before `free`", () => {
    const env = { configured: ["nvidia"] as const };
    const id = servableModelId(env, [], { free: true, tools: true });
    expect(id).toBeDefined();
    expect(getModelById(id!)!.capabilities.toolUse).toBe(true);
    expect(modelAvailability(getModelById(id!)!, env).kind).toBe("free");
  });
});

describe("the `freeReady` rule /api/v1/providers reports", () => {
  // The route computes it as `servableModelId(env, [], { free: true }) !==
  // undefined`. It used to be the hardcoded list `nvidia || openrouter ||
  // local`, which was wrong in both directions — these pin both corrections.
  const freeReady = (configured: RouteEnv["configured"]) =>
    servableModelId({ configured }, [], { free: true }) !== undefined;

  beforeEach(() => {
    resetSnapshot();
    installSnapshot(BASELINE_SNAPSHOT);
  });

  it("is true for the operator-funded providers the old list omitted", () => {
    expect(freeReady(["google"])).toBe(true);
    expect(freeReady(["groq"])).toBe(true);
  });

  it("stays true for the providers the old list did name", () => {
    expect(freeReady(["nvidia"])).toBe(true);
    expect(freeReady(["local"])).toBe(true);
  });

  it("is false with nothing configured", () => {
    expect(freeReady([])).toBe(false);
  });

  it("tracks the catalog rather than the provider id for metered OpenRouter", () => {
    // OpenRouter is metered, so its readiness depends on whether the catalog
    // currently holds a `:free` variant or a $0 listing — not on the key alone.
    // Either answer is correct; asserting the *source* of the answer is the
    // point, since the old code answered `true` unconditionally.
    const models = routableModels().filter(
      (m) => modelAvailability(m, { configured: ["openrouter"] }).kind === "free",
    );
    expect(freeReady(["openrouter"])).toBe(models.length > 0);
  });
});
