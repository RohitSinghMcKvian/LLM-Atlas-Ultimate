"use client";

import type { FoldSummary } from "./compact";
import { del, FOLD_SUMMARIES, get, idbAvailable, openChatDb, put } from "./idb";
import { isIncognito } from "./incognito";

/**
 * Storage for the model-written fold summary: one row per conversation.
 *
 * Thin on purpose. The interesting rules — when to write one, whether the one on
 * disk still describes the current fold, what to do when the model returns
 * something unusable — live in `summarize.ts` and `summarize-run.ts`, where they
 * are testable without a database. This file only moves bytes.
 *
 * Every function degrades to a no-op when IndexedDB is unavailable or the
 * session is incognito, so the caller never has to branch on either. Losing the
 * summary costs the derived excerpt, not correctness.
 *
 * Local only, and not synced to Supabase. That is a real limitation — open the
 * same conversation on a second device and it falls back to the mechanical
 * excerpt — but it is a *correct* fallback rather than a broken state, and the
 * alternative is a table with no reader. Syncing it needs a driver on both sides
 * and a rule for which device's summary wins when two folds race; neither is
 * worth carrying until the feature has baked.
 */

async function db(): Promise<IDBDatabase | null> {
  if (!idbAvailable()) return null;
  try {
    return await openChatDb();
  } catch {
    return null;
  }
}

export async function loadFoldSummary(conversationId: string): Promise<FoldSummary | null> {
  const d = await db();
  if (!d) return null;
  try {
    return (await get<FoldSummary>(d, FOLD_SUMMARIES, conversationId)) ?? null;
  } catch {
    return null;
  }
}

export async function saveFoldSummary(summary: FoldSummary): Promise<void> {
  // An incognito conversation is folded in memory for the session, which is all
  // it ever gets. Persisting the summary would outlive the thread it describes —
  // and it is a *model-written* description of a temporary chat, which is the
  // most quotable thing in it.
  if (isIncognito()) return;
  const d = await db();
  if (!d) return;
  try {
    await put(d, FOLD_SUMMARIES, summary);
  } catch {
    // Quota, a blocked upgrade, a private-mode restriction. `applyFold` falls
    // back to the derived excerpt, so the conversation still works.
  }
}

export async function clearFoldSummary(conversationId: string): Promise<void> {
  const d = await db();
  if (!d) return;
  try {
    await del(d, FOLD_SUMMARIES, conversationId);
  } catch {
    // Nothing to do: the fingerprint check already stops a stale summary being
    // used, so a failed delete is untidy rather than incorrect.
  }
}
