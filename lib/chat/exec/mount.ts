/**
 * Getting files in and out of the Python interpreter.
 *
 * Atlas Code's Pyodide sync is deliberately one-way — workspace into the FS,
 * nothing back — because there the durable output is whatever the agent then
 * writes with `write_file`. Chat cannot borrow that rule. In chat the file Python
 * produced *is* the deliverable: ask for a spreadsheet and the `.xlsx` bytes
 * `openpyxl` wrote are the answer, and a one-way sync would drop them on the
 * floor and leave the model describing a file that no longer exists.
 *
 * So chat mounts, runs, and then diffs. This module is the diff — the half that
 * can be tested without an interpreter. It never touches Pyodide; it is handed
 * before-and-after listings and works out what changed.
 */

/** A file as it exists on either side of a run. */
export interface MountEntry {
  /** Relative to the mount root, e.g. `data/sales.csv`. */
  path: string;
  /** Text content, or undefined when the file is binary. */
  text?: string;
  /** Byte length. Present for every entry, text or not. */
  size: number;
  /** Cheap content identity. Compared rather than the content itself. */
  hash: string;
}

export interface MountDiff {
  created: string[];
  modified: string[];
  /** Files Python deleted. Reported, never acted on — see below. */
  removed: string[];
}

/**
 * Per-run ceilings on what comes back.
 *
 * A script that writes a 40 MB array to disk is a plausible accident, and the
 * workspace is IndexedDB shared with everything else the origin stores. These
 * are deliberately tighter than `WS_MAX_*`: those bound what a user's build may
 * grow to over its life, this bounds what one unattended script may add to it in
 * one call.
 */
export const MAX_EXPORT_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_EXPORT_FILES = 16;
export const MAX_EXPORT_TOTAL_BYTES = 8 * 1024 * 1024;

/**
 * A fast, order-stable content hash.
 *
 * FNV-1a rather than anything cryptographic: this only has to distinguish "the
 * script rewrote this file" from "the script left it alone", and it runs over
 * every mounted file on every call. A collision costs one unnecessary export.
 */
export function hashContent(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Index a listing by path, so the diff is two lookups rather than a scan. */
export function manifestOf(entries: MountEntry[]): Map<string, MountEntry> {
  return new Map(entries.map((e) => [e.path, e]));
}

/**
 * What the run changed.
 *
 * `removed` is reported but the caller does not act on it. A Python script that
 * deletes its input is far more likely to have made a mistake than to have meant
 * it, and propagating that would let one bad `os.remove` destroy a build the
 * model spent twenty rounds on. Deleting a workspace file stays something the
 * user or the `workspace` tool does explicitly.
 */
export function diffMount(before: MountEntry[], after: MountEntry[]): MountDiff {
  const prior = manifestOf(before);
  const now = manifestOf(after);
  const created: string[] = [];
  const modified: string[] = [];

  for (const [path, entry] of now) {
    const was = prior.get(path);
    if (!was) created.push(path);
    else if (was.hash !== entry.hash || was.size !== entry.size) modified.push(path);
  }

  const removed = [...prior.keys()].filter((p) => !now.has(p));
  return { created: created.sort(), modified: modified.sort(), removed: removed.sort() };
}

export interface ExportPlan {
  /** Paths to write back, in a stable order. */
  paths: string[];
  /** Files the caps excluded, with the reason, so the model can be told. */
  skipped: { path: string; reason: "too-large" | "too-many" | "total-exceeded" }[];
}

/**
 * Which changed files may be written back.
 *
 * Applied in path order rather than by size or recency, so the same run always
 * produces the same result — a cap that silently kept a different subset each
 * time would be worse than one that refuses predictably.
 *
 * Every exclusion is reported. A file that quietly failed to save is the exact
 * failure this whole two-way sync exists to prevent, and the model can only tell
 * the user about it if the tool tells the model.
 */
export function planExport(changed: string[], after: MountEntry[]): ExportPlan {
  const now = manifestOf(after);
  const paths: string[] = [];
  const skipped: ExportPlan["skipped"] = [];
  let total = 0;

  for (const path of [...changed].sort()) {
    const entry = now.get(path);
    if (!entry) continue;
    if (entry.size > MAX_EXPORT_FILE_BYTES) {
      skipped.push({ path, reason: "too-large" });
      continue;
    }
    if (paths.length >= MAX_EXPORT_FILES) {
      skipped.push({ path, reason: "too-many" });
      continue;
    }
    if (total + entry.size > MAX_EXPORT_TOTAL_BYTES) {
      skipped.push({ path, reason: "total-exceeded" });
      continue;
    }
    paths.push(path);
    total += entry.size;
  }

  return { paths, skipped };
}

/** Extensions Python commonly produces that are worth keeping as bytes. */
const BINARY_EXT =
  /\.(xlsx|xls|docx|doc|pptx|pdf|zip|png|jpe?g|gif|webp|svgz|parquet|db|sqlite3?|npy|npz|wav|mp3|mp4)$/i;

/**
 * Whether a produced file should be stored as bytes rather than text.
 *
 * Decided by extension, not by sniffing content. A `.xlsx` is a zip container
 * and would survive a UTF-8 round trip as mojibake that opens in nothing — and
 * by the time that is discovered the original bytes are gone.
 */
export function isBinaryPath(path: string): boolean {
  return BINARY_EXT.test(path);
}

/** One line per exclusion, phrased so the model can pass it on. */
export function describeSkipped(skipped: ExportPlan["skipped"]): string {
  if (!skipped.length) return "";
  const reason = (r: ExportPlan["skipped"][number]["reason"]) =>
    r === "too-large"
      ? `over the ${Math.round(MAX_EXPORT_FILE_BYTES / 1024 / 1024)}MB per-file limit`
      : r === "too-many"
        ? `past the ${MAX_EXPORT_FILES}-file limit for one run`
        : `past the ${Math.round(MAX_EXPORT_TOTAL_BYTES / 1024 / 1024)}MB total for one run`;
  return skipped.map((s) => `${s.path} was not saved — ${reason(s.reason)}.`).join(" ");
}
