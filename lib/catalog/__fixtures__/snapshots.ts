import { computeCatalogStats } from "../stats";
import type { CatalogSnapshot } from "../snapshot";
import type { CatalogModel } from "../types";

// Deterministic catalog fixtures.
//
// The selectors used to be pinned only against the 97-entry bundled catalog,
// which has no `deprecated` entries, no duplicate route providers, and no models
// missing benchmark scores. A synced snapshot has all three. `syntheticSnapshot`
// exists so every invariant is checked against a catalog that exercises those
// shapes too — see `lib/catalog/index.test.ts`.

export function makeModel(over: Partial<CatalogModel> & { id: string }): CatalogModel {
  return {
    name: over.id,
    provider: "Test Brand",
    family: "Test",
    license: "open",
    access: "free",
    status: "ga",
    releaseDate: "2026-01-01",
    contextWindow: 32_768,
    maxOutput: 8_192,
    modalities: ["text"],
    capabilities: {
      toolUse: false,
      structuredOutput: false,
      reasoning: false,
      caching: false,
    },
    pricing: { inputPerM: 0, outputPerM: 0, effectiveFrom: "2026-01-01" },
    benchmarks: [],
    blurb: "A synthetic catalog entry.",
    routes: [{ provider: "openrouter", model: `test/${over.id}` }],
    ...over,
  };
}

export function makeSnapshot(
  models: CatalogModel[],
  over: Partial<CatalogSnapshot> = {},
): CatalogSnapshot {
  return {
    version: `test-${models.length}-${over.version ?? ""}`,
    // Newer than BASELINE_SNAPSHOT so `installSnapshot` accepts it on top.
    syncedAt: "2026-07-20T00:00:00.000Z",
    origin: "synced",
    models,
    stats: computeCatalogStats(models),
    aliases: {},
    diff: [],
    warnings: [],
    ...over,
  };
}

const BRANDS = ["Acme", "Bolt", "Cinder", "Delta", "Ember"];

/**
 * A synthetic catalog exercising every shape a synced snapshot can produce:
 * both access tiers, all four statuses, models with and without benchmark
 * scores, multi-route models, and a model listing one provider twice (a `:free`
 * route beside its paid twin).
 */
export function syntheticSnapshot(count = 400): CatalogSnapshot {
  const models: CatalogModel[] = [];
  const day = 24 * 60 * 60 * 1000;

  for (let i = 0; i < count; i++) {
    const byok = i % 3 === 0;
    const status =
      i % 97 === 0 ? "upcoming" : i % 53 === 0 ? "deprecated" : i % 29 === 0 ? "preview" : "ga";

    const routes: CatalogModel["routes"] =
      status === "upcoming"
        ? []
        : i % 7 === 0
          ? [
              { provider: "openrouter", model: `vendor/model-${i}:free` },
              { provider: "openrouter", model: `vendor/model-${i}` },
            ]
          : i % 5 === 0
            ? [
                { provider: "nvidia", model: `vendor/model-${i}` },
                { provider: "openrouter", model: `vendor/model-${i}` },
              ]
            : [{ provider: "openrouter", model: `vendor/model-${i}` }];

    const benchmarks: CatalogModel["benchmarks"] =
      i % 4 === 0
        ? [
            {
              key: "mmlu",
              score: 60 + (i % 35),
              source: "Test",
              sourceUrl: "https://example.test",
              measuredAt: "2026-07-01",
            },
          ]
        : i % 4 === 1
          ? [
              {
                key: "aa-intelligence",
                score: 30 + (i % 60),
                source: "Artificial Analysis",
                sourceUrl: "https://artificialanalysis.ai",
                measuredAt: "2026-07-01",
              },
            ]
          : i % 4 === 2
            ? [
                {
                  key: "arena",
                  score: 1150 + (i % 300),
                  source: "Test",
                  sourceUrl: "https://example.test",
                  measuredAt: "2026-07-01",
                },
              ]
            : [];

    models.push(
      makeModel({
        id: `synth-${i}`,
        name: `Synth ${i}`,
        provider: BRANDS[i % BRANDS.length],
        license: byok ? "proprietary" : "open",
        access: byok ? "byok" : "free",
        status,
        trending: i % 17 === 0,
        releaseDate: "2026-05-01",
        addedAt: new Date(Date.parse("2026-07-20T00:00:00.000Z") - (i % 200) * day)
          .toISOString()
          .slice(0, 10),
        routes,
        benchmarks,
        pricing: {
          inputPerM: byok ? 1 + (i % 9) : 0,
          outputPerM: byok ? 4 + (i % 20) : 0,
          effectiveFrom: "2026-07-01",
        },
      }),
    );
  }

  return makeSnapshot(models, { version: "synthetic" });
}
