import { formatArtifactErrors } from "./artifact-bridge";
import { parseStackTrace } from "@/lib/engine/debug";
import { MAX_PROMPT_ERRORS, type Triage } from "./artifact-verify";

/**
 * Deciding whether to spend another model turn on a broken artifact.
 *
 * Modelled on the engine's self-correct loop (lib/engine/task-loop.ts), and
 * borrowing its one genuinely load-bearing rule: **retrying an identical strategy
 * against an identical failure is prohibited**. Without it a "bounded" loop is
 * only bounded by its attempt cap, and it will spend every attempt re-sending a
 * prompt the model already failed to act on.
 *
 * Pure, and separate from the driver, so the arithmetic of "may we spend money"
 * is testable without a network, a DOM, or a model.
 */

export type RepairStrategy = "minimal_fix" | "isolate" | "simplify";

export type GiveUpReason =
  | "attempts"
  | "repeat"
  | "no-progress"
  | "budget"
  | "aborted"
  | "unfixable"
  | "errored";

export interface RepairLimits {
  /** Model turns that may be spent. 0 disables repair while leaving verification on. */
  maxAttempts: number;
  /** Ceiling across the whole repair phase of one turn. */
  maxUsd: number;
  /** Wall clock across the whole repair phase. */
  maxMs: number;
}

/**
 * One attempt in chat, two in build mode.
 *
 * One is the honest chat default: it converts the common single-mistake artifact
 * from broken to working for the price of one turn, and stops. Build mode exists
 * to produce something that works, and its artifacts are bigger, so it gets the
 * second rung of the ladder.
 */
export function repairLimitsFor(
  buildMode: boolean,
  overrides: Partial<RepairLimits> = {},
): RepairLimits {
  return {
    maxAttempts: buildMode ? 2 : 1,
    maxUsd: 0.5,
    maxMs: 3 * 60_000,
    ...overrides,
  };
}

export interface RepairAttempt {
  signature: string;
  strategy: RepairStrategy;
  fatalBefore: number;
  fatalAfter?: number;
  spentUsd: number;
  at: number;
}

export interface RepairState {
  /** The artifact being repaired. Versions are appended to this path. */
  path: string;
  status: "verifying" | "repairing" | "clean" | "gave_up";
  attempts: RepairAttempt[];
  /** signature to strategies already spent on it. The memo. */
  tried: Record<string, RepairStrategy[]>;
  spentUsd: number;
  startedAt: number;
  gaveUpBecause?: GiveUpReason;
  /** Errors still present when the run ended. Recorded on the message. */
  surviving: string[];
}

export function initialRepairState(path: string, now = Date.now()): RepairState {
  return {
    path,
    status: "verifying",
    attempts: [],
    tried: {},
    spentUsd: 0,
    startedAt: now,
    surviving: [],
  };
}

/**
 * The escalation ladder.
 *
 * Same shape as `nextStrategy` in lib/engine/debug.ts, different rungs, because
 * an artifact has no shell to instrument and no checkpoint to bisect against.
 * What it does have is composability: most broken artifacts are one good page
 * plus one bad subsystem, so "take the animation out, confirm the rest renders,
 * put it back" is the artifact-shaped version of instrumenting.
 */
export function nextRepairStrategy(attempt: number): RepairStrategy {
  if (attempt <= 0) return "minimal_fix";
  if (attempt === 1) return "isolate";
  return "simplify";
}

/** Whether another attempt with this strategy is allowed. */
export function canRepair(
  state: RepairState,
  signature: string,
  strategy: RepairStrategy,
  limits: RepairLimits,
  now = Date.now(),
): boolean {
  if (state.attempts.length >= limits.maxAttempts) return false;
  if (state.spentUsd >= limits.maxUsd) return false;
  if (now - state.startedAt >= limits.maxMs) return false;
  // The engine's rule: the same strategy against the same failure is not a
  // second attempt, it is the first one repeated.
  return !(state.tried[signature] ?? []).includes(strategy);
}

/**
 * Spend and outcome are separate events on purpose.
 *
 * What an attempt cost is known the moment its turn ends; whether it *worked* is
 * only known after the artifact has been run again. Folding both into one event
 * meant recording the pre-repair error count as the post-repair result, which
 * made every attempt look like it changed nothing.
 */
export type RepairEvent =
  | { type: "attempt"; signature: string; strategy: RepairStrategy; fatalBefore: number; at: number }
  | { type: "result"; spentUsd: number }
  | { type: "measured"; fatalAfter: number }
  | { type: "settle"; status: "clean" | "gave_up"; reason?: GiveUpReason; surviving: string[] };

export function repairReducer(state: RepairState, event: RepairEvent): RepairState {
  switch (event.type) {
    case "attempt": {
      const tried = { ...state.tried };
      tried[event.signature] = [...(tried[event.signature] ?? []), event.strategy];
      return {
        ...state,
        status: "repairing",
        tried,
        attempts: [
          ...state.attempts,
          {
            signature: event.signature,
            strategy: event.strategy,
            fatalBefore: event.fatalBefore,
            spentUsd: 0,
            at: event.at,
          },
        ],
      };
    }
    case "result": {
      if (state.attempts.length === 0) return state;
      const attempts = [...state.attempts];
      const last = { ...attempts[attempts.length - 1], spentUsd: event.spentUsd };
      attempts[attempts.length - 1] = last;
      return { ...state, attempts, spentUsd: state.spentUsd + event.spentUsd };
    }
    case "measured": {
      if (state.attempts.length === 0) return state;
      const attempts = [...state.attempts];
      attempts[attempts.length - 1] = {
        ...attempts[attempts.length - 1],
        fatalAfter: event.fatalAfter,
      };
      return { ...state, attempts };
    }
    case "settle":
      return {
        ...state,
        status: event.status,
        gaveUpBecause: event.reason,
        surviving: event.surviving,
      };
    default:
      return state;
  }
}

export type RepairDecision =
  | { kind: "done" }
  | { kind: "repair"; strategy: RepairStrategy; instruction: string }
  | { kind: "stop"; reason: GiveUpReason };

/**
 * What to do about the latest verification.
 *
 * The `unfixable` branch is the one that keeps this honest. An artifact whose
 * only problems are host faults — a library Atlas failed to vendor, a runtime
 * file that did not load — is broken for the user and unfixable by the model. It
 * stops immediately, before spending anything, because there is no prompt that
 * would change the outcome.
 */
export function planRepair(
  state: RepairState,
  triage: Triage,
  limits: RepairLimits,
  now = Date.now(),
): RepairDecision {
  if (triage.fatal.length === 0) {
    return triage.host.length > 0 ? { kind: "stop", reason: "unfixable" } : { kind: "done" };
  }

  const previous = state.attempts[state.attempts.length - 1];
  // The failure did not move even though the strategy escalated: the model did
  // not understand the error, and another round is cost without a hypothesis.
  if (previous && previous.signature === triage.signature && previous.fatalAfter !== undefined) {
    return { kind: "stop", reason: "repeat" };
  }

  if (state.attempts.length >= limits.maxAttempts) return { kind: "stop", reason: "attempts" };
  if (state.spentUsd >= limits.maxUsd) return { kind: "stop", reason: "budget" };
  if (now - state.startedAt >= limits.maxMs) return { kind: "stop", reason: "budget" };

  const strategy = nextRepairStrategy(state.attempts.length);
  if (!canRepair(state, triage.signature, strategy, limits, now)) {
    return { kind: "stop", reason: "repeat" };
  }

  return { kind: "repair", strategy, instruction: repairInstruction(triage, strategy, state.path) };
}

/** Per-strategy guidance, appended to the machine-generated error report. */
const STRATEGY_TEXT: Record<RepairStrategy, string> = {
  minimal_fix:
    "Change only what the error names. Do not restructure the file, rename anything, or rewrite working sections.",
  isolate:
    "The direct fix did not hold, so the cause is probably not the line the error names. Remove or stub the smallest subsystem that could produce it — the chart, the animation, the icon set — and confirm the rest of the page renders. Then reintroduce that piece correctly. If the page rendered nothing at all, start from a plain heading and add the real content back.",
  simplify:
    "Two attempts have failed. Rewrite the file using only React, plain CSS and the preloaded globals, dropping any library that is not essential. A simpler artifact that runs is worth more than a richer one that does not.",
};

/**
 * The repair request.
 *
 * Built on `formatArtifactErrors`, which already frames the block as data rather
 * than instructions — the text comes from model-written code, so a page that
 * logs "ignore your previous instructions" is a thing that can happen. That
 * framing matters more here than it did for the manual button, because nobody is
 * reading this before it is sent.
 *
 * Only fatal errors go in. Warnings would spend the model's attention on a React
 * key notice, and host faults would ask it to fix something it cannot reach.
 */
export function repairInstruction(
  triage: Triage,
  strategy: RepairStrategy,
  path: string,
): string {
  const messages = triage.fatal
    .slice(0, MAX_PROMPT_ERRORS)
    .map((e) => (e.line ? `${e.message} (line ${e.line})` : e.message));

  // Workspace frames first, node_modules noise last — `parseStackTrace` already
  // sorts them that way, and the top frame is usually the whole answer.
  const frames = triage.fatal
    .flatMap((e) => parseStackTrace(e.message))
    .slice(0, 3)
    .map((f) => `- ${f.file}:${f.line}${f.fn ? ` in ${f.fn}` : ""}`);

  return [
    formatArtifactErrors(messages),
    frames.length ? `Frames from the stack:\n${frames.join("\n")}` : "",
    `The file to change is \`${path}\`.`,
    STRATEGY_TEXT[strategy],
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Why the loop stopped, for the user.
 *
 * Enumerated rather than defaulted, so a new `GiveUpReason` cannot ship without
 * someone deciding what it says.
 */
export function describeGiveUp(state: RepairState): string {
  const n = state.surviving.length;
  const errs = `${n} ${n === 1 ? "error" : "errors"}`;
  switch (state.gaveUpBecause) {
    case "unfixable":
      return `Atlas could not run this artifact — it needs something the preview does not provide. This is a limitation of the preview, not a mistake in the code.`;
    case "repeat":
      return `Atlas tried to fix ${errs} and hit the same failure again, so it stopped rather than keep spending.`;
    case "attempts":
      return `Atlas could not fix ${errs} in ${state.attempts.length} ${state.attempts.length === 1 ? "attempt" : "attempts"}.`;
    case "no-progress":
      return `Atlas tried to fix ${errs} but the artifact did not change.`;
    case "budget":
      return `Atlas stopped fixing this artifact at its spend limit for the turn. ${errs} remain.`;
    case "aborted":
      return `Stopped before the artifact was fixed. ${errs} remain.`;
    case "errored":
      return `The repair attempt itself failed. ${errs} remain.`;
    default:
      return `${errs} remain in this artifact.`;
  }
}
