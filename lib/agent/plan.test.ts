import { describe, it, expect } from "vitest";
import {
  MAX_STEPS,
  MIN_STEPS_TO_PLAN,
  abortPlan,
  approvePlan,
  createPlan,
  declinedToPlan,
  editStep,
  isFinalStep,
  nextStep,
  parsePlan,
  planProgress,
  planPrompt,
  rejectPlan,
  removeStep,
  setStepStatus,
  shouldPlan,
  startPlan,
  stepPrompt,
  type ChatPlan,
} from "./plan";

const draft = (): ChatPlan =>
  createPlan("p1", "Research and summarise X", parsePlan("1. Search\n2. Read\n3. Summarise"));

describe("parsePlan", () => {
  it("reads a numbered list", () => {
    expect(parsePlan("1. First\n2. Second").map((s) => s.text)).toEqual(["First", "Second"]);
  });

  it("reads bullets too", () => {
    expect(parsePlan("- First\n* Second\n• Third").map((s) => s.text)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });

  it("assigns stable ids", () => {
    expect(parsePlan("1. a\n2. b").map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  // A plan that silently gained a step from a stray line is worse than a short one.
  it("ignores prose that is not a list item", () => {
    const steps = parsePlan("Here is my plan:\n1. Real step\nSome trailing commentary.");
    expect(steps.map((s) => s.text)).toEqual(["Real step"]);
  });

  it("ignores a heading that happens to be numbered", () => {
    expect(parsePlan("1. Steps:").map((s) => s.text)).toEqual([]);
  });

  it("ignores an over-long line", () => {
    expect(parsePlan(`1. ${"x".repeat(400)}`)).toEqual([]);
  });

  it("caps at MAX_STEPS", () => {
    const raw = Array.from({ length: 30 }, (_, i) => `${i + 1}. step ${i}`).join("\n");
    expect(parsePlan(raw)).toHaveLength(MAX_STEPS);
  });

  it("returns nothing for an empty or unparseable reply", () => {
    expect(parsePlan("")).toEqual([]);
    expect(parsePlan("no list here at all")).toEqual([]);
  });

  it("starts every step pending with no attempts", () => {
    for (const s of parsePlan("1. a\n2. b")) {
      expect(s.status).toBe("pending");
      expect(s.attempts).toBe(0);
      expect(s.verdicts).toEqual([]);
    }
  });
});

describe("shouldPlan", () => {
  it("declines to plan a single step", () => {
    expect(shouldPlan(parsePlan("1. Just answer"))).toBe(false);
  });

  it("plans from the minimum upward", () => {
    expect(shouldPlan(parsePlan("1. a\n2. b"))).toBe(true);
    expect(MIN_STEPS_TO_PLAN).toBe(2);
  });
});

describe("declinedToPlan", () => {
  it("recognises the opt-out", () => {
    expect(declinedToPlan("NO PLAN")).toBe(true);
    expect(declinedToPlan("  no plan  ")).toBe(true);
  });

  it("does not fire on an ordinary plan", () => {
    expect(declinedToPlan("1. do the thing")).toBe(false);
  });
});

describe("plan state machine", () => {
  it("starts as a draft", () => {
    expect(draft().status).toBe("draft");
  });

  it("approves and then runs", () => {
    expect(startPlan(approvePlan(draft())).status).toBe("running");
  });

  // The transition that matters: a bug that skipped the prompt must not be able
  // to execute an unapproved plan.
  it("cannot run without approval", () => {
    const d = draft();
    expect(startPlan(d).status).toBe("draft");
  });

  it("rejects a draft", () => {
    expect(rejectPlan(draft()).status).toBe("rejected");
  });

  it("cannot approve or reject after the decision is made", () => {
    const approved = approvePlan(draft());
    expect(rejectPlan(approved).status).toBe("approved");
    expect(approvePlan(rejectPlan(draft())).status).toBe("rejected");
  });

  it("aborts a running plan with a reason", () => {
    const running = startPlan(approvePlan(draft()));
    const stopped = abortPlan(running);
    expect(stopped.status).toBe("aborted");
    expect(stopped.stoppedBy).toContain("user");
  });

  it("will not abort a plan that never started", () => {
    expect(abortPlan(rejectPlan(draft())).status).toBe("rejected");
  });

  it("never mutates the plan it is given", () => {
    const d = draft();
    approvePlan(d);
    expect(d.status).toBe("draft");
  });
});

describe("editing a draft", () => {
  it("edits a step's text and its acceptance together", () => {
    const p = editStep(draft(), "s2", "Read carefully");
    const step = p.steps.find((s) => s.id === "s2")!;
    expect(step.text).toBe("Read carefully");
    expect(step.acceptance).toBe("Read carefully");
  });

  it("ignores an empty edit", () => {
    expect(editStep(draft(), "s1", "   ").steps[0].text).toBe("Search");
  });

  it("removes a step", () => {
    expect(removeStep(draft(), "s2").steps.map((s) => s.id)).toEqual(["s1", "s3"]);
  });

  // Removing the last one would leave nothing to approve.
  it("refuses to remove the only remaining step", () => {
    let p = removeStep(draft(), "s2");
    p = removeStep(p, "s3");
    expect(removeStep(p, "s1").steps).toHaveLength(1);
  });

  // Editing after approval would change what the user agreed to.
  it("cannot edit or remove once approved", () => {
    const approved = approvePlan(draft());
    expect(editStep(approved, "s1", "changed").steps[0].text).toBe("Search");
    expect(removeStep(approved, "s1").steps).toHaveLength(3);
  });
});

describe("execution", () => {
  const running = () => startPlan(approvePlan(draft()));

  it("hands out steps in order", () => {
    let p = running();
    expect(nextStep(p)!.id).toBe("s1");
    p = setStepStatus(p, "s1", "done");
    expect(nextStep(p)!.id).toBe("s2");
  });

  it("skips over a step that already failed", () => {
    let p = setStepStatus(running(), "s1", "failed");
    expect(nextStep(p)!.id).toBe("s2");
    p = setStepStatus(p, "s2", "skipped");
    expect(nextStep(p)!.id).toBe("s3");
  });

  it("returns null when nothing is pending", () => {
    let p = running();
    for (const id of ["s1", "s2", "s3"]) p = setStepStatus(p, id, "done");
    expect(nextStep(p)).toBeNull();
  });

  it("completes when every step is settled, however it settled", () => {
    let p = running();
    p = setStepStatus(p, "s1", "done");
    p = setStepStatus(p, "s2", "failed");
    expect(p.status).toBe("running");
    p = setStepStatus(p, "s3", "skipped");
    expect(p.status).toBe("done");
  });

  it("does not complete a plan that was never running", () => {
    let p = draft();
    for (const id of ["s1", "s2", "s3"]) p = setStepStatus(p, id, "done");
    expect(p.status).toBe("draft");
  });

  it("reports progress including failures", () => {
    let p = running();
    p = setStepStatus(p, "s1", "done");
    p = setStepStatus(p, "s2", "failed");
    expect(planProgress(p)).toEqual({ done: 1, failed: 1, total: 3 });
  });
});

describe("prompts", () => {
  it("asks for a bounded, numbered plan and offers the opt-out", () => {
    const p = planPrompt("Do a thing", 5);
    expect(p).toContain("at most 5");
    expect(p).toContain("NO PLAN");
    expect(p).toContain("Do a thing");
  });

  it("frames one step at a time and carries what is already done", () => {
    let p = startPlan(approvePlan(draft()));
    p = setStepStatus(p, "s1", "done");
    const prompt = stepPrompt(p, nextStep(p)!);
    expect(prompt).toContain("Already done:");
    expect(prompt).toContain("Search");
    expect(prompt).toContain("Read");
    expect(prompt).toContain("nothing beyond it");
  });

  it("omits the done section on the first step", () => {
    const p = startPlan(approvePlan(draft()));
    expect(stepPrompt(p, nextStep(p)!)).not.toContain("Already done:");
  });
});

/**
 * Which step is the last one that will actually run.
 *
 * This decides where the artifact gets verified. Verifying after every step
 * would halt working builds — a step that writes `styles.css` legitimately
 * leaves the previous step's page unrendered — so the answer has to be exactly
 * one step per run, and it has to be the right one.
 */
describe("isFinalStep", () => {
  const running = () => startPlan(approvePlan(draft()));

  it("is false for a step with work still queued behind it", () => {
    const p = running();
    expect(isFinalStep(p, "s1")).toBe(false);
    expect(isFinalStep(p, "s2")).toBe(false);
  });

  it("is true for the last step of a fresh plan", () => {
    expect(isFinalStep(running(), "s3")).toBe(true);
  });

  it("is true once everything after it is done", () => {
    let p = running();
    p = setStepStatus(p, "s2", "done");
    p = setStepStatus(p, "s3", "done");
    expect(isFinalStep(p, "s1")).toBe(true);
  });

  it("counts a skipped or failed step as one that will not run", () => {
    // `runPlanSteps` abandons the remainder after a failure, so a step followed
    // only by those really is the last thing that executes.
    let p = running();
    p = setStepStatus(p, "s3", "skipped");
    expect(isFinalStep(p, "s2")).toBe(true);
    p = setStepStatus(p, "s3", "failed");
    expect(isFinalStep(p, "s2")).toBe(true);
  });

  it("is false when a later step is still active", () => {
    let p = running();
    p = setStepStatus(p, "s3", "active");
    expect(isFinalStep(p, "s2")).toBe(false);
  });

  it("is false for a step that is not in the plan", () => {
    expect(isFinalStep(running(), "nope")).toBe(false);
  });

  it("marks exactly one step per plan, so a run verifies exactly once", () => {
    const p = running();
    expect(p.steps.filter((s) => isFinalStep(p, s.id))).toHaveLength(1);
  });
});
