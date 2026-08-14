import {
  canRepair,
  initialRepairState,
  planRepair,
  repairReducer,
  type GiveUpReason,
  type RepairLimits,
  type RepairState,
  type RepairStrategy,
} from "./artifact-repair";
import type { VerifyResult } from "./artifact-verify";

/**
 * Driving verify → repair → verify to a conclusion.
 *
 * Shaped like lib/agent/run.ts: the decisions live in a pure reducer, and every
 * effect — running a frame, spending a model turn, asking whether to stop — is an
 * injected port. That is what makes "does this ever spend money it should not"
 * answerable by a unit test rather than by reading the component.
 *
 * The guard is polled at every boundary rather than once at the start. A repair
 * phase outlives the turn that started it, so the user can send a new message,
 * regenerate, switch branch or switch conversation while it is running, and each
 * of those must abandon it without writing anything.
 */

export interface RepairTurnOutcome {
  /** Whether the model actually changed the artifact. A reply with no fence and
   *  no tool call is the common barren case: an apology. */
  artifactChanged: boolean;
  spentUsd: number;
  /** The turn itself failed — a network error, an aborted stream. */
  errored?: boolean;
}

export interface RepairPorts {
  /** Build, run and triage. `null` when there is nothing executable to check. */
  verify: () => Promise<VerifyResult | null>;
  repairTurn: (instruction: string, strategy: RepairStrategy) => Promise<RepairTurnOutcome>;
  /** Polled at every boundary. True abandons the run where it stands. */
  shouldStop?: () => boolean;
  onState?: (state: RepairState) => void;
  now?: () => number;
}

export interface RepairRunResult {
  state: RepairState;
  /** The final verification, or null if none completed. */
  verified: VerifyResult | null;
}

export async function runArtifactRepair(
  path: string,
  limits: RepairLimits,
  ports: RepairPorts,
): Promise<RepairRunResult> {
  const now = ports.now ?? (() => Date.now());
  let state = initialRepairState(path, now());
  let latest: VerifyResult | null = null;

  const emit = (next: RepairState) => {
    state = next;
    ports.onState?.(state);
    return state;
  };
  const settle = (status: "clean" | "gave_up", reason?: GiveUpReason) =>
    emit(
      repairReducer(state, {
        type: "settle",
        status,
        reason,
        // Only fatal errors are worth showing as "could not fix": a host fault
        // is reported separately and a warning was never going to be repaired.
        surviving: latest
          ? (reason === "unfixable" ? latest.host : latest.fatal).map((e) =>
              e.line ? `${e.message} (line ${e.line})` : e.message,
            )
          : [],
      }),
    );

  const stopped = () => ports.shouldStop?.() === true;

  if (stopped()) return { state: settle("gave_up", "aborted"), verified: null };

  ports.onState?.(state);

  for (;;) {
    latest = await ports.verify();
    // Nothing executable, or the run was skipped or abandoned. Not a pass, and
    // not a failure either — there is simply no verdict.
    if (!latest) {
      return { state: settle(state.attempts.length ? "gave_up" : "clean", state.attempts.length ? "aborted" : undefined), verified: null };
    }
    if (stopped()) return { state: settle("gave_up", "aborted"), verified: latest };

    // Record what the attempt that just finished achieved, measured against a
    // fresh run rather than against the errors that prompted it. `planRepair`
    // needs this to tell a failure that moved from one that did not.
    if (state.attempts.length) {
      emit(repairReducer(state, { type: "measured", fatalAfter: latest.fatal.length }));
    }

    const decision = planRepair(state, latest, limits, now());

    if (decision.kind === "done") return { state: settle("clean"), verified: latest };
    if (decision.kind === "stop") return { state: settle("gave_up", decision.reason), verified: latest };

    if (!canRepair(state, latest.signature, decision.strategy, limits, now())) {
      return { state: settle("gave_up", "attempts"), verified: latest };
    }

    emit(
      repairReducer(state, {
        type: "attempt",
        signature: latest.signature,
        strategy: decision.strategy,
        fatalBefore: latest.fatal.length,
        at: now(),
      }),
    );

    let outcome: RepairTurnOutcome;
    try {
      outcome = await ports.repairTurn(decision.instruction, decision.strategy);
    } catch {
      // A thrown repair turn is a failed attempt, not a crashed run — the same
      // contract runPlanSteps uses. The artifact is left exactly as it was.
      emit(repairReducer(state, { type: "result", spentUsd: 0 }));
      return { state: settle("gave_up", "errored"), verified: latest };
    }

    emit(repairReducer(state, { type: "result", spentUsd: outcome.spentUsd }));

    if (outcome.errored) return { state: settle("gave_up", "errored"), verified: latest };
    // Nothing changed, so re-verifying would render the identical document and
    // return the identical errors. Stop instead of paying for that round trip.
    if (!outcome.artifactChanged) return { state: settle("gave_up", "no-progress"), verified: latest };
    if (stopped()) return { state: settle("gave_up", "aborted"), verified: latest };
  }
}
