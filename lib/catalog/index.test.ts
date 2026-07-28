import { describe, it, expect, beforeEach } from "vitest";
import { syntheticSnapshot } from "./__fixtures__/snapshots";
import { ALL_PROVIDERS, intrinsicAccess, routeCost } from "./availability";
import {
  BASELINE_SNAPSHOT,
  allModels,
  getModelById,
  modelAccess,
  isFree,
  isSelectable,
  routableModels,
  freeModels,
  byokModels,
  trendingModels,
  newModels,
  isNewModel,
  brandProviders,
  groupedByProvider,
  modelCountByRouteProvider,
  intelligenceIndex,
  catalogStats,
  getBenchmark,
  providersForModel,
} from "./index";
import { installSnapshot, resetSnapshot, type CatalogSnapshot } from "./snapshot";

// These tests pin the *contents* of the memoized selectors against a freshly
// computed filter, so the caches added for performance can never drift from the
// semantics they replaced.
//
// Every case runs twice: once against the bundled baseline (the catalog the app
// ships with) and once against a synthetic snapshot that exercises the shapes
// only a synced catalog produces — `deprecated` entries, models with no
// benchmark scores, and duplicate route providers. The selectors are now
// snapshot-keyed, so this is also what proves a swap re-derives instead of
// serving a stale cache.

const SNAPSHOTS: [string, () => CatalogSnapshot][] = [
  ["baseline", () => BASELINE_SNAPSHOT],
  ["synthetic", () => syntheticSnapshot(400)],
];

describe.each(SNAPSHOTS)("catalog selectors (%s snapshot)", (_name, build) => {
  let snapshot: CatalogSnapshot;

  beforeEach(() => {
    snapshot = build();
    // `installSnapshot` is monotonic, so reset before installing an older one.
    resetSnapshot();
    installSnapshot(snapshot);
  });

  describe("allModels", () => {
    it("returns the installed snapshot's models", () => {
      expect(allModels()).toBe(snapshot.models);
    });
  });

  describe("getModelById", () => {
    it("finds every model in the catalog by its id", () => {
      for (const m of allModels()) {
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
      const first = getModelById(allModels()[0].id);
      expect(getModelById(allModels()[0].id)).toBe(first);
    });
  });

  describe("modelAccess / isFree", () => {
    it("derives access from the routes, not the stored field", () => {
      // The stored `access` field is legacy and provably drifts: 38 curated
      // entries claimed "free" while their only live route was a metered
      // OpenRouter endpoint answering 402. `modelAccess` now asks the routes.
      for (const m of allModels()) {
        expect(modelAccess(m)).toBe(intrinsicAccess(m));
      }
    });

    it("calls a model free only when some route could be zero-cost", () => {
      for (const m of allModels()) {
        const free = m.routes.some(
          (r) => routeCost(r, m, ALL_PROVIDERS) === "free",
        );
        expect(modelAccess(m)).toBe(free ? "free" : "byok");
      }
    });

    it("isFree agrees with modelAccess", () => {
      for (const m of allModels()) {
        expect(isFree(m)).toBe(modelAccess(m) === "free");
      }
    });
  });

  describe("memoized selectors match a fresh filter", () => {
    it("routableModels", () => {
      expect(routableModels()).toEqual(
        allModels().filter((m) => m.routes.length > 0 && isSelectable(m)),
      );
    });

    it("freeModels", () => {
      expect(freeModels()).toEqual(
        allModels().filter((m) => modelAccess(m) === "free" && isSelectable(m)),
      );
    });

    it("byokModels", () => {
      expect(byokModels()).toEqual(
        allModels().filter((m) => modelAccess(m) === "byok" && isSelectable(m)),
      );
    });

    it("trendingModels", () => {
      expect(trendingModels()).toEqual(
        allModels().filter((m) => m.trending && isSelectable(m)),
      );
    });

    it("brandProviders", () => {
      expect(brandProviders()).toEqual(
        Array.from(new Set(allModels().map((m) => m.provider))).sort(),
      );
    });

    it("free and byok partition the selectable catalog", () => {
      const live = allModels().filter(isSelectable);
      expect(freeModels().length + byokModels().length).toBe(live.length);
    });

    it("no selector offers an upcoming or deprecated model", () => {
      for (const list of [routableModels(), freeModels(), byokModels(), trendingModels()]) {
        for (const m of list) {
          expect(m.status).not.toBe("upcoming");
          expect(m.status).not.toBe("deprecated");
        }
      }
    });

    it("returns the same array identity on repeated calls", () => {
      expect(routableModels()).toBe(routableModels());
      expect(freeModels()).toBe(freeModels());
      expect(brandProviders()).toBe(brandProviders());
      expect(groupedByProvider()).toBe(groupedByProvider());
      expect(newModels(60)).toBe(newModels(60));
    });
  });

  describe("newModels / isNewModel", () => {
    it("only returns models added within the window, newest first", () => {
      const list = newModels(30);
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      for (const m of list) {
        expect(Date.parse(m.addedAt ?? m.releaseDate)).toBeGreaterThanOrEqual(cutoff);
        expect(isSelectable(m)).toBe(true);
      }
      const times = list.map((m) => Date.parse(m.addedAt ?? m.releaseDate));
      expect(times).toEqual([...times].sort((a, b) => b - a));
    });

    it("a wider window is a superset of a narrower one", () => {
      const narrow = new Set(newModels(30).map((m) => m.id));
      const wide = new Set(newModels(120).map((m) => m.id));
      for (const id of narrow) expect(wide.has(id)).toBe(true);
    });

    it("isNewModel agrees with membership in the same window", () => {
      const fresh = new Set(newModels(14).map((m) => m.id));
      for (const m of allModels()) {
        expect(isNewModel(m, 14)).toBe(fresh.has(m.id));
      }
    });
  });

  describe("groupedByProvider", () => {
    it("partitions exactly the routable models", () => {
      const grouped = groupedByProvider().flatMap(([, list]) => list);
      expect(grouped.length).toBe(routableModels().length);
      expect(new Set(grouped.map((m) => m.id))).toEqual(
        new Set(routableModels().map((m) => m.id)),
      );
    });

    it("sorts brands, and models within each brand", () => {
      const brands = groupedByProvider().map(([b]) => b);
      expect(brands).toEqual([...brands].sort((a, b) => a.localeCompare(b)));
      for (const [, list] of groupedByProvider()) {
        const names = list.map((m) => m.name);
        expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
      }
    });
  });

  describe("modelCountByRouteProvider", () => {
    it("counts each model once per provider, not once per route", () => {
      const counts = modelCountByRouteProvider();
      for (const [provider, count] of counts) {
        const expected = allModels().filter((m) =>
          m.routes.some((r) => r.provider === provider),
        ).length;
        expect(count).toBe(expected);
      }
    });
  });

  describe("intelligenceIndex", () => {
    it("prefers curated benchmarks, then aa-intelligence, then arena", () => {
      for (const m of allModels()) {
        const vals = ["mmlu", "gpqa", "humaneval", "math"]
          .map((k) => getBenchmark(m, k))
          .filter((v): v is number => v !== undefined);

        let expected: number;
        if (vals.length > 0) {
          expected = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
        } else {
          const aa = getBenchmark(m, "aa-intelligence");
          if (aa !== undefined) {
            expected = Math.round(aa);
          } else {
            const elo = getBenchmark(m, "arena");
            expected = elo ? Math.round(((elo - 1100) / 300) * 100) : 0;
          }
        }
        expect(intelligenceIndex(m)).toBe(expected);
      }
    });

    it("is stable across repeated calls (cache correctness)", () => {
      for (const m of allModels().slice(0, 20)) {
        expect(intelligenceIndex(m)).toBe(intelligenceIndex(m));
      }
    });
  });

  describe("catalogStats", () => {
    it("reports the catalog size and derived counts", () => {
      const stats = catalogStats();
      expect(stats.models).toBe(allModels().length);
      expect(stats.brandProviders).toBe(brandProviders().length);
      expect(stats.upcoming).toBe(
        allModels().filter((m) => m.status === "upcoming").length,
      );
      expect(stats.deprecated).toBe(
        allModels().filter((m) => m.status === "deprecated").length,
      );
      expect(stats.free).toBe(freeModels().length);
      expect(stats.byok).toBe(byokModels().length);
    });

    it("returns equal values on repeated calls", () => {
      expect(catalogStats()).toEqual(catalogStats());
    });
  });

  describe("providersForModel", () => {
    it("lists each route provider once, in route order", () => {
      for (const m of allModels().slice(0, 40)) {
        const expected = [...new Set(m.routes.map((r) => r.provider))];
        expect(providersForModel(m)).toEqual(expected);
      }
    });
  });
});

describe("snapshot swaps re-derive", () => {
  beforeEach(() => {
    resetSnapshot();
  });

  it("falls back to the bundled baseline before anything is installed", () => {
    expect(allModels()).toBe(BASELINE_SNAPSHOT.models);
    expect(catalogStats().models).toBe(BASELINE_SNAPSHOT.models.length);
  });

  it("serves the new catalog after an install, with no baseline leakage", () => {
    const synthetic = syntheticSnapshot(50);
    installSnapshot(synthetic);

    expect(allModels()).toBe(synthetic.models);
    expect(catalogStats().models).toBe(50);
    // Baseline ids must no longer resolve — a stale index here would keep
    // retired models reachable forever.
    expect(getModelById(BASELINE_SNAPSHOT.models[0].id)).toBeUndefined();
    expect(getModelById("synth-0")).toBeDefined();
  });

  it("re-derives every cached selector after a swap", () => {
    installSnapshot(syntheticSnapshot(50));
    const beforeRoutable = routableModels();
    const beforeBrands = brandProviders();

    resetSnapshot();
    installSnapshot(syntheticSnapshot(80));

    expect(routableModels()).not.toBe(beforeRoutable);
    expect(brandProviders()).not.toBe(beforeBrands);
    expect(allModels().length).toBe(80);
  });
});
