import { describe, it, expect } from "vitest";
import {
  CONTEXT_SAFETY,
  DEPTH_PRESETS,
  MIN_RAG_TOKENS,
  PROMPT_OVERHEAD_TOKENS,
  affordableOutputTokens,
  bandFor,
  fitFor,
  pickArbiter,
  planLanes,
  type LaneModel,
} from "./lanes";
import { MAX_LANES, type RunConfig } from "./types";
import type { RouteEnv } from "@/lib/catalog/availability";

const model = (id: string, over: Partial<LaneModel> = {}): LaneModel => ({
  id,
  name: id,
  contextWindow: 200_000,
  maxOutput: 8_000,
  pricing: { inputPerM: 1, outputPerM: 4, effectiveFrom: "2026-01-01" },
  routes: [{ provider: "nvidia", model: id }],
  license: "open",
  ...over,
});

const catalog = (models: LaneModel[]) => {
  const map = new Map(models.map((m) => [m.id, m]));
  return (id: string) => map.get(id);
};

/** Every provider keyed, so availability is never the thing under test. */
const OPEN_ENV: RouteEnv = { configured: ["nvidia", "groq", "google", "openrouter", "local"] };
/** Nothing keyed at all. */
const CLOSED_ENV: RouteEnv = { configured: [] };

const config = (over: Partial<RunConfig> = {}): RunConfig => ({
  question: "What are the trade-offs?",
  modelIds: ["a", "b"],
  depth: "standard",
  ...over,
});

describe("bandFor", () => {
  it("hands out the ramp in selection order", () => {
    expect([0, 1, 2, 3, 4, 5].map(bandFor)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("wraps rather than producing a band the ramp does not have", () => {
    expect(bandFor(MAX_LANES)).toBe(0);
  });
});

describe("fitFor", () => {
  const wide = { contextWindow: 200_000 };

  it("stuffs when the pack fits", () => {
    expect(fitFor(wide, 10_000, 2_000)).toBe("stuff");
  });

  it("retrieves when the pack is larger than the room but the room is usable", () => {
    // 32k window: ~28.8k usable, minus 2k output and overhead leaves plenty.
    expect(fitFor({ contextWindow: 32_000 }, 500_000, 2_000)).toBe("rag");
  });

  it("map-reduces when there is not even room for a retrieved slice", () => {
    const tiny = { contextWindow: Math.ceil((MIN_RAG_TOKENS + PROMPT_OVERHEAD_TOKENS) / CONTEXT_SAFETY) };
    expect(fitFor(tiny, 500_000, 2_000)).toBe("map-reduce");
  });

  it("map-reduces when the output alone overflows the window", () => {
    expect(fitFor({ contextWindow: 1_000 }, 0, 4_000)).toBe("map-reduce");
  });

  it("treats a missing context window as unusable rather than infinite", () => {
    expect(fitFor({ contextWindow: 0 }, 1, 1)).toBe("map-reduce");
  });
});

describe("affordableOutputTokens", () => {
  it("subtracts what the input already costs", () => {
    // $1/M in, $4/M out. 1M prompt tokens costs $1 exactly, leaving nothing.
    expect(affordableOutputTokens(model("m"), 1_000_000, 1)).toBe(0);
  });

  it("converts the remaining budget at the output rate", () => {
    // $2 budget, no input cost worth mentioning: $2 / $4 per M = 500k tokens.
    const m = model("m", { pricing: { inputPerM: 0, outputPerM: 4, effectiveFrom: "2026-01-01" } });
    expect(affordableOutputTokens(m, 0, 2)).toBe(500_000);
  });

  it("does not constrain a free model", () => {
    const free = model("free", { pricing: { inputPerM: 0, outputPerM: 0, effectiveFrom: "2026-01-01" } });
    expect(affordableOutputTokens(free, 10_000, 0.01)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("planLanes", () => {
  const lookup = catalog([model("a"), model("b"), model("c")]);

  it("assigns each lane the next band", () => {
    const { lanes } = planLanes({ config: config({ modelIds: ["a", "b", "c"] }), env: OPEN_ENV, lookup });
    expect(lanes.map((l) => l.band)).toEqual([0, 1, 2]);
  });

  it("caps at the length of the elevation ramp and reports what it dropped", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const big = catalog(ids.map((id) => model(id)));
    const { lanes, dropped } = planLanes({ config: config({ modelIds: ids }), env: OPEN_ENV, lookup: big });
    expect(lanes).toHaveLength(MAX_LANES);
    expect(dropped).toEqual(["g", "h"]);
  });

  it("de-duplicates before capping, so a repeat cannot cost a slot", () => {
    const { lanes, dropped } = planLanes({
      config: config({ modelIds: ["a", "a", "b"] }),
      env: OPEN_ENV,
      lookup,
    });
    expect(lanes.map((l) => l.modelId)).toEqual(["a", "b"]);
    expect(dropped).toEqual([]);
  });

  it("plans an unknown model as blocked rather than dropping it", () => {
    const { lanes } = planLanes({ config: config({ modelIds: ["a", "ghost"] }), env: OPEN_ENV, lookup });
    expect(lanes).toHaveLength(2);
    expect(lanes[1].blocked?.code).toBe("model_not_found");
  });

  it("plans an unrunnable model as blocked, with a reason", () => {
    const paid = catalog([
      model("paid", {
        routes: [{ provider: "openrouter", model: "paid" }],
        pricing: { inputPerM: 5, outputPerM: 15, effectiveFrom: "2026-01-01" },
        license: "proprietary",
      }),
    ]);
    const { lanes } = planLanes({
      config: config({ modelIds: ["paid"] }),
      env: CLOSED_ENV,
      lookup: paid,
    });
    expect(lanes[0].blocked).toBeTruthy();
    expect(lanes[0].blocked?.message).toBeTruthy();
  });

  it("blocks a lane the per-lane budget cannot afford at all", () => {
    const lavish = catalog([model("lavish", { pricing: { inputPerM: 10_000, outputPerM: 40_000, effectiveFrom: "2026-01-01" } })]);
    const { lanes } = planLanes({
      config: config({ modelIds: ["lavish"], depth: "quick" }),
      env: OPEN_ENV,
      lookup: lavish,
      evidenceTokens: 100_000,
    });
    expect(lanes[0].blocked?.code).toBe("over_budget");
  });

  it("never plans an output above the model's own ceiling", () => {
    const stingy = catalog([model("stingy", { maxOutput: 256 })]);
    const { lanes } = planLanes({
      config: config({ modelIds: ["stingy"], depth: "deep" }),
      env: OPEN_ENV,
      lookup: stingy,
    });
    expect(lanes[0].maxTokens).toBeLessThanOrEqual(256);
  });

  it("gives a narrow model a different fit but the same evidence", () => {
    const mixed = catalog([model("wide"), model("narrow", { contextWindow: 16_000 })]);
    const { lanes } = planLanes({
      config: config({ modelIds: ["wide", "narrow"] }),
      env: OPEN_ENV,
      lookup: mixed,
      evidenceTokens: 120_000,
    });
    expect(lanes[0].fit).toBe("stuff");
    expect(lanes[1].fit).toBe("rag");
  });

  it("does not let blocked lanes reserve a concurrency slot", () => {
    const mixed = catalog([model("a")]);
    const { concurrency } = planLanes({
      config: config({ modelIds: ["a", "ghost1", "ghost2"] }),
      env: OPEN_ENV,
      lookup: mixed,
    });
    expect(concurrency).toBe(1);
  });

  it("never opens more connections than the depth allows", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const big = catalog(ids.map((id) => model(id)));
    const { concurrency } = planLanes({
      config: config({ modelIds: ids, depth: "deep" }),
      env: OPEN_ENV,
      lookup: big,
    });
    expect(concurrency).toBe(DEPTH_PRESETS.deep.concurrency);
  });

  it("always leaves a usable concurrency, even with nothing runnable", () => {
    const { concurrency } = planLanes({
      config: config({ modelIds: ["ghost"] }),
      env: OPEN_ENV,
      lookup: catalog([]),
    });
    expect(concurrency).toBeGreaterThanOrEqual(1);
  });
});

describe("pickArbiter", () => {
  const lookup = catalog([model("a"), model("b"), model("outsider")]);

  it("prefers a model that is not competing", () => {
    const pick = pickArbiter(["a", "b"], ["outsider"], OPEN_ENV, lookup);
    expect(pick).toEqual({ modelId: "outsider", isContestant: false });
  });

  it("skips candidates that are themselves lanes", () => {
    const pick = pickArbiter(["a", "b"], ["a", "outsider"], OPEN_ENV, lookup);
    expect(pick?.modelId).toBe("outsider");
  });

  it("falls back to a contestant, and says so", () => {
    const pick = pickArbiter(["a", "b"], [], OPEN_ENV, lookup);
    expect(pick).toEqual({ modelId: "a", isContestant: true });
  });

  it("returns null when nothing can run", () => {
    expect(pickArbiter(["a"], ["outsider"], CLOSED_ENV, lookup)).toBeNull();
  });
});
