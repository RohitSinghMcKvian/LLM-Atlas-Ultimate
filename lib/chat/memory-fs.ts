import {
  FS_COMMANDS,
  fsCommandSchema,
  fsDirectoryBlock,
  resolveConfinedPath,
  runFsCommand,
  type FsFile,
  type FsLimits,
  type FsResult,
  type FsStore,
} from "./fs-commands";

/**
 * The `/memories` filesystem tool (spec §4.7).
 *
 * A tiny, path-addressed document store the model edits with six commands —
 * `view`, `create`, `str_replace`, `insert`, `delete`, `rename`. Files, rather
 * than a flat list of facts, because a file gives the model somewhere to put
 * *structure*: a running list under `/memories/preferences.md` can be appended
 * to and reorganised, where the existing keyword-scored `MemoryItem[]` can only
 * grow. The two coexist: items are for short recalled facts, files are for
 * curated notes.
 *
 * The command layer itself now lives in `fs-commands.ts`, shared with the
 * `/workspace` filesystem. This module is what binds it to the memory root and
 * memory's limits. Path confinement is the security boundary of both tools, and
 * a second copy of it was the wrong way to get a second filesystem.
 *
 * Memory deliberately does NOT get `append`. Notes about a person should be
 * reviewed and rewritten, not grown without bound; unbounded appending is a
 * property the build workspace needs and this one does not.
 *
 * **Inference label:** Anthropic has published the memory tool's command names
 * and its `/memories` root, but not the exact wording of its responses, its size
 * limits, or its view formatting. Those are this implementation's own choices,
 * modelled on the text-editor tool's conventions. Not verified parity.
 */

export const MEMORY_ROOT = "/memories";

/** Hard ceilings. A runaway model must not be able to fill the user's disk. */
export const MAX_FILE_BYTES = 64 * 1024;
export const MAX_FILES = 128;

export const MEMORY_LIMITS: FsLimits = {
  root: MEMORY_ROOT,
  maxFileBytes: MAX_FILE_BYTES,
  maxFiles: MAX_FILES,
};

/** Re-exported under their historical names so existing callers are unchanged. */
export type MemoryFile = FsFile;
export type MemoryFsStore = FsStore;
export type MemoryFsResult = FsResult;

export const MEMORY_COMMANDS = FS_COMMANDS;

export function resolveMemoryPath(raw: string): { path: string } | { error: string } {
  return resolveConfinedPath(raw, MEMORY_ROOT);
}

export const memoryCommandSchema = fsCommandSchema({
  root: MEMORY_ROOT,
  maxFileBytes: MAX_FILE_BYTES,
});

export type MemoryCommand = ReturnType<typeof memoryCommandSchema.parse>;

export async function runMemoryCommand(
  input: MemoryCommand,
  store: MemoryFsStore,
): Promise<MemoryFsResult> {
  return runFsCommand(input, store, MEMORY_LIMITS);
}

/**
 * Compose the model-visible index of what is in memory.
 *
 * Only paths and sizes, never contents. Progressive disclosure: the model learns
 * that `/memories/preferences.md` exists and can `view` it when a turn actually
 * calls for it, instead of paying for every remembered note on every request.
 */
export function memoryDirectoryBlock(files: MemoryFile[]): string {
  return fsDirectoryBlock(files, {
    lead:
      "Your memory directory contains these files. Use the `memory` tool to view " +
      "or edit them when the conversation calls for it:",
  });
}
