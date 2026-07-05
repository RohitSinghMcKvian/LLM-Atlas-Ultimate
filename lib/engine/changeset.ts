// Change sets (Depth Spec v2 B.3): a logical atomic unit of agent work =
// a pre-state checkpoint + the ChangeRecords a todo produced, split into
// per-file hunks for granular review. Writes stay LIVE during the run
// (verification needs real files); atomicity is at accept/reject time.
//
// Pure helpers here (grouping, hunk splitting via LCS, reverse-patch); the
// store applies rejections and the checkpoint restore.

import { diffLines, type DiffLine } from "@/lib/diff";
import type { ChangeRecord } from "@/lib/code/tools";
import type { ChangeSet, Hunk } from "./types";

/** Collapse many ChangeRecords for one path into net before/after. */
export function netChange(records: ChangeRecord[]): { before: string | null; after: string | null } {
  if (records.length === 0) return { before: null, after: null };
  const sorted = [...records].sort((a, b) => a.ts - b.ts);
  return { before: sorted[0].before, after: sorted[sorted.length - 1].after };
}

interface FileNet {
  path: string;
  before: string | null;
  after: string | null;
}

/** One net before/after per path across a set of records (chronological). */
export function netByPath(records: ChangeRecord[]): FileNet[] {
  const byPath = new Map<string, ChangeRecord[]>();
  for (const r of records) {
    const list = byPath.get(r.path) ?? [];
    list.push(r);
    byPath.set(r.path, list);
  }
  const out: FileNet[] = [];
  for (const [path, recs] of byPath) {
    const { before, after } = netChange(recs);
    if (before === after) continue; // no net change
    out.push({ path, before, after });
  }
  return out;
}

const CONTEXT = 2;

/**
 * Split a file's before→after into contiguous hunks. Each hunk carries enough
 * of the surrounding BEFORE lines to be re-applied or reverse-applied exactly.
 */
export function splitHunks(path: string, before: string, after: string): Hunk[] {
  const diff = diffLines(before, after);
  const hunks: Hunk[] = [];
  let i = 0;
  while (i < diff.length) {
    if (diff[i].type === "ctx") {
      i++;
      continue;
    }
    // Extend across a run of changes (allowing small context gaps).
    let j = i;
    let gap = 0;
    let end = i;
    while (j < diff.length) {
      if (diff[j].type !== "ctx") {
        end = j;
        gap = 0;
      } else if (++gap > CONTEXT) {
        break;
      }
      j++;
    }
    const start = Math.max(0, i - CONTEXT);
    const stop = Math.min(diff.length - 1, end + CONTEXT);
    const slice = diff.slice(start, stop + 1);
    hunks.push(hunkFromSlice(path, slice, before));
    i = stop + 1;
  }
  return hunks;
}

function hunkFromSlice(path: string, slice: DiffLine[], before: string): Hunk {
  const beforeLines: string[] = [];
  const afterLines: string[] = [];
  for (const l of slice) {
    if (l.type === "ctx") {
      beforeLines.push(l.text);
      afterLines.push(l.text);
    } else if (l.type === "del") {
      beforeLines.push(l.text);
    } else {
      afterLines.push(l.text);
    }
  }
  // 0-based offset of this hunk's first BEFORE line.
  const firstOld = slice.find((l) => l.oldNo != null)?.oldNo;
  const startBefore = firstOld != null ? firstOld - 1 : before.split("\n").length;
  return {
    path,
    startBefore,
    before: beforeLines.join("\n"),
    after: afterLines.join("\n"),
    accepted: true,
  };
}

/** Build a ChangeSet (all hunks accepted) from a todo's records. */
export function buildChangeSet(
  id: string,
  taskId: string,
  checkpointId: string,
  label: string,
  records: ChangeRecord[],
  todoId?: string,
): ChangeSet {
  const nets = netByPath(records);
  const hunks = nets.flatMap((n) =>
    splitHunks(n.path, n.before ?? "", n.after ?? ""),
  );
  return { id, taskId, todoId, label, checkpointId, records, status: "staged", hunks };
}

/**
 * Reduce a file's current content by reverse-applying REJECTED hunks — i.e.
 * swap each rejected hunk's after-block back to its before-block. Returns the
 * content to write. Accepted hunks are left as-is (already live on disk).
 */
export function applyHunkDecisions(current: string, hunks: Hunk[]): string {
  let out = current;
  for (const h of hunks) {
    if (h.accepted) continue;
    if (h.after && out.includes(h.after)) {
      out = out.replace(h.after, h.before);
    } else if (!h.after && h.before) {
      // Pure deletion rejected — the lines were removed; nothing to swap here
      // (deletions are recovered from the checkpoint by the store).
    }
  }
  return out;
}

/** Files touched by a change set, for the grouped review header. */
export function changeSetFiles(cs: ChangeSet): string[] {
  return [...new Set(cs.hunks.map((h) => h.path))];
}
