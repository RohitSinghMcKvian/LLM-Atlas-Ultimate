import type { Todo, TodoStatus } from "@/lib/engine/types";

/**
 * Plan-and-approve for Atlas Chat (spec §4, agentic execution).
 *
 * `lib/engine/task-loop.ts` already implements the full
 * INTAKE → PLAN → (approve) → EXECUTE ⇄ VERIFY cycle, and the gap report called
 * for promoting it into chat. Most of it does not transfer, and pretending
 * otherwise would be the wrong kind of reuse: that loop's EXECUTE and VERIFY
 * phases operate on a **workspace** — reading files, applying changesets, running
 * `npm test` — and chat has no filesystem to act on. Bolting a fake workspace
 * under it would produce a loop that reports verdicts nothing verified.
 *
 * What does transfer is the discipline: state a plan, get it approved *before*
 * acting, execute steps against a budget, and show what happened. That is the
 * part that makes a multi-step chat turn auditable rather than a long opaque
 * pause. So this module reuses the engine's `Todo` type — the same shape the
 * /code loop and its UI already speak — and implements the chat-side steps
 * around it.
 *
 * Pure. Execution lives in the chat client, which owns the tool loop.
 */

/** Ceiling on plan size. A twenty-step plan in chat is a runaway, not a plan. */
export const MAX_STEPS = 8;
/** Below this, a plan is ceremony around a single answer. */
export const MIN_STEPS_TO_PLAN = 2;

export type PlanStatus = "draft" | "approved" | "running" | "done" | "rejected" | "aborted";

export interface ChatPlan {
  id: string;
  goal: string;
  steps: Todo[];
  status: PlanStatus;
  createdAt: number;
  /** Set when the run ended early, in words fit to show the user. */
  stoppedBy?: string;
}

/**
 * Build a plan from a model's numbered list.
 *
 * Free-text parsing rather than a tool call: asking for a plan as a tool forces
 * a second round trip and a schema the model has to satisfy before it has
 * thought about the problem. A numbered list is what models produce naturally,
 * and anything unparseable simply does not become a step — a plan that silently
 * gained a step from a stray line would be worse than a short one.
 */
export function parsePlan(raw: string, max = MAX_STEPS): Todo[] {
  const steps: Todo[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*(?:\d+[.)]|[-*•])\s+(.+)$/.exec(line);
    if (!m) continue;
    const text = m[1].trim().replace(/\s+/g, " ");
    if (!text || text.length > 300) continue;
    // A trailing colon marks a heading ("Steps:"), not a step.
    if (text.endsWith(":")) continue;
    steps.push(newStep(text, steps.length));
    if (steps.length >= max) break;
  }
  return steps;
}

function newStep(text: string, index: number): Todo {
  // `acceptance` is required by the engine's Todo. In chat there is no check to
  // run, so it restates the step as its own definition of done rather than
  // inventing a verdict nothing will produce.
  return {
    id: `s${index + 1}`,
    text,
    acceptance: text,
    status: "pending",
    verdicts: [],
    attempts: 0,
    strategyLog: [],
  };
}

/** Whether a request is worth planning at all. */
export function shouldPlan(steps: Todo[]): boolean {
  return steps.length >= MIN_STEPS_TO_PLAN;
}

export function createPlan(id: string, goal: string, steps: Todo[]): ChatPlan {
  return { id, goal, steps, status: "draft", createdAt: Date.now() };
}

/**
 * Advance a plan's state.
 *
 * A small explicit machine rather than scattered `setStatus` calls, so the
 * illegal transitions are illegal in one place. The one that matters:
 * **a plan can only run from `approved`.** If `start` accepted a draft, a bug
 * that skipped the prompt would execute an unapproved plan, which is precisely
 * the thing the approval gate exists to prevent.
 */
export function approvePlan(plan: ChatPlan): ChatPlan {
  if (plan.status !== "draft") return plan;
  return { ...plan, status: "approved" };
}

export function rejectPlan(plan: ChatPlan): ChatPlan {
  if (plan.status !== "draft") return plan;
  return { ...plan, status: "rejected" };
}

export function startPlan(plan: ChatPlan): ChatPlan {
  if (plan.status !== "approved") return plan;
  return { ...plan, status: "running" };
}

export function abortPlan(plan: ChatPlan, reason = "Stopped by the user."): ChatPlan {
  if (plan.status !== "running" && plan.status !== "approved") return plan;
  return { ...plan, status: "aborted", stoppedBy: reason };
}

/** Edit a step's text while the plan is still a draft. */
export function editStep(plan: ChatPlan, stepId: string, text: string): ChatPlan {
  if (plan.status !== "draft") return plan;
  const trimmed = text.trim();
  if (!trimmed) return plan;
  return {
    ...plan,
    steps: plan.steps.map((s) =>
      s.id === stepId ? { ...s, text: trimmed, acceptance: trimmed } : s,
    ),
  };
}

/** Drop a step from a draft. Removing the last one leaves nothing to approve. */
export function removeStep(plan: ChatPlan, stepId: string): ChatPlan {
  if (plan.status !== "draft") return plan;
  const steps = plan.steps.filter((s) => s.id !== stepId);
  if (steps.length === 0) return plan;
  return { ...plan, steps };
}

/**
 * Whether this is the last step the plan will run.
 *
 * Used to decide where to verify. Verifying after every step would halt working
 * builds: a step that writes `styles.css` legitimately leaves the previous
 * step's page unstyled and possibly unrendered, and treating that intermediate
 * state as a failure would stop the plan one step from finishing. The deliverable
 * is only supposed to work at the end, so that is the only place worth checking.
 */
export function isFinalStep(plan: ChatPlan, stepId: string): boolean {
  const idx = plan.steps.findIndex((s) => s.id === stepId);
  if (idx === -1) return false;
  // "Will not run" covers skipped and failed as well as done: `runPlanSteps`
  // aborts the remainder after a failure, so a step followed only by those is
  // still the last thing that actually executes.
  return plan.steps.every(
    (s, i) => i <= idx || s.status === "done" || s.status === "skipped" || s.status === "failed",
  );
}

export function setStepStatus(plan: ChatPlan, stepId: string, status: TodoStatus): ChatPlan {
  const steps = plan.steps.map((s) => (s.id === stepId ? { ...s, status } : s));
  const allSettled = steps.every(
    (s) => s.status === "done" || s.status === "failed" || s.status === "skipped",
  );
  return {
    ...plan,
    steps,
    status: allSettled && plan.status === "running" ? "done" : plan.status,
  };
}

/** The next step to run, or null when the plan is finished. */
export function nextStep(plan: ChatPlan): Todo | null {
  return plan.steps.find((s) => s.status === "pending") ?? null;
}

export function planProgress(plan: ChatPlan): { done: number; total: number; failed: number } {
  return {
    done: plan.steps.filter((s) => s.status === "done").length,
    failed: plan.steps.filter((s) => s.status === "failed").length,
    total: plan.steps.length,
  };
}

/** Prompt asking the model to produce a plan. */
export function planPrompt(goal: string, max = MAX_STEPS): string {
  return (
    `Break this request into at most ${max} concrete steps:\n\n${goal}\n\n` +
    "One step per line, numbered, no commentary before or after. Each step must " +
    "be something you can actually do with the tools available — searching, " +
    "reading project files, calling a connector, writing an artifact. If the " +
    "request needs no breakdown, reply with a single line: NO PLAN"
  );
}

/** True when the model declined to plan. */
export function declinedToPlan(raw: string): boolean {
  return /^\s*NO PLAN\s*$/im.test(raw.trim());
}

/** The step framed for execution, so each turn acts on one thing. */
export function stepPrompt(plan: ChatPlan, step: Todo): string {
  const done = plan.steps.filter((s) => s.status === "done").map((s) => `- ${s.text}`);
  return (
    `Overall goal: ${plan.goal}\n\n` +
    (done.length ? `Already done:\n${done.join("\n")}\n\n` : "") +
    `Now do exactly this one step, and nothing beyond it:\n${step.text}\n\n` +
    "Report what you found or did. Do not summarise the whole goal yet."
  );
}
