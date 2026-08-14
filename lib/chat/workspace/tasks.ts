import { uuid } from "../types";
import { MAX_TASKS, type TaskStatus, type WorkspaceTask } from "./types";

/**
 * The task ledger's rules, as pure functions.
 *
 * Kept apart from storage so the interesting part — what happens when the model
 * completes a step that does not exist, or starts a second step while one is
 * already active — is testable without IndexedDB.
 *
 * The ledger is the piece that makes a long build resumable. An artifact tells
 * you *what* exists; the ledger tells you what it was for and what is left,
 * which is exactly what a model rejoining a folded conversation has no other way
 * to learn.
 */

export interface LedgerResult {
  tasks: WorkspaceTask[];
  /** Prose for the model. Names what changed, or why nothing did. */
  message: string;
  isError?: boolean;
}

/** Replace the whole ledger. Used when a build is planned or re-planned. */
export function planTasks(
  conversationId: string,
  titles: string[],
  existing: WorkspaceTask[] = [],
): LedgerResult {
  const cleaned = titles
    .map((t) => t.trim().replace(/\s+/g, " "))
    .filter((t) => t.length > 0 && t.length <= 300);

  if (cleaned.length === 0) {
    return { tasks: existing, message: "A plan needs at least one step.", isError: true };
  }

  const kept = cleaned.slice(0, MAX_TASKS);

  // Re-planning preserves what is already done. A model that adds a step
  // mid-build should not silently reset the four steps it finished, and
  // matching on the title is the only identity a re-plan gives us.
  const doneByTitle = new Map<string, WorkspaceTask>();
  for (const t of existing) {
    if (t.status === "done") doneByTitle.set(t.title, t);
  }

  const tasks = kept.map((title, i) => {
    const carried = doneByTitle.get(title);
    return carried
      ? { ...carried, order: i }
      : {
          id: uuid(),
          conversationId,
          title,
          status: "pending" as TaskStatus,
          order: i,
        };
  });

  const dropped = cleaned.length - kept.length;
  const carried = tasks.filter((t) => t.status === "done").length;
  return {
    tasks,
    message:
      `Plan recorded: ${tasks.length} step${tasks.length === 1 ? "" : "s"}.` +
      (carried ? ` ${carried} already complete, carried over.` : "") +
      (dropped ? ` ${dropped} step(s) past the ${MAX_TASKS}-step limit were dropped.` : ""),
  };
}

/**
 * Find the step a command refers to.
 *
 * Accepts a 1-based number or a substring of the title, because a model that
 * has the ledger in its prompt will use whichever is shorter, and refusing one
 * of them costs a round trip to learn nothing.
 */
function locate(tasks: WorkspaceTask[], ref: string): WorkspaceTask | undefined {
  const n = Number(ref);
  if (Number.isInteger(n) && n >= 1 && n <= tasks.length) return tasks[n - 1];
  const needle = ref.trim().toLowerCase();
  if (!needle) return undefined;
  const exact = tasks.find((t) => t.title.toLowerCase() === needle);
  if (exact) return exact;
  const hits = tasks.filter((t) => t.title.toLowerCase().includes(needle));
  return hits.length === 1 ? hits[0] : undefined;
}

/** Move one step to a new status. */
export function setTaskStatus(
  tasks: WorkspaceTask[],
  ref: string,
  status: TaskStatus,
  note?: string,
): LedgerResult {
  if (tasks.length === 0) {
    return { tasks, message: "There is no plan yet. Call `tasks` with `plan` first.", isError: true };
  }
  const target = locate(tasks, ref);
  if (!target) {
    return {
      tasks,
      message: `No step matches "${ref}". Use its number, or enough of its title to be unambiguous.`,
      isError: true,
    };
  }

  const next = tasks.map((t) => {
    if (t.id === target.id) return { ...t, status, note: note?.trim() || t.note };
    // Only one step is active at a time. A build that claims to be doing three
    // things at once is a build whose ledger has stopped describing reality.
    if (status === "active" && t.status === "active") return { ...t, status: "pending" as TaskStatus };
    return t;
  });

  const remaining = next.filter((t) => t.status !== "done").length;
  return {
    tasks: next,
    message:
      `Step ${target.order + 1} "${target.title}" → ${status}.` +
      (remaining === 0 ? " All steps complete." : ` ${remaining} remaining.`),
  };
}

/** The ledger as the model sees it. Compact: one line per step. */
export function formatLedger(tasks: WorkspaceTask[]): string {
  if (tasks.length === 0) return "";
  const mark: Record<TaskStatus, string> = {
    done: "x",
    active: ">",
    blocked: "!",
    pending: " ",
  };
  return tasks
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((t, i) => {
      const note = t.note ? ` — ${t.note}` : "";
      return `${i + 1}. [${mark[t.status]}] ${t.title}${note}`;
    })
    .join("\n");
}

/** Short progress line for the UI and for the no-progress budget guard. */
export function ledgerProgress(tasks: WorkspaceTask[]): { done: number; total: number } {
  return { done: tasks.filter((t) => t.status === "done").length, total: tasks.length };
}
