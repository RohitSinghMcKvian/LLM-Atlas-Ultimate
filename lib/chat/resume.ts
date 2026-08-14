/**
 * Picking a stopped build back up.
 *
 * A build that hits its round cap used to end with one line of italic prose
 * appended to the answer — "Ask again to continue" — and nothing else. That is a
 * dead end dressed as an instruction: the user has to work out what to type, and
 * whatever they type restates a goal the workspace already knows, so the model
 * frequently redoes finished work.
 *
 * Two things fix it. The stop becomes a control rather than a sentence, and the
 * resumed turn is told where it got to — from the ledger, which is the one piece
 * of state that survives compaction and therefore the only trustworthy answer to
 * "what was I doing".
 *
 * Pure. What may be resumed automatically is a policy question, and it belongs
 * somewhere it can be argued with rather than inside a component.
 */

import type { StopReason } from "./build-budget";
import type { WorkspaceSnapshot, WorkspaceTask } from "./workspace/types";

/**
 * May Atlas resume this stop without being asked?
 *
 * Only a round cap, and only up to the user's allowance. The distinction is
 * about *why* the run stopped, not how far it got:
 *
 *  - **rounds** — an arbitrary number Atlas chose was reached. Nothing is wrong;
 *    the work is mid-flight. This is the only honest candidate.
 *  - **cost** and **time** — the user's own ceiling. Resuming past a limit
 *    someone set is spending money they capped, which no setting should permit.
 *  - **looping** and **no-progress** — the model was not getting anywhere. Another
 *    round of the same thing is the definition of not helping.
 *  - **stalled** — six rounds of reading and no file. Same reasoning.
 *
 * `allowance` is `autoContinueRounds` from settings, and defaults to 0: an
 * automatic continuation spends money the user did not ask for a second time.
 */
export function shouldAutoResume(
  reason: StopReason,
  used: number,
  allowance: number,
): boolean {
  if (reason !== "rounds") return false;
  return used < allowance;
}

/** The first step the build has not finished, if the ledger names one. */
export function nextTask(tasks: WorkspaceTask[]): WorkspaceTask | undefined {
  const ordered = [...tasks].sort((a, b) => a.order - b.order);
  return ordered.find((t) => t.status === "active") ?? ordered.find((t) => t.status === "pending");
}

/**
 * What to tell the model when the turn resumes.
 *
 * Names the next step explicitly rather than saying "continue". A model handed
 * "continue" re-reads its own files to work out where it was, which costs the
 * first two rounds of the new budget doing what the ledger already recorded —
 * and sometimes rewrites a file it had already finished.
 *
 * Written as an instruction to the model, never shown to the user.
 */
export function resumeInstruction(snapshot: WorkspaceSnapshot): string {
  const step = nextTask(snapshot.tasks);
  const done = snapshot.tasks.filter((t) => t.status === "done").length;
  const lines: string[] = [
    "Continue the build from where it stopped. It ran out of tool rounds, not out of work.",
  ];

  if (snapshot.tasks.length) {
    lines.push(
      `${done} of ${snapshot.tasks.length} steps are already done — do not redo them.`,
    );
  }
  if (step) {
    lines.push(`The next step is: ${step.title}${step.note ? ` (${step.note})` : ""}`);
  } else if (snapshot.tasks.length) {
    // Every step is done or blocked. Saying so is more useful than inventing a
    // next step, and it lets the model close the build out or explain the block.
    lines.push(
      "No step remains pending. Finish anything unresolved, then say the build is complete.",
    );
  }
  if (snapshot.files.length) {
    lines.push(
      `${snapshot.files.length} file${snapshot.files.length === 1 ? "" : "s"} already exist in the workspace; read before rewriting.`,
    );
  }

  lines.push("Do not restate the plan. Carry on.");
  return lines.join(" ");
}
