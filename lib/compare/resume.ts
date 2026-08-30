// What is left to do, given a checkpoint.
//
// This is the whole of "resume". Because every stage is its own bounded request
// and lane ids are stable within a run, picking a run back up after a reload,
// a discarded tab, or a driver handing over to another tab is just: read the
// last checkpoint, work out what never reached a terminal state, and re-issue
// exactly that.
//
// Pure, and the reason it is pure: the rules about what may be re-run are the
// part that can quietly cost someone money twice.

import {
  STAGES,
  laneSettled,
  stageSettled,
  type CompareRun,
  type LaneState,
  type Stage,
} from "./types";

export interface ResumePlan {
  /** Stages still to run, in order. Empty when the run is finished. */
  stages: Stage[];
  /**
   * Lane ids the lanes stage should be re-issued with.
   *
   * Only lanes that never reached a terminal state. A lane the user stopped
   * stays stopped, and a lane that failed stays failed — re-running a
   * `key_required` lane on every reload would fail again, forever, and a lane
   * that failed halfway through a paid answer would be billed twice.
   */
  laneIds: string[];
  complete: boolean;
  /** Lanes the user can retry by hand, which is a different question. */
  retryable: string[];
}

/**
 * A stage left `running` with nobody driving it is unfinished, not in progress.
 *
 * There is no way to tell those apart from the record alone — the tab that was
 * driving may have been discarded mid-stream — so the rule is simply that only
 * `done` and `skipped` count as settled. Re-issuing a stage that was genuinely
 * still running is safe: the lanes stage is idempotent per lane id, and the
 * others overwrite their own output.
 */
export function unfinishedStages(run: Pick<CompareRun, "stages">): Stage[] {
  const out: Stage[] = [];
  for (const stage of STAGES) {
    const state = run.stages[stage];
    if (!state || !stageSettled(state.status)) out.push(stage);
  }
  return out;
}

/** Lanes that never reached a terminal state, so re-issuing them cannot double-bill. */
export function unfinishedLanes(lanes: LaneState[]): string[] {
  return lanes.filter((l) => !l.blocked && !laneSettled(l.status) && l.status !== "error").map((l) => l.id);
}

/**
 * Lanes a person may retry by hand.
 *
 * Errors are excluded from automatic resume and included here: a failure the
 * user can see and act on (connect a key, swap the model) is worth offering,
 * and doing it silently on every reload is not.
 */
export function retryableLanes(lanes: LaneState[]): string[] {
  return lanes.filter((l) => l.status === "error" && !l.blocked).map((l) => l.id);
}

export function planResume(run: CompareRun): ResumePlan {
  const stages = unfinishedStages(run);
  const laneIds = unfinishedLanes(run.lanes);
  const retryable = retryableLanes(run.lanes);

  // The lanes stage is settled only when nothing is still in flight. A record
  // that says `done` while a lane sits at `streaming` is a checkpoint written
  // as the tab went away, not a finished stage.
  const lanesStillOpen = laneIds.length > 0;
  const ordered = lanesStillOpen && !stages.includes("lanes") ? insertLanes(stages) : stages;

  return {
    stages: ordered,
    laneIds,
    complete: ordered.length === 0,
    retryable,
  };
}

/** Put `lanes` back in its canonical position rather than on the end. */
function insertLanes(stages: Stage[]): Stage[] {
  const wanted = new Set<Stage>([...stages, "lanes"]);
  return STAGES.filter((s) => wanted.has(s));
}

/**
 * Whether a run is worth offering to resume at all.
 *
 * A run abandoned days ago is history, not work in progress, and offering to
 * continue it would spend money on a question the user has forgotten asking.
 */
export const RESUME_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function resumable(run: CompareRun, now: number = Date.now()): boolean {
  if (run.error) return false;
  if (now - run.updatedAt > RESUME_MAX_AGE_MS) return false;
  return !planResume(run).complete;
}

/**
 * One line for the resume prompt.
 *
 * Says what will actually be re-run, because "continue?" without a subject is
 * a question nobody can answer.
 */
export function describeResume(plan: ResumePlan): string {
  if (plan.complete) return "This run finished.";
  const parts: string[] = [];
  if (plan.laneIds.length) {
    parts.push(`${plan.laneIds.length} lane${plan.laneIds.length === 1 ? "" : "s"}`);
  }
  const others = plan.stages.filter((s) => s !== "lanes");
  if (others.length) parts.push(others.join(", "));
  return parts.length ? `Continue: ${parts.join(" and ")}.` : "Continue this run.";
}
