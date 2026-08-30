import { describe, it, expect } from "vitest";
import { EXPECTED_OUTPUT_RATIO, estimateRunCost, laneCost, runActuals, valueRatio } from "./cost";
import type { LaneModel } from "./lanes";
import { emptyStages, type CompareRun, type LanePlan, type LaneState } from "./types";

const model = (id: string, inPerM: number, outPerM: number): LaneModel => ({
  id,
  name: id,
  contextWindow: 200_000,
  maxOutput: 8_000,
  pricing: { inputPerM: inPerM, outputPerM: outPerM, effectiveFrom: "2026-01-01" },
  routes: [{ provider: "nvidia", model: id }],
  license: "open",
});

const lookup = (models: LaneModel[]) => {
  const map = new Map(models.map((m) => [m.id, m]));
  return (id: string) => map.get(id);
};

const plan = (id: string, over: Partial<LanePlan> = {}): LanePlan => ({
  id,
  modelId: id,
  band: 0,
  fit: "stuff",
  maxTokens: 1_000,
  budgetUsd: 0.15,
  ...over,
});

const lane = (id: string, over: Partial<LaneState> = {}): LaneState => ({
  ...plan(id),
  status: "done",
  text: "",
  reasoning: "",
  meters: {},
  ...over,
});

describe("estimateRunCost", () => {
  const models = [model("cheap", 1, 2), model("dear", 10, 30)];

  it("returns a range with expected between the ends", () => {
    const c = estimateRunCost({
      question: "why?",
      lanes: [plan("cheap"), plan("dear")],
      depth: "standard",
      lookup: lookup(models),
    });
    expect(c.low).toBeLessThan(c.expected);
    expect(c.expected).toBeLessThan(c.high);
  });

  it("counts the arbiter passes, not just the lanes", () => {
    const c = estimateRunCost({
      question: "why?",
      lanes: [plan("cheap")],
      depth: "standard",
      lookup: lookup(models),
    });
    // The old estimate omitted these entirely, which is the bug this replaces.
    expect(c.arbiters).toBeGreaterThan(0);
    expect(c.expected).toBeGreaterThan(Object.values(c.perLane).reduce((a, b) => a + b, 0));
  });

  it("charges Deep more than Quick for the same lanes", () => {
    const args = { question: "why?", lanes: [plan("dear")], lookup: lookup(models) };
    const quick = estimateRunCost({ ...args, depth: "quick" });
    const deep = estimateRunCost({ ...args, depth: "deep" });
    expect(deep.expected).toBeGreaterThan(quick.expected);
  });

  it("does not charge a stuffed lane's evidence to a retrieving lane", () => {
    const stuffed = estimateRunCost({
      question: "why?",
      lanes: [plan("dear", { fit: "stuff" })],
      depth: "standard",
      evidenceTokens: 200_000,
      lookup: lookup(models),
    });
    const retrieved = estimateRunCost({
      question: "why?",
      lanes: [plan("dear", { fit: "rag" })],
      depth: "standard",
      evidenceTokens: 200_000,
      lookup: lookup(models),
    });
    expect(retrieved.expected).toBeLessThan(stuffed.expected);
  });

  it("charges nothing for a blocked lane", () => {
    const withBlocked = estimateRunCost({
      question: "why?",
      lanes: [plan("cheap"), plan("dear", { blocked: { code: "key_required", message: "x" } })],
      depth: "quick",
      lookup: lookup(models),
    });
    expect(withBlocked.perLane).not.toHaveProperty("dear");
  });

  it("is zero when nothing can run", () => {
    const none = estimateRunCost({
      question: "why?",
      lanes: [plan("cheap", { blocked: { code: "no_route", message: "x" } })],
      depth: "deep",
      lookup: lookup(models),
    });
    expect(none.expected).toBe(0);
  });

  it("assumes a lane uses its expected share of the ceiling, not all of it", () => {
    const one = estimateRunCost({
      question: "",
      lanes: [plan("cheap", { maxTokens: 1_000 })],
      depth: "quick",
      lookup: lookup(models),
    });
    // high/expected should track the ratio, net of the fixed arbiter passes.
    const laneHigh = one.high - one.arbiters;
    const laneExpected = one.expected - one.arbiters;
    const laneLow = one.low - one.arbiters;
    expect((laneExpected - laneLow) / (laneHigh - laneLow)).toBeCloseTo(EXPECTED_OUTPUT_RATIO, 5);
  });
});

describe("laneCost", () => {
  it("is zero when the provider reported no usage", () => {
    expect(laneCost({ modelId: "anything", meters: {} })).toBe(0);
  });

  it("is zero for a model that is not in the catalog", () => {
    expect(
      laneCost({ modelId: "not-a-real-model-id", meters: { promptTokens: 100, completionTokens: 100 } }),
    ).toBe(0);
  });
});

describe("runActuals", () => {
  const run = (over: Partial<CompareRun> = {}): Pick<CompareRun, "lanes" | "stages"> => ({
    lanes: [],
    stages: emptyStages(),
    ...over,
  });

  it("adds what the stages spent to what the lanes spent", () => {
    const stages = emptyStages();
    stages.synthesis = { status: "done", costUsd: 0.02, promptTokens: 500, completionTokens: 200 };
    stages.brief = { status: "done", costUsd: 0.01 };
    const a = runActuals(run({ stages }));
    expect(a.total).toBeCloseTo(0.03, 10);
    expect(a.perStage.synthesis).toBe(0.02);
    expect(a.promptTokens).toBe(500);
  });

  it("reports lanes that finished without usage rather than calling them free", () => {
    const a = runActuals(
      run({ lanes: [lane("a"), lane("b", { meters: { promptTokens: 10, completionTokens: 10 } })] }),
    );
    expect(a.unreported).toEqual(["a"]);
  });

  it("ignores lanes that never ran", () => {
    const a = runActuals(run({ lanes: [lane("a", { status: "queued" })] }));
    expect(a.unreported).toEqual([]);
    expect(a.perLane).toEqual({});
  });
});

describe("valueRatio", () => {
  it("treats a free lane as unbeatable value", () => {
    expect(valueRatio(0, 7)).toBe(Number.POSITIVE_INFINITY);
  });

  it("returns null for an unscored lane rather than ranking it last", () => {
    expect(valueRatio(1, undefined)).toBeNull();
  });

  it("prefers more score per dollar", () => {
    expect(valueRatio(2, 8)!).toBeGreaterThan(valueRatio(4, 8)!);
  });
});
