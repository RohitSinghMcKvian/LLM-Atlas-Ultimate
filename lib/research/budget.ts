/**
 * Budgets for a research run (spec §4.6, and §1.7's free-tier constraint).
 *
 * Multi-step research is the one feature here that can spend without bound: each
 * sub-question is a search, each round can propose more sub-questions, and a
 * model that keeps finding gaps will keep asking. Left alone that is an unbounded
 * number of outbound requests and an unbounded number of tokens, on hosting that
 * has neither to spare.
 *
 * So the budget is a first-class object rather than a few constants checked at
 * call sites: every spend goes through `charge()`, which is the only place the
 * counters move. That makes "did it stay inside the caps" a property of one
 * module instead of a claim about several.
 *
 * The wall-clock cap exists separately from the query cap because they fail
 * differently: a slow provider exhausts time without exhausting queries, and a
 * fast one does the reverse. Both are real limits.
 */

export interface BudgetLimits {
  /** Total searches across every round. */
  maxQueries: number;
  /** Distinct sources kept. Bounds the context the answer is built from. */
  maxSources: number;
  /** Rounds of "search, read, decide what is still missing". */
  maxRounds: number;
  /** Wall-clock ceiling for the whole run. */
  maxMs: number;
}

/**
 * Defaults sized for the free tier: enough breadth to beat a single search,
 * small enough that one run cannot become the reason the instance falls over.
 *
 * **Inference label:** Claude's research mode does far more than this. These
 * numbers are Atlas's own trade-off under §1.7, not a match for a documented
 * behaviour.
 */
export const DEFAULT_LIMITS: BudgetLimits = {
  maxQueries: 8,
  maxSources: 20,
  maxRounds: 3,
  maxMs: 60_000,
};

export type BudgetKind = "queries" | "sources" | "rounds";

export interface BudgetState {
  queries: number;
  sources: number;
  rounds: number;
  startedAt: number;
}

export class Budget {
  readonly limits: BudgetLimits;
  private state: BudgetState;
  private readonly now: () => number;

  constructor(limits: Partial<BudgetLimits> = {}, now: () => number = Date.now) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.now = now;
    this.state = { queries: 0, sources: 0, rounds: 0, startedAt: now() };
  }

  get spent(): Readonly<BudgetState> {
    return { ...this.state };
  }

  get elapsedMs(): number {
    return this.now() - this.state.startedAt;
  }

  /** How many of `kind` remain. Never negative. */
  remaining(kind: BudgetKind): number {
    const cap =
      kind === "queries"
        ? this.limits.maxQueries
        : kind === "sources"
          ? this.limits.maxSources
          : this.limits.maxRounds;
    return Math.max(0, cap - this.state[kind]);
  }

  get outOfTime(): boolean {
    return this.elapsedMs >= this.limits.maxMs;
  }

  /** True when nothing further should start. */
  get exhausted(): boolean {
    return (
      this.outOfTime ||
      this.remaining("queries") === 0 ||
      this.remaining("rounds") === 0 ||
      this.remaining("sources") === 0
    );
  }

  /**
   * Spend against a limit, returning how much was actually granted.
   *
   * Grants a partial amount rather than refusing outright: asking for four
   * searches with two left should run two, not zero. A caller that needs
   * all-or-nothing can compare the return value with what it asked for.
   */
  charge(kind: BudgetKind, amount = 1): number {
    if (amount <= 0) return 0;
    if (this.outOfTime) return 0;
    const granted = Math.min(amount, this.remaining(kind));
    this.state[kind] += granted;
    return granted;
  }

  /** Why the run stopped, in words fit to show the user. */
  stopReason(): string | null {
    if (this.outOfTime) return `Stopped at the ${Math.round(this.limits.maxMs / 1000)}s time limit.`;
    if (this.remaining("queries") === 0) return `Stopped at the ${this.limits.maxQueries}-search limit.`;
    if (this.remaining("sources") === 0) return `Stopped at the ${this.limits.maxSources}-source limit.`;
    if (this.remaining("rounds") === 0) return `Stopped after ${this.limits.maxRounds} rounds.`;
    return null;
  }
}
