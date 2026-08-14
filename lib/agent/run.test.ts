import { describe, it, expect, vi } from "vitest";
import {
  approvePlan,
  createPlan,
  isFinalStep,
  parsePlan,
  planProgress,
  type ChatPlan,
} from "./plan";
import { runPlanSteps, STOPPED_BY_FAILURE, STOPPED_BY_USER } from "./run";

const THREE = `1. Read the config
2. Find the failing case
3. Write the fix`;

function draft(): ChatPlan {
  return createPlan("p1", "fix the bug", parsePlan(THREE));
}

function approved(): ChatPlan {
  return approvePlan(draft());
}

describe("runPlanSteps", () => {
  it("runs every step in order and finishes", async () => {
    const seen: string[] = [];
    const final = await runPlanSteps(approved(), {
      runStep: async (_p, step) => {
        seen.push(step.text);
        return {};
      },
    });
    expect(seen).toEqual(["Read the config", "Find the failing case", "Write the fix"]);
    expect(final.status).toBe("done");
    expect(planProgress(final)).toEqual({ done: 3, total: 3, failed: 0 });
  });

  // The property the whole mode rests on: a bug that skipped the approval
  // prompt must produce a no-op, not an unapproved execution.
  it("refuses to run a plan that was never approved", async () => {
    const runStep = vi.fn(async () => ({}));
    const final = await runPlanSteps(draft(), { runStep });
    expect(runStep).not.toHaveBeenCalled();
    expect(final.status).toBe("draft");
  });

  it("refuses to re-run a plan that already finished", async () => {
    const first = await runPlanSteps(approved(), { runStep: async () => ({}) });
    const runStep = vi.fn(async () => ({}));
    const again = await runPlanSteps(first, { runStep });
    expect(runStep).not.toHaveBeenCalled();
    expect(again.status).toBe("done");
  });

  // Later steps are written against what the earlier ones found, so continuing
  // past a failure builds on an answer that is not there.
  it("stops at a failed step and leaves the rest pending", async () => {
    const runStep = vi.fn(async (_p: ChatPlan, step: { id: string }) =>
      step.id === "s2" ? { error: true } : {},
    );
    const final = await runPlanSteps(approved(), { runStep });
    expect(runStep).toHaveBeenCalledTimes(2);
    expect(final.status).toBe("aborted");
    expect(final.stoppedBy).toBe(STOPPED_BY_FAILURE);
    expect(final.steps.map((s) => s.status)).toEqual(["done", "failed", "pending"]);
  });

  it("treats a thrown step as a failed one rather than a crashed run", async () => {
    const final = await runPlanSteps(approved(), {
      runStep: async () => {
        throw new Error("network");
      },
    });
    expect(final.status).toBe("aborted");
    expect(final.steps[0].status).toBe("failed");
  });

  it("stops before the next step when the caller asks it to", async () => {
    let stop = false;
    const runStep = vi.fn(async () => {
      stop = true;
      return {};
    });
    const final = await runPlanSteps(approved(), { runStep, shouldStop: () => stop });
    // The first step still completed; nothing after it was started.
    expect(runStep).toHaveBeenCalledTimes(1);
    expect(final.status).toBe("aborted");
    expect(final.stoppedBy).toBe(STOPPED_BY_USER);
  });

  // Stop pressed mid-stream leaves a half-written answer; calling that step
  // "done" would let a later step build on it.
  it("does not mark a step done when the stop arrived during it", async () => {
    let stop = false;
    const final = await runPlanSteps(approved(), {
      runStep: async () => {
        stop = true;
        return {};
      },
      shouldStop: () => stop,
    });
    expect(final.steps[0].status).toBe("failed");
    expect(final.stoppedBy).toBe(STOPPED_BY_USER);
  });

  it("never runs a step before the caller has seen the plan running", async () => {
    const events: string[] = [];
    await runPlanSteps(approved(), {
      onPlan: (p) => events.push(`plan:${p.status}`),
      runStep: async () => {
        events.push("step");
        return {};
      },
    });
    expect(events[0]).toBe("plan:running");
    expect(events.indexOf("step")).toBeGreaterThan(0);
  });

  it("reports each transition so progress can be rendered", async () => {
    const statuses: string[][] = [];
    await runPlanSteps(approved(), {
      onPlan: (p) => statuses.push(p.steps.map((s) => s.status)),
      runStep: async () => ({}),
    });
    // Every step is seen active before it is seen done.
    expect(statuses.some((s) => s[0] === "active")).toBe(true);
    expect(statuses[statuses.length - 1]).toEqual(["done", "done", "done"]);
  });
});

/**
 * Where the artifact gets verified during a plan run.
 *
 * `isFinalStep` is what `approveActivePlan` passes to `streamInto` as
 * `opts.verify`. The property that matters is not "the last step is true" — it
 * is that across a whole run the answer is true **exactly once**. Verifying more
 * often halts working builds on intermediate state; verifying never means a plan
 * can deliver a page that does not run.
 */
describe("verification points across a plan run", () => {
  const threeStep = () =>
    approvePlan(createPlan("p", "goal", parsePlan("1. a\n2. b\n3. c")));

  it("verifies exactly once, on the last step", async () => {
    const verified: string[] = [];
    await runPlanSteps(threeStep(), {
      runStep: async (current, step) => {
        // Called exactly as the component calls it: the step is already active.
        if (isFinalStep(current, step.id)) verified.push(step.id);
        return {};
      },
    });
    expect(verified).toEqual(["s3"]);
  });

  it("still verifies once when the plan is a single step", async () => {
    const verified: string[] = [];
    await runPlanSteps(approvePlan(createPlan("p", "g", parsePlan("1. only"))), {
      runStep: async (current, step) => {
        if (isFinalStep(current, step.id)) verified.push(step.id);
        return {};
      },
    });
    expect(verified).toEqual(["s1"]);
  });

  it("verifies nothing when a step fails before the end", async () => {
    // The run is abandoned, so there is no finished deliverable to check — and
    // charging a verification for a build that stopped halfway would be noise.
    const verified: string[] = [];
    const out = await runPlanSteps(threeStep(), {
      runStep: async (current, step) => {
        if (isFinalStep(current, step.id)) verified.push(step.id);
        return { error: step.id === "s2" };
      },
    });
    expect(verified).toEqual([]);
    expect(out.status).toBe("aborted");
  });

  it("verifies nothing when the user stops the run", async () => {
    const verified: string[] = [];
    let stop = false;
    await runPlanSteps(threeStep(), {
      shouldStop: () => stop,
      runStep: async (current, step) => {
        if (isFinalStep(current, step.id)) verified.push(step.id);
        stop = true;
        return {};
      },
    });
    expect(verified).toEqual([]);
  });
});
