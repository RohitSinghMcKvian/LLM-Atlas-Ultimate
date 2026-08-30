import { describe, it, expect } from "vitest";
import {
  RESUME_MAX_AGE_MS,
  describeResume,
  planResume,
  resumable,
  retryableLanes,
  unfinishedLanes,
  unfinishedStages,
} from "./resume";
import { emptyStages, type CompareRun, type LaneState, type Stage, type StageStatus } from "./types";

const lane = (id: string, status: LaneState["status"], over: Partial<LaneState> = {}): LaneState => ({
  id,
  modelId: id,
  band: 0,
  fit: "stuff",
  maxTokens: 1_000,
  budgetUsd: 0.1,
  status,
  text: "",
  reasoning: "",
  meters: {},
  ...over,
});

function stages(over: Partial<Record<Stage, StageStatus>>): CompareRun["stages"] {
  const base = emptyStages();
  for (const [k, v] of Object.entries(over)) base[k as Stage] = { status: v as StageStatus };
  return base;
}

const run = (over: Partial<CompareRun> = {}): CompareRun => ({
  id: "run-1",
  createdAt: 1_000,
  updatedAt: 1_000,
  config: { question: "why?", modelIds: ["a"], depth: "standard" },
  stages: emptyStages(),
  lanes: [],
  ...over,
});

describe("unfinishedStages", () => {
  it("treats done and skipped alike — a skipped stage is a decision, not a gap", () => {
    const s = stages({ brief: "done", evidence: "skipped" });
    expect(unfinishedStages({ stages: s })).toEqual(["lanes", "analyse", "synthesis"]);
  });

  it("treats a stage left running as unfinished, since nobody may be driving it", () => {
    const s = stages({ brief: "done", evidence: "done", lanes: "running" });
    expect(unfinishedStages({ stages: s })).toContain("lanes");
  });

  it("treats an errored stage as unfinished so it can be tried again", () => {
    const s = stages({ brief: "error" });
    expect(unfinishedStages({ stages: s })[0]).toBe("brief");
  });
});

describe("unfinishedLanes", () => {
  it("picks up lanes that never reached a terminal state", () => {
    expect(unfinishedLanes([lane("a", "streaming"), lane("b", "queued"), lane("c", "done")])).toEqual([
      "a",
      "b",
    ]);
  });

  it("leaves a stopped lane alone — stopping was the user's decision", () => {
    expect(unfinishedLanes([lane("a", "stopped")])).toEqual([]);
  });

  it("does not silently re-run a failed lane", () => {
    // Re-running a key_required lane would fail identically on every reload, and
    // a lane that failed mid-answer would be billed a second time.
    expect(unfinishedLanes([lane("a", "error")])).toEqual([]);
  });

  it("ignores lanes that were blocked before they started", () => {
    expect(unfinishedLanes([lane("a", "error", { blocked: { code: "key_required", message: "x" } })])).toEqual(
      [],
    );
  });
});

describe("retryableLanes", () => {
  it("offers failed lanes for a manual retry", () => {
    expect(retryableLanes([lane("a", "error"), lane("b", "done")])).toEqual(["a"]);
  });

  it("does not offer a retry for something that cannot run at all", () => {
    expect(retryableLanes([lane("a", "error", { blocked: { code: "no_route", message: "x" } })])).toEqual([]);
  });
});

describe("planResume", () => {
  it("is complete when every stage settled and no lane is open", () => {
    const plan = planResume(
      run({
        stages: stages({
          brief: "done",
          evidence: "skipped",
          lanes: "done",
          analyse: "done",
          synthesis: "done",
        }),
        lanes: [lane("a", "done")],
      }),
    );
    expect(plan.complete).toBe(true);
    expect(plan.stages).toEqual([]);
  });

  it("re-opens the lanes stage when a lane is still in flight, even if the stage says done", () => {
    // This is the checkpoint written as the tab went away: the stage was marked
    // done by an optimistic write while a lane was mid-stream.
    const plan = planResume(
      run({
        stages: stages({
          brief: "done",
          evidence: "done",
          lanes: "done",
          analyse: "done",
          synthesis: "done",
        }),
        lanes: [lane("a", "done"), lane("b", "streaming")],
      }),
    );
    expect(plan.complete).toBe(false);
    expect(plan.stages).toEqual(["lanes"]);
    expect(plan.laneIds).toEqual(["b"]);
  });

  it("keeps stages in canonical order", () => {
    const plan = planResume(
      run({
        stages: stages({ brief: "done", evidence: "done", lanes: "done", analyse: "pending" }),
        lanes: [lane("a", "queued")],
      }),
    );
    expect(plan.stages).toEqual(["lanes", "analyse", "synthesis"]);
  });

  it("does not list a lane twice when the stage was already unfinished", () => {
    const plan = planResume(
      run({
        stages: stages({ brief: "done", evidence: "done", lanes: "running" }),
        lanes: [lane("a", "streaming")],
      }),
    );
    expect(plan.stages.filter((s) => s === "lanes")).toHaveLength(1);
  });
});

describe("resumable", () => {
  const open = run({
    updatedAt: 10_000,
    stages: stages({ brief: "done" }),
    lanes: [lane("a", "streaming")],
  });

  it("offers a recent unfinished run", () => {
    expect(resumable(open, 10_000)).toBe(true);
  });

  it("does not offer a run abandoned hours ago", () => {
    expect(resumable(open, 10_000 + RESUME_MAX_AGE_MS + 1)).toBe(false);
  });

  it("does not offer a run that failed outright", () => {
    expect(resumable({ ...open, error: "boom" }, 10_000)).toBe(false);
  });

  it("does not offer a finished run", () => {
    const done = run({
      updatedAt: 10_000,
      stages: stages({
        brief: "done",
        evidence: "done",
        lanes: "done",
        analyse: "done",
        synthesis: "done",
      }),
      lanes: [lane("a", "done")],
    });
    expect(resumable(done, 10_000)).toBe(false);
  });
});

describe("describeResume", () => {
  it("names what will actually be re-run", () => {
    const plan = planResume(
      run({
        stages: stages({ brief: "done", evidence: "done", lanes: "running" }),
        lanes: [lane("a", "streaming"), lane("b", "queued")],
      }),
    );
    expect(describeResume(plan)).toContain("2 lanes");
    expect(describeResume(plan)).toContain("analyse");
  });

  it("says so when there is nothing left", () => {
    expect(describeResume({ stages: [], laneIds: [], complete: true, retryable: [] })).toBe(
      "This run finished.",
    );
  });
});
