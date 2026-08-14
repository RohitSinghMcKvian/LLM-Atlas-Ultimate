import {
  fsCommandSchema,
  type FsLimits,
  type FsStore,
} from "../fs-commands";
import { workspaceRepo, type WorkspaceRepo } from "./repo";
import {
  WORKSPACE_ROOT,
  WS_MAX_FILES,
  WS_MAX_FILE_BYTES,
  WS_MAX_TOTAL_BYTES,
  type WorkspaceTask,
} from "./types";

/**
 * Binding the shared filesystem commands to one conversation's workspace.
 *
 * `FsStore` is deliberately flat — `{ path, text }` — while a workspace row
 * carries the conversation it belongs to. Adapting here rather than widening
 * `FsStore` keeps the command layer unaware that more than one workspace exists,
 * which is what lets the same tested traversal check serve both roots.
 */
export function workspaceFsStore(conversationId: string, repo: WorkspaceRepo): FsStore {
  return {
    async list() {
      const rows = await repo.listFiles(conversationId);
      return rows.map((r) => ({ path: r.path, text: r.content, updatedAt: r.updatedAt }));
    },
    async read(path) {
      const row = await repo.readFile(conversationId, path);
      return row ? { path: row.path, text: row.content, updatedAt: row.updatedAt } : undefined;
    },
    async write(path, text) {
      await repo.writeFile(conversationId, path, text);
    },
    async remove(path) {
      await repo.removeFile(conversationId, path);
    },
  };
}

/**
 * Workspace limits, and the one capability memory does not get.
 *
 * `allowAppend` is what makes a file longer than a single response possible: the
 * provider stops at its output limit somewhere in the middle of a 900-line page,
 * and appending in chunks is the only way past that which does not depend on the
 * resume loop guessing where the seam was.
 */
export const WORKSPACE_LIMITS: FsLimits = {
  root: WORKSPACE_ROOT,
  maxFileBytes: WS_MAX_FILE_BYTES,
  maxFiles: WS_MAX_FILES,
  maxTotalBytes: WS_MAX_TOTAL_BYTES,
  allowAppend: true,
};

export const workspaceCommandSchema = fsCommandSchema({
  root: WORKSPACE_ROOT,
  maxFileBytes: WS_MAX_FILE_BYTES,
  append: true,
});

export type WorkspaceCommand = ReturnType<typeof workspaceCommandSchema.parse>;

/**
 * Normalise a model-supplied or fence-supplied path into an absolute workspace
 * path.
 *
 * The model writes ` ```html path="index.html" ` — relative, because that is
 * what a file name looks like in a project — while the filesystem is addressed
 * absolutely. Rejecting the relative form would mean teaching the model a second
 * convention for the same file; accepting it here costs one function.
 *
 * Returns null for anything that is not a plausible relative path, so a stray
 * info-string token cannot become a file. The traversal check still runs
 * afterwards in `resolveConfinedPath` — this is a normaliser, not the boundary.
 */
export function toWorkspacePath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 200) return null;
  if (trimmed.startsWith(`${WORKSPACE_ROOT}/`)) return trimmed;
  if (trimmed.startsWith("/")) return null;
  // Conservative allowlist: letters, digits, dot, dash, underscore, slash. No
  // spaces, no `..`, no scheme-like colons.
  if (!/^[A-Za-z0-9._\-/]+$/.test(trimmed)) return null;
  if (trimmed.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return null;
  return `${WORKSPACE_ROOT}/${trimmed}`;
}

/**
 * Everything the tool layer needs for one conversation, resolved once.
 *
 * Bound here rather than passed as a conversation id the tools look up
 * themselves: a tool that takes an id is a tool that can be given the wrong one,
 * and "which build am I editing" is not a decision a model should be making.
 */
export interface BuildStores {
  files: FsStore;
  ledger: {
    conversationId: string;
    list: () => Promise<WorkspaceTask[]>;
    replace: (tasks: WorkspaceTask[]) => Promise<void>;
    setGoal: (goal: string) => Promise<void>;
  };
}

export async function bindWorkspace(conversationId: string): Promise<BuildStores> {
  const repo = await workspaceRepo();
  return {
    files: workspaceFsStore(conversationId, repo),
    ledger: {
      conversationId,
      list: () => repo.listTasks(conversationId),
      replace: (tasks) => repo.replaceTasks(conversationId, tasks),
      setGoal: (goal) => repo.setGoal(conversationId, goal),
    },
  };
}

/** The inverse, for display: `/workspace/src/App.jsx` → `src/App.jsx`. */
export function toRelativePath(absolute: string): string {
  return absolute.startsWith(`${WORKSPACE_ROOT}/`)
    ? absolute.slice(WORKSPACE_ROOT.length + 1)
    : absolute;
}
