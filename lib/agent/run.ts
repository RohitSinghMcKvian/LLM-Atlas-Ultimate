import type { Todo } from "@/lib/engine/types";
import { abortPlan, nextStep, setStepStatus, startPlan, type ChatPlan } from "./plan";

/**
 * Driving an approved plan to completion.
 *
 * Extracted from the chat client for the same reason `lib/chat/tool-loop.ts`
 * was: this is where plan mode's risky behaviour lives — running an unapproved
 * plan, running past a failure, running past Stop — and none of it is reachable
 * by a node-only test suite while it sits inside a React component.
 *
 * Knows nothing about React, models or the DOM. Each step is executed by an
 * injected callback; this module only decides whether there is a next step and
 * what the plan looks like afterwards.
 */

export interface PlanRunDeps {
  /**
   * Execute one step. Resolves with `error: true` when the step did not
   * produce an answer.
   *
   * The verdict is deliberately this thin. Chat has no workspace to verify
   * against, so anything richer — "did the step achieve its acceptance
   * criterion" — would be a judgement nothing checked.
   */
  runStep: (plan: ChatPlan, step: Todo) => Promise<{ error?: boolean }>;
  /** Called on every transition, so a caller can render progress. */
  onPlan?: (plan: ChatPlan) => void;
  /** Polled before each step. True stops the run where it stands. */
  shouldStop?: () => boolean;
}

export const STOPPED_BY_USER = "Plan stopped — the remaining steps were not run.";
export const STOPPED_BY_FAILURE = "A step failed, so the remaining steps were not run.";

/**
 * Run every step of an approved plan, in order, until one fails or the caller
 * stops it.
 *
 * **A plan that was never approved does not run.** `startPlan` refuses any
 * status but `approved`, and this checks the result rather than assuming it, so
 * a caller that skipped the approval prompt gets a no-op instead of an
 * unapproved execution. That is the property the whole mode rests on.
 */
export async function runPlanSteps(plan: ChatPlan, deps: PlanRunDeps): Promise<ChatPlan> {
  let current = startPlan(plan);
  if (current.status !== "running") return plan;
  deps.onPlan?.(current);

  for (;;) {
    const step = nextStep(current);
    if (!step) break;

    if (deps.shouldStop?.()) {
      current = abortPlan(current, STOPPED_BY_USER);
      deps.onPlan?.(current);
      return current;
    }

    current = setStepStatus(current, step.id, "active");
    deps.onPlan?.(current);

    // A throwing step is a failed step, not a crashed run: the plan still has
    // to be left in a state the user can read.
    let failed: boolean;
    try {
      failed = !!(await deps.runStep(current, step)).error;
    } catch {
      failed = true;
    }
    // Stopping mid-step counts as stopped, not as a step that succeeded.
    const stopped = !!deps.shouldStop?.();

    current = setStepStatus(current, step.id, failed || stopped ? "failed" : "done");
    deps.onPlan?.(current);

    if (failed || stopped) {
      // Continuing past a failed step would build the ones after it on an
      // answer that is not there.
      current = abortPlan(current, stopped ? STOPPED_BY_USER : STOPPED_BY_FAILURE);
      deps.onPlan?.(current);
      return current;
    }
  }

  deps.onPlan?.(current);
  return current;
}
