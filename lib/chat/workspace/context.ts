import { formatLedger, ledgerProgress } from "./tasks";
import { WORKSPACE_ROOT, type WorkspaceSnapshot } from "./types";

/**
 * The workspace, as the model sees it on every single turn.
 *
 * This block is the whole point of the workspace. An artifact records what was
 * built; this records what the build *is* — the goal, the plan, and the file
 * inventory — and it is re-sent every request. That is what lets a model pick up
 * a build after compaction has folded away every message that described it.
 *
 * Two rules govern the shape:
 *
 *  1. **Paths and sizes, never contents.** Same progressive disclosure as
 *     `memoryDirectoryBlock` and the skills index: the model learns that
 *     `/workspace/styles.css` exists and reads it with the `workspace` tool if
 *     the turn calls for it. Inlining the files would put the entire build in
 *     every request, which is the cost this module exists to avoid.
 *  2. **Hard-bounded.** A block that grows with the build would quietly eat the
 *     context window it is meant to protect — a 200-file build would spend more
 *     on its own inventory than on the conversation. Everything below is capped,
 *     and the whole block is truncated as a backstop.
 */

/** Ceiling on the whole block. ~600 tokens, spent once per request. */
export const WORKSPACE_CONTEXT_MAX_CHARS = 2400;

const MAX_GOAL_CHARS = 400;
const MAX_FILES_LISTED = 40;
const MAX_TASKS_LISTED = 24;

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Compose the block, or "" when there is no build yet.
 *
 * Returning "" rather than a "workspace is empty" line is deliberate: an empty
 * workspace is the normal state of an ordinary conversation, and telling the
 * model about a filesystem it has no reason to use invites it to invent one.
 */
export function buildWorkspaceContext(snap: WorkspaceSnapshot): string {
  const hasAnything = snap.goal.trim() || snap.files.length > 0 || snap.tasks.length > 0;
  if (!hasAnything) return "";

  const parts: string[] = ["## Build workspace (persists across this whole conversation)"];

  if (snap.goal.trim()) {
    parts.push(`Goal: ${clip(snap.goal.trim().replace(/\s+/g, " "), MAX_GOAL_CHARS)}`);
  }

  if (snap.tasks.length > 0) {
    const { done, total } = ledgerProgress(snap.tasks);
    const sorted = snap.tasks.slice().sort((a, b) => a.order - b.order);
    const shown = sorted.slice(0, MAX_TASKS_LISTED);
    const lines = formatLedger(shown);
    const more = sorted.length - shown.length;
    parts.push(
      `Plan (${done}/${total} done). Update it with the \`tasks\` tool as you go:\n${lines}` +
        (more > 0 ? `\n… and ${more} more` : ""),
    );
  }

  if (snap.files.length > 0) {
    const sorted = snap.files.slice().sort((a, b) => a.path.localeCompare(b.path));
    const shown = sorted.slice(0, MAX_FILES_LISTED);
    const lines = shown.map((f) => {
      const count = f.content === "" ? 0 : f.content.split("\n").length;
      return `- ${f.path} (${count} line${count === 1 ? "" : "s"})`;
    });
    const more = sorted.length - shown.length;
    if (more > 0) lines.push(`- … and ${more} more`);
    parts.push(
      `Files already written (contents not shown — read one with the \`workspace\` tool ` +
        `before editing it):\n${lines.join("\n")}`,
    );
  } else {
    parts.push(
      `${WORKSPACE_ROOT} is empty. Write deliverables there with the \`workspace\` tool ` +
        `so they survive this conversation being compacted.`,
    );
  }

  // Backstop. Every section above is individually capped, so reaching this means
  // a single goal or title was pathological rather than the build being large.
  return clip(parts.join("\n\n"), WORKSPACE_CONTEXT_MAX_CHARS);
}
