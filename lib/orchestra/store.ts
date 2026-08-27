"use client";

import {
  BY_CONVERSATION,
  ORCHESTRA_RUNS,
  del,
  deleteByIndex,
  get,
  getAllByIndex,
  idbAvailable,
  openChatDb,
  put,
} from "@/lib/chat/idb";
import { isIncognito } from "@/lib/chat/incognito";
import { isWellFormed, type OrchestraRun } from "./trace";

/**
 * Persisting a run.
 *
 * This is what turns the trace from a render detail into a record: a plan and
 * everything it did survives a reload, can be replayed, and can be audited
 * after the fact. Before this, per GAP-REPORT, "plans live in component state
 * only" - reopening a conversation showed the answers but not the run.
 *
 * Two rules carried from the rest of the repo:
 *
 *  - **Incognito writes nothing.** `lib/chat/incognito.ts` is the seam the chat
 *    repo already respects, and a temporary chat whose agent run is on disk is
 *    not temporary. Reads still work, so a run started before the mode was
 *    turned on stays visible.
 *  - **A persisted run is untrusted input.** It may have been written by an
 *    older build. `isWellFormed` rejects a trace whose ordering has been broken
 *    rather than loading it and rendering nonsense.
 */

async function db(): Promise<IDBDatabase | null> {
  if (!idbAvailable()) return null;
  try {
    return await openChatDb();
  } catch {
    return null;
  }
}

export async function saveRun(run: OrchestraRun): Promise<void> {
  if (isIncognito()) return;
  const d = await db();
  if (!d) return;
  try {
    await put(d, ORCHESTRA_RUNS, run);
  } catch {
    /* A run that cannot be persisted still works for this session. */
  }
}

export async function loadRun(id: string): Promise<OrchestraRun | null> {
  const d = await db();
  if (!d) return null;
  try {
    const found = await get<OrchestraRun>(d, ORCHESTRA_RUNS, id);
    if (!found) return null;
    return isWellFormed(found) ? found : null;
  } catch {
    return null;
  }
}

/** Runs for one conversation, newest first. */
export async function listRuns(conversationId: string): Promise<OrchestraRun[]> {
  const d = await db();
  if (!d) return [];
  try {
    const rows = await getAllByIndex<OrchestraRun>(d, ORCHESTRA_RUNS, BY_CONVERSATION, conversationId);
    return rows.filter(isWellFormed).sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    return [];
  }
}

export async function deleteRun(id: string): Promise<void> {
  const d = await db();
  if (!d) return;
  try {
    await del(d, ORCHESTRA_RUNS, id);
  } catch {
    /* ignore */
  }
}

/**
 * Drop every run for a conversation.
 *
 * Wired into conversation deletion for the reason P17 gives about builds: a
 * delete that leaves the agent trace behind is not a delete, and the orphan is
 * unreachable afterwards because nothing else knows its conversation id.
 */
export async function deleteRunsFor(conversationId: string): Promise<void> {
  const d = await db();
  if (!d) return;
  try {
    await deleteByIndex(d, ORCHESTRA_RUNS, BY_CONVERSATION, conversationId);
  } catch {
    /* ignore */
  }
}
