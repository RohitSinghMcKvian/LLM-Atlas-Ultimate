/**
 * Budgets for a build turn.
 *
 * Build mode raises the tool-round cap from 4 to 20 and the per-turn output
 * budget from 16k to 32k. Those numbers are what a real build needs and also
 * what makes one expensive: a model that keeps re-reading its own files could
 * previously spend four rounds going nowhere, and can now spend twenty.
 *
 * Modelled on `lib/research/budget.ts` — every spend goes through one method, so
 * "did it stay inside the caps" is a property of this module rather than a claim
 * about several call sites. Two things are added that research does not need:
 *
 *  - **A money ceiling.** Rounds and tokens are proxies; spend is the thing
 *    people actually care about, and it is the only limit whose right value
 *    depends on the user rather than on the model.
 *  - **A no-progress halt.** The round cap exists because a looping model would
 *    otherwise burn the context window. But a counter cannot tell a build that
 *    is working from one that is stuck — and a build that has written no file
 *    and moved no task for two consecutive rounds is stuck. Stopping on that is
 *    both faster and more honest than waiting for round twenty.
 *
 * What counts as progress lives in `lib/chat/progress.ts`, because it depends on
 * what each tool means and this module should only have to count.
 */

import { isLooping, type RoundProgress } from "./progress";

export interface BuildLimits {
  /** Tool rounds: stream → run tools → stream again. */
  maxRounds: number;
  /** Resume requests after a truncated answer, across the whole turn. */
  maxContinuations: number;
  /** `max_tokens` ceiling for one request. */
  outputCeiling: number;
  /** Wall-clock for the whole turn. */
  maxMs: number;
  /** Hard spend ceiling for the turn, in USD. */
  maxUsd: number;
  /**
   * Consecutive rounds that learned nothing before halting.
   *
   * "Learned nothing" is stricter than it used to be. This counter was once
   * reset only by a write, which made searching, reading and every connector
   * call count as getting nowhere — so a build that did any research at all
   * halted after two rounds. It is now reset by anything informative too; see
   * `lib/chat/progress.ts`.
   */
  maxBarrenRounds: number;
  /**
   * Consecutive rounds with no write at all before halting.
   *
   * The other half of the pair. Reading is progress, but only for so long: a run
   * that has gathered context for six straight rounds and produced nothing is
   * not researching, it is avoiding the work.
   */
  maxUnproductiveRounds: number;
}

/**
 * Ordinary turns keep exactly what they had before, so nothing about a normal
 * conversation changes: 4 rounds, 3 continuations, a 16k output budget.
 */
export const CHAT_LIMITS: BuildLimits = {
  maxRounds: 4,
  maxContinuations: 3,
  outputCeiling: 16_384,
  maxMs: 5 * 60_000,
  maxUsd: 1,
  maxBarrenRounds: Number.POSITIVE_INFINITY,
  maxUnproductiveRounds: Number.POSITIVE_INFINITY,
};

/**
 * Build mode.
 *
 * 20 rounds is roughly "plan, then write eight files, then fix what the preview
 * reported". $2 is a default rather than a judgement — it is editable, and the
 * point is that there IS one, because the failure this guards against is a
 * charge the user did not expect rather than a specific amount.
 */
export const BUILD_LIMITS: BuildLimits = {
  maxRounds: 20,
  maxContinuations: 6,
  outputCeiling: 32_768,
  maxMs: 15 * 60_000,
  maxUsd: 2,
  // Three rather than two, and against a counter that no longer treats research
  // as failure. Two barren rounds now means two rounds that genuinely produced
  // nothing — errors, empty searches, or calls already made this turn.
  maxBarrenRounds: 3,
  maxUnproductiveRounds: 6,
};

/** Window `BUILD_LIMITS` was chosen against. Scaling is relative to it. */
const BASELINE_WINDOW = 128_000;

/** Never fewer rounds than today, and never so many that only money can stop it. */
export const MAX_BUILD_ROUNDS = 40;

/**
 * Tool rounds for a build, given the model's window.
 *
 * Twenty was chosen when the context window was what a long build ran out of
 * first. It is not, any more: with the transcript trimmer no longer discarding
 * by age, a million-token model can carry far more rounds of tool traffic than
 * twenty — so on that model the round counter, not the window and not the
 * budget, becomes the thing that ends a build the user asked for.
 *
 * Scaled by the square root rather than linearly, and capped. Rounds cost money
 * whatever the window is, and `maxUsd` is still the ceiling that matters: this
 * only stops the counter being the *first* thing to fire on a model that has
 * room to keep going.
 */
export function roundsFor(contextWindow?: number | null, base = BUILD_LIMITS.maxRounds): number {
  if (!contextWindow || contextWindow <= 0) return base;
  const scaled = Math.round(base * Math.sqrt(contextWindow / BASELINE_WINDOW));
  return Math.min(MAX_BUILD_ROUNDS, Math.max(base, scaled));
}

/**
 * Ceiling on a turn's wall clock, whatever the model.
 *
 * Past this the right answer is not "wait longer" but "this model is the wrong
 * tool for this task", and the user should be told so rather than left watching
 * a spinner.
 */
export const MAX_TURN_MS = 45 * 60_000;

/**
 * How much slower generation really is than the catalog claims.
 *
 * Measured on `nvidia/nemotron-3-ultra-550b-a55b`: 16,384 output tokens in 496 s
 * of streaming, so **33 tok/s** against the catalog's advertised 70. The catalog
 * figures are vendor-shaped best cases; a budget derived from them without a
 * margin is a budget that stops a turn which was about to succeed.
 */
export const GENERATION_SLOWDOWN = 2;

/**
 * Wall clock for a turn, given how fast the model actually produces tokens.
 *
 * `maxMs` exists to stop a turn running forever. It was a constant, and the
 * constant was chosen against models that answer in seconds — so on a slow one
 * it stopped meaning "forever" and started meaning "at all". Measured end to
 * end: **one** round on Nemotron 3 Ultra took 554 s (57 s to first byte, then
 * 16,384 tokens) — longer than `CHAT_LIMITS.maxMs` in its entirety, and 62% of
 * the build turn's whole allowance for a single round of forty.
 *
 * The floor is what a turn has to be able to do to be worth starting at all:
 * finish one full-length answer and the continuations that answer is allowed.
 * A page that stops mid-`<svg>` because the clock ran out has cost the user the
 * whole turn and produced nothing they can use.
 *
 * Floored at the existing value, so no model gets less time than it has today,
 * and capped by {@link MAX_TURN_MS}. Money and rounds are unchanged and remain
 * the limits that actually bind: this only stops the clock being the first thing
 * to fire on a model that was working.
 */
export function maxMsFor(
  model: { throughputTps?: number; latencyMs?: number } | null | undefined,
  limits: BuildLimits,
): number {
  const tps = model?.throughputTps;
  if (!tps || tps <= 0) return limits.maxMs;
  const answerMs =
    (model?.latencyMs ?? 0) + (limits.outputCeiling / tps) * 1000 * GENERATION_SLOWDOWN;
  const need = answerMs * (1 + limits.maxContinuations);
  return Math.min(MAX_TURN_MS, Math.max(limits.maxMs, Math.round(need)));
}

export function limitsFor(buildMode: boolean, overrides: Partial<BuildLimits> = {}): BuildLimits {
  return { ...(buildMode ? BUILD_LIMITS : CHAT_LIMITS), ...overrides };
}

/**
 * One attempt at repairing a broken artifact.
 *
 * A separate budget from the turn that produced the artifact, rather than a
 * continuation of it. Sharing one would let a 20-round build spend the whole
 * allowance and leave nothing to fix the broken page it just produced — which
 * inverts the priority, since a build that ends in a page that does not run has
 * spent its money for nothing.
 *
 * Small on purpose in every dimension except output. Two rounds is "call
 * `artifact` with an update, then answer". `maxUsd` is half an ordinary chat
 * turn because the user did not ask for this one. But `outputCeiling` matches
 * build mode: the fix may require re-emitting a whole file, and truncating it
 * would replace one broken artifact with another.
 */
export const REPAIR_LIMITS: BuildLimits = {
  maxRounds: 2,
  maxContinuations: 3,
  outputCeiling: 32_768,
  maxMs: 3 * 60_000,
  maxUsd: 0.5,
  maxBarrenRounds: 1,
  maxUnproductiveRounds: 2,
};

export type StopReason = "rounds" | "time" | "cost" | "no-progress" | "stalled" | "looping" | null;

/** A stop, in both the machine-readable and the human-readable form. */
export interface BudgetStop {
  reason: NonNullable<StopReason>;
  message: string;
}

export class BuildBudget {
  readonly limits: BuildLimits;
  private rounds = 0;
  private usd = 0;
  private barren = 0;
  private unproductive = 0;
  private readonly signatures: string[] = [];
  private looping = false;
  private readonly startedAt: number;
  private readonly now: () => number;

  constructor(limits: BuildLimits, now: () => number = Date.now) {
    this.limits = limits;
    this.now = now;
    this.startedAt = now();
  }

  get elapsedMs(): number {
    return this.now() - this.startedAt;
  }

  get spentUsd(): number {
    return this.usd;
  }

  get roundsUsed(): number {
    return this.rounds;
  }

  get barrenRounds(): number {
    return this.barren;
  }

  get unproductiveRounds(): number {
    return this.unproductive;
  }

  /** Money already committed. Charged from real usage, not estimated up front. */
  chargeUsd(amount: number): void {
    if (amount > 0) this.usd += amount;
  }

  /**
   * Record a completed round.
   *
   * Two counters, because "stuck" and "not finishing" are different failures and
   * conflating them is what broke the original guard. `informative` — a search
   * that returned results, a file read, a connector call — resets the barren
   * streak but not the unproductive one: the model is getting somewhere, just
   * not writing yet. Only `productive` resets both.
   */
  completeRound(progress: RoundProgress): void {
    this.rounds++;
    this.barren = progress === "barren" ? this.barren + 1 : 0;
    this.unproductive = progress === "productive" ? 0 : this.unproductive + 1;
  }

  /**
   * Record the calls a round made, so repetition can be detected.
   *
   * Separate from `completeRound` because a loop is a property of the whole turn
   * rather than of one round: a model alternating between two calls it has
   * already made never produces a consecutive repeat, and would slip past any
   * per-round counter.
   */
  noteCalls(signatures: string[]): void {
    for (const sig of signatures) {
      this.signatures.push(sig);
      if (isLooping(this.signatures)) this.looping = true;
    }
  }

  /** Why the run should stop, or null to continue. Checked before each round. */
  stopReason(): StopReason {
    if (this.rounds >= this.limits.maxRounds) return "rounds";
    if (this.elapsedMs >= this.limits.maxMs) return "time";
    if (this.usd >= this.limits.maxUsd) return "cost";
    // Ordered by how specific the advice can be. "You repeated the same call
    // three times" tells the user more than "nothing happened", so it wins.
    if (this.looping) return "looping";
    if (this.barren >= this.limits.maxBarrenRounds) return "no-progress";
    if (this.unproductive >= this.limits.maxUnproductiveRounds) return "stalled";
    return null;
  }

  get exhausted(): boolean {
    return this.stopReason() !== null;
  }

  /**
   * The stop, in both forms.
   *
   * The reason travels with the message so the UI can offer the right control:
   * a round cap is a Continue button, a cost ceiling is a settings link, and a
   * loop is neither — it needs a different instruction from the user.
   */
  stop(): BudgetStop | null {
    const reason = this.stopReason();
    if (!reason) return null;
    return { reason, message: this.describeStop(reason) };
  }

  /** The stop, in words fit to show the user. */
  describeStop(reason: StopReason = this.stopReason()): string {
    switch (reason) {
      case "rounds":
        return `Stopped after ${this.limits.maxRounds} tool rounds. The workspace and plan are saved — continue to pick up where it left off.`;
      case "time":
        return `Stopped at the ${Math.round(this.limits.maxMs / 60_000)}-minute limit. The workspace and plan are saved.`;
      case "cost":
        return `Stopped at the $${this.limits.maxUsd.toFixed(2)} budget for this turn. Raise it in settings, or continue to spend another turn's worth.`;
      case "looping":
        return "Stopped: the same tool call was repeated three times without a new result. Try naming the next step directly.";
      case "no-progress":
        return `Stopped after ${this.limits.maxBarrenRounds} rounds that produced nothing — every call errored, came back empty, or repeated an earlier one. The plan and workspace are saved.`;
      case "stalled":
        return `Stopped after ${this.limits.maxUnproductiveRounds} rounds of reading with no file written. The plan and workspace are saved; try asking for one specific file.`;
      default:
        return "";
    }
  }
}
