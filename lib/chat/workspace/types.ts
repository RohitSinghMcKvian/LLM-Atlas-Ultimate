/**
 * The Workspace: persistent build memory for one conversation.
 *
 * Atlas could already write an artifact, remember facts about the user, and
 * stream a long answer. What it could not do was *carry a build*. Ask for a
 * landing page and it arrives; ask for the fourth screen of an app two hours
 * later and the model no longer knows what the first three looked like, because
 * every durable thing in chat was scoped to a single artifact, a single message,
 * or a single React component.
 *
 * Three pieces close that, and they are deliberately small:
 *
 *  - **Files.** What has actually been built, addressable by path.
 *  - **A task ledger.** What the build is for and how far it has got.
 *  - **A goal.** One paragraph the model wrote when the work started.
 *
 * All three are re-projected into the system prompt every turn at bounded cost
 * (see `context.ts`), so they survive the three things that used to end a long
 * build: the provider's output limit, the tool-round cap, and compaction. The
 * conversation can lose every message and the build still knows what it is.
 *
 * Scoped per conversation rather than per project because a build *is* the
 * conversation — two different asks in one project should not share a file tree.
 */

export const WORKSPACE_ROOT = "/workspace";

/**
 * Ceilings, and why they are not memory's.
 *
 * A memory note is a paragraph; a landing page is 900 lines, which is already
 * past memory's 64 KB per-file cap. But the interesting limit is
 * `MAX_TOTAL_BYTES`: browsers grant an origin a shared quota and start evicting
 * when it runs low, so the product `MAX_FILE_BYTES * MAX_FILES` (16 MB per
 * conversation) is far more than can safely be spent. The total is the real
 * budget; the other two only stop a single runaway write.
 */
export const WS_MAX_FILE_BYTES = 256 * 1024;
export const WS_MAX_FILES = 64;
export const WS_MAX_TOTAL_BYTES = 4 * 1024 * 1024;

export interface WorkspaceFile {
  conversationId: string;
  /** Absolute, always under WORKSPACE_ROOT. */
  path: string;
  content: string;
  updatedAt: number;
}

/**
 * `blocked` is not a failure state — it means the step cannot proceed until
 * something else does, and the note says what. Kept distinct from a plain
 * failure so the ledger can show a build that is waiting rather than broken.
 */
export type TaskStatus = "pending" | "active" | "done" | "blocked";

export interface WorkspaceTask {
  id: string;
  conversationId: string;
  title: string;
  status: TaskStatus;
  /** One line on what happened. Shown to the model, so it stays short. */
  note?: string;
  order: number;
}

export interface WorkspaceMeta {
  conversationId: string;
  /** The build's north star, in the model's own words. */
  goal: string;
  updatedAt: number;
}

/** Everything the prompt builder and the UI need, in one read. */
export interface WorkspaceSnapshot {
  goal: string;
  files: WorkspaceFile[];
  tasks: WorkspaceTask[];
}

export const EMPTY_SNAPSHOT: WorkspaceSnapshot = { goal: "", files: [], tasks: [] };

/**
 * Ceiling on ledger size.
 *
 * `lib/agent/plan.ts` caps a chat plan at 8, and that is right for a plan the
 * user approves in one glance. A build ledger is a different object: it is the
 * durable record, it is read by the model rather than approved by the user, and
 * a real page has more than eight steps in it. 24 is enough for a multi-screen
 * app and still small enough to print in full on every turn.
 */
export const MAX_TASKS = 24;
