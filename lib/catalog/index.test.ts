import { describe, it, expect } from "vitest";
import {
  MODELS,
  getModelById,
  modelAccess,
  isFree,
  routableModels,
  freeModels,
  byokModels,
  trendingModels,
  brandProviders,
  intelligenceIndex,
  catalogStats,
  getBenchmark,
  providersForModel,
} from "./index";

// These tests pin the *contents* of the memoized selectors against a freshly
// computed filter, so the caches added for performance can never drift from
// the semantics they replaced.

describe("getModelById", () => {
  it("finds every model in the catalog by its id", () => {
    for (const m of MODELS) {
      expect(getModelById(m.id)).toBe(m);
    }
  });

  it("returns undefined for an unknown id", () => {
    expect(getModelById("definitely-not-a-model")).toBeUndefined();
  });

  it("returns undefined for an empty id", () => {
    expect(getModelById("")).toBeUndefined();
  });

  it("is stable across repeated calls", () => {
    const first = getModelById(MODELS[0].id);
    expect(getModelById(MODELS[0].id)).toBe(first);
  });
});

describe("modelAccess / isFree", () => {
  it("derives access from license when the field is absent", () => {
    for (const m of MODELS) {
      if (m.access) continue;
      expect(modelAccess(m)).toBe(m.license === "open" ? "free" : "byok");
    }
  });

  it("prefers an explicit access field", () => {
    for (const m of MODELS) {
      if (m.access) expect(modelAccess(m)).toBe(m.access);
    }
  });

  it("isFree agrees with modelAccess", () => {
    for (const m of MODELS) {
      expect(isFree(m)).toBe(modelAccess(m) === "free");
    }
  });
});

describe("memoized selectors match a fresh filter", () => {
  it("routableModels", () => {
    expect(routableModels()).toEqual(
      MODELS.filter((m) => m.routes.length > 0 && m.status !== "upcoming"),
    );
  });

  it("freeModels", () => {
    expect(freeModels()).toEqual(
      MODELS.filter((m) => modelAccess(m) === "free" && m.status !== "upcoming"),
    );
  });

  it("byokModels", () => {
    expect(byokModels()).toEqual(
      MODELS.filter((m) => modelAccess(m) === "byok" && m.status !== "upcoming"),
    );
  });

  it("trendingModels", () => {
    expect(trendingModels()).toEqual(
      MODELS.filter((m) => m.trending && m.status !== "upcoming"),
    );
  });

  it("brandProviders", () => {
    expect(brandProviders()).toEqual(
      Array.from(new Set(MODELS.map((m) => m.provider))).sort(),
    );
  });

  it("free and byok partition the non-upcoming catalog", () => {
    const live = MODELS.filter((m) => m.status !== "upcoming");
    expect(freeModels().length + byokModels().length).toBe(live.length);
  });

  it("returns identical results on repeated calls", () => {
    expect(routableModels()).toEqual(routableModels());
    expect(freeModels()).toEqual(freeModels());
    expect(brandProviders()).toEqual(brandProviders());
  });
});

describe("intelligenceIndex", () => {
  it("averages the available benchmark scores", () => {
    for (const m of MODELS) {
      const vals = ["mmlu", "gpqa", "humaneval", "math"]
        .map((k) => getBenchmark(m, k))
        .filter((v): v is number => v !== undefined);
      const expected =
        vals.length === 0
          ? (() => {
              const elo = getBenchmark(m, "arena");
              return elo ? Math.round(((elo - 1100) / 300) * 100) : 0;
            })()
          : Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      expect(intelligenceIndex(m)).toBe(expected);
    }
  });

  it("is stable across repeated calls (cache correctness)", () => {
    for (const m of MODELS.slice(0, 20)) {
      expect(intelligenceIndex(m)).toBe(intelligenceIndex(m));
    }
  });
});

describe("catalogStats", () => {
  it("reports the catalog size and derived counts", () => {
    const stats = catalogStats();
    expect(stats.models).toBe(MODELS.length);
    expect(stats.brandProviders).toBe(brandProviders().length);
    expect(stats.upcoming).toBe(
      MODELS.filter((m) => m.status === "upcoming").length,
    );
  });

  it("returns equal values on repeated calls", () => {
    expect(catalogStats()).toEqual(catalogStats());
  });
});

describe("providersForModel", () => {
  it("maps routes to their provider ids", () => {
    for (const m of MODELS.slice(0, 20)) {
      expect(providersForModel(m)).toEqual(m.routes.map((r) => r.provider));
    }
  });
});
