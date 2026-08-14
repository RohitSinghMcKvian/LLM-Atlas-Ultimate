"use client";

import { ARTIFACTS, ARTIFACT_STORAGE, ARTIFACT_VERSIONS, BY_ARTIFACT } from "./idb";
import {
  artifactStore,
  type ArtifactRecord,
  type ArtifactStorageRow,
  type ArtifactVersionRecord,
} from "./artifact-repo";
import { workspaceRepo } from "./workspace/repo";

/**
 * Deleting a build, and finding the ones nothing points at any more.
 *
 * Two holes, both found by reading the delete path rather than the write path.
 *
 * **Deleting a conversation did not delete its build.**
 * `deleteConversationCascade` drops the conversation row and its messages, and
 * `chat-store.remove` additionally clears the past-chat search index — with the
 * comment *"a deleted conversation that still turned up in `search_past_chats`
 * would be a deletion that didn't delete"*. Exactly that reasoning applies to
 * artifacts, their version history, their `window.storage` rows and the whole
 * `/workspace` filesystem, and none of them were touched.
 * `WorkspaceRepo.clear()` even documents itself as *"Used when the conversation
 * is deleted"* and had no caller outside its own test.
 *
 * **And the orphans were already there.** Every conversation deleted before this
 * left its build behind, as did every temporary chat before the incognito gate
 * landed in P16. Nothing lists those records, nothing can reach them, and
 * nothing ever removed them.
 *
 * The delete here is hard, unlike P15's soft delete of a single file. P15 is
 * about a build in progress, where the model removes a file and the user did not
 * ask for anything to be destroyed. This is the user deleting the conversation.
 */

export interface BuildDeleteResult {
  files: number;
  versions: number;
  storageRows: number;
}

const NOTHING: BuildDeleteResult = { files: 0, versions: 0, storageRows: 0 };

/**
 * Remove a conversation's build outright: records, history, saved state and its
 * `/workspace`.
 *
 * Deleted files are included — `includeDeleted` — because a soft-deleted record
 * is still a row, and leaving those behind would make this the very thing it
 * exists to prevent.
 *
 * In incognito the deletes land as tombstones in the session overlay rather than
 * on disk, which is right and needs no special case here: the mode's contract is
 * that storage is not modified, and `repo-private.ts` blocks the conversation
 * delete on exactly the same grounds.
 */
export async function deleteBuild(conversationId: string): Promise<BuildDeleteResult> {
  const s = await artifactStore();
  if (!s) return NOTHING;
  const result: BuildDeleteResult = { ...NOTHING };

  const records = (await s.all<ArtifactRecord>(ARTIFACTS)).filter(
    (r) => r.conversationId === conversationId,
  );

  for (const record of records) {
    // Children first. A crash between the two leaves version rows whose artifact
    // is gone — invisible either way, but the sweep below can still find them by
    // that dangling artifactId, whereas an artifact with no versions looks like
    // a legitimately empty file.
    for (const version of await s.allByIndex<ArtifactVersionRecord>(
      ARTIFACT_VERSIONS,
      BY_ARTIFACT,
      record.id,
    )) {
      await s.del(ARTIFACT_VERSIONS, version.id);
      result.versions++;
    }
    for (const row of await s.allByIndex<ArtifactStorageRow>(
      ARTIFACT_STORAGE,
      BY_ARTIFACT,
      record.id,
    )) {
      await s.del(ARTIFACT_STORAGE, [row.artifactId, row.key]);
      result.storageRows++;
    }
    await s.del(ARTIFACTS, record.id);
    result.files++;
  }

  try {
    await (await workspaceRepo()).clear(conversationId);
  } catch {
    // The artifacts are gone either way; a workspace that outlives them is a
    // smaller problem than a delete that throws halfway and removes neither.
  }

  try {
    // Generated binaries — the .xlsx and .pdf `run_python` produced. These are
    // the largest thing a conversation can leave behind and the only one nothing
    // lists once the conversation is gone, so a miss here strands megabytes
    // invisibly. Dynamically imported to keep this module free of the client-only
    // blob layer, matching how the store drops its search index.
    const { clearBlobs } = await import("./files/blob-repo");
    await clearBlobs(conversationId);
  } catch {
    /* same reasoning as the workspace above */
  }

  return result;
}

export interface SweepResult {
  /** Conversations whose build was removed. */
  conversations: number;
  files: number;
  versions: number;
  storageRows: number;
  /** Set when the sweep declined to run. Nothing was deleted. */
  skipped?: "not-authoritative" | "no-conversations" | "unavailable";
}

/**
 * How old an artifact must be before the sweep will consider it abandoned.
 *
 * Insurance against a write ordering this module cannot see: an artifact
 * recorded in the same moment its conversation is being created, where the
 * conversation row is not yet readable. A day costs nothing — these rows are
 * unreachable and are not in anyone's way — and it removes the only race that
 * could turn this into data loss.
 */
export const SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Delete every build whose conversation is not in `live`.
 *
 * **`authoritative` is the safety interlock, and the caller must not pass `true`
 * lightly.** This function deletes on the strength of an absence, so a `live`
 * set that is merely *incomplete* is indistinguishable from one where those
 * conversations were genuinely deleted — and the consequence is destroying a
 * build the user still has.
 *
 * The specific hazard is the Supabase driver. `listConversations()` sets no
 * explicit limit, and PostgREST applies a server-side maximum-rows cap, so a
 * long-lived account's list can come back truncated with no error and no signal
 * that it was. A caller reading from the remote driver therefore cannot claim
 * authority. The local drivers can: `getAll` over an object store and the
 * localStorage blob are both complete by construction.
 *
 * Two further refusals, both fail-closed:
 *  - an empty `live` set, because "the user has no conversations" and "the read
 *    failed and returned nothing" look identical from here, and the first is
 *    rare while the second is not;
 *  - no store at all.
 */
export async function sweepOrphanedBuilds(
  live: Iterable<string>,
  options: { authoritative: boolean; minAgeMs?: number; now?: number },
): Promise<SweepResult> {
  const empty: SweepResult = { conversations: 0, files: 0, versions: 0, storageRows: 0 };
  if (!options.authoritative) return { ...empty, skipped: "not-authoritative" };

  const keep = new Set(live);
  if (keep.size === 0) return { ...empty, skipped: "no-conversations" };

  const s = await artifactStore();
  if (!s) return { ...empty, skipped: "unavailable" };

  const now = options.now ?? Date.now();
  const minAge = options.minAgeMs ?? SWEEP_MIN_AGE_MS;

  // Grouped by conversation, and judged on the *newest* file in the build. A
  // build is swept only when every one of its files is old enough — one recent
  // write is evidence that something is still touching it, and that is reason
  // enough to leave the whole build alone for now.
  const newest = new Map<string, number>();
  for (const record of await s.all<ArtifactRecord>(ARTIFACTS)) {
    if (keep.has(record.conversationId)) continue;
    const seen = newest.get(record.conversationId) ?? 0;
    if (record.updatedAt > seen) newest.set(record.conversationId, record.updatedAt);
  }

  const orphaned = [...newest]
    .filter(([, updatedAt]) => now - updatedAt >= minAge)
    .map(([conversationId]) => conversationId);

  const result: SweepResult = { ...empty };
  for (const conversationId of orphaned) {
    const removed = await deleteBuild(conversationId);
    result.conversations++;
    result.files += removed.files;
    result.versions += removed.versions;
    result.storageRows += removed.storageRows;
  }
  return result;
}
