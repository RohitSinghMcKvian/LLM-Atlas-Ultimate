"use client";

import { ARTIFACTS, ARTIFACT_STORAGE, ARTIFACT_VERSIONS, BY_ARTIFACT } from "./idb";
import {
  artifactStore,
  listArtifactsForConversation,
  pathOf,
  type ArtifactRecord,
  type ArtifactStorageRow,
  type ArtifactVersionRecord,
} from "./artifact-repo";
import { uuid } from "./types";
import { workspaceRepo } from "./workspace/repo";

/**
 * Copying a build from one conversation into another (spec §4, "remix").
 *
 * The gap this closes is not only the missing remix action — it is that **fork
 * already lost the build**. `forkConversation` copies messages and nothing else,
 * and every part of a build is keyed by conversation id, so the fork arrived
 * with a transcript that talks about a page it does not have.
 *
 * It looked like it worked, which is worse. `chat-client.tsx` backfills
 * artifacts from fenced code in the transcript when a conversation has no
 * records, so a fork of a simple one-file build appeared to keep it. What that
 * backfill cannot reconstruct is everything the transcript never contained:
 *
 *  - files the `artifact` tool wrote or patched (§P14) — a tool call leaves no
 *    fence, so those files simply do not exist in the copy;
 *  - renames (§P15) — the fence still names the old path, so the file comes
 *    back under it;
 *  - deletes (§P15) — the fence is still in the transcript, so a removed file
 *    reappears;
 *  - version history — the fences show what was *sent*, so patched-in-place
 *    versions collapse;
 *  - whatever the page saved through `window.storage`;
 *  - the `/workspace` filesystem the model actually edits.
 *
 * So the copy is made from storage, not from the transcript.
 *
 * Artifacts and the workspace are copied together, deliberately. They are two
 * views of one build — `workspace/mirror.ts` projects workspace files into
 * artifacts — and copying only the artifacts would give a remix that previews
 * correctly but whose `/workspace` is empty, so the model's first edit would
 * start from nothing and then overwrite the preview with it.
 */

export interface BuildCopyResult {
  files: number;
  versions: number;
  storageRows: number;
  workspaceFiles: number;
  tasks: number;
}

const NOTHING: BuildCopyResult = {
  files: 0,
  versions: 0,
  storageRows: 0,
  workspaceFiles: 0,
  tasks: 0,
};

/** Whether `from` has anything worth copying, without doing the copy. */
export async function hasBuild(conversationId: string): Promise<boolean> {
  const records = await listArtifactsForConversation(conversationId);
  return records.length > 0;
}

/**
 * Duplicate `from`'s build into `to`.
 *
 * Additive: anything already in `to` is left alone, and a path collision is
 * skipped rather than overwritten. The only callers create `to` first, so a
 * collision means something unexpected happened and silently destroying the
 * destination's file would be the wrong response to it.
 *
 * Ids are regenerated. Two conversations must not share an artifact id — the id
 * is what `artifact_storage` is keyed by, so a shared one would mean the remix
 * and the original writing over each other's saved state for as long as both
 * exist.
 */
export async function copyBuild(from: string, to: string): Promise<BuildCopyResult> {
  if (from === to) return NOTHING;
  const s = await artifactStore();
  if (!s) return NOTHING;

  const sources = await listArtifactsForConversation(from);
  const existing = await listArtifactsForConversation(to, { includeDeleted: true });
  const taken = new Set(existing.map(pathOf));

  const result: BuildCopyResult = { ...NOTHING };

  for (const source of sources) {
    const path = pathOf(source);
    if (taken.has(path)) continue;

    const id = uuid();
    // `createdAt` is carried across rather than reset to now, because
    // `listArtifactsForConversation` orders by it and the panel's file switcher
    // shows that order — a copy stamped all-at-once would shuffle the build's
    // files into whatever order the loop happened to run in. `updatedAt` is
    // now: that is when this copy last changed, and it is true.
    const record: ArtifactRecord = {
      ...source,
      id,
      conversationId: to,
      path,
      updatedAt: Date.now(),
    };
    await s.put(ARTIFACTS, record);
    result.files++;

    const versions = await s.allByIndex<ArtifactVersionRecord>(
      ARTIFACT_VERSIONS,
      BY_ARTIFACT,
      source.id,
    );
    for (const version of versions) {
      // `messageId` is dropped. It points at a message in the source
      // conversation, and a fork regenerates every message id, so keeping it
      // would be a reference to a row this conversation does not have — and
      // `recordVersion` treats a matching messageId as "same turn, edit in
      // place", which would then edit the wrong version.
      const { messageId: _fromAnotherThread, ...rest } = version;
      await s.put(ARTIFACT_VERSIONS, {
        ...rest,
        id: uuid(),
        artifactId: id,
      } satisfies ArtifactVersionRecord);
      result.versions++;
    }

    // The page's saved state travels with the page. A build remixed without it
    // is a different program on first open — a dashboard with no data, a game
    // with no progress — and the user asked for a copy, not a reset.
    const rows = await s.allByIndex<ArtifactStorageRow>(
      ARTIFACT_STORAGE,
      BY_ARTIFACT,
      source.id,
    );
    for (const row of rows) {
      await s.put(ARTIFACT_STORAGE, { ...row, artifactId: id } satisfies ArtifactStorageRow);
      result.storageRows++;
    }
  }

  Object.assign(result, await copyWorkspace(from, to));
  return result;
}

/**
 * The `/workspace` half.
 *
 * Goes through `workspaceRepo()` rather than IndexedDB directly, so it inherits
 * that layer's driver choice and its incognito gate. In incognito the writes are
 * dropped — which is right, and not a half-copy: a source conversation in
 * incognito never had its workspace written either, so there is nothing to lose.
 */
async function copyWorkspace(
  from: string,
  to: string,
): Promise<Pick<BuildCopyResult, "workspaceFiles" | "tasks">> {
  try {
    const repo = await workspaceRepo();
    const snapshot = await repo.snapshot(from);
    const already = new Set((await repo.listFiles(to)).map((f) => f.path));

    for (const file of snapshot.files) {
      if (already.has(file.path)) continue;
      await repo.writeFile(to, file.path, file.content);
    }

    // The ledger comes across as it stands, done steps included. Resetting it
    // would describe the copy as unstarted work while its output sits right
    // there in the files, which is the one reading of it that is false.
    if (snapshot.tasks.length) {
      await repo.replaceTasks(
        to,
        snapshot.tasks.map((t) => ({ ...t, id: uuid(), conversationId: to })),
      );
    }
    if (snapshot.goal) await repo.setGoal(to, snapshot.goal);

    // Counted by reading back rather than by counting the write calls, because
    // this repo drops writes in incognito. Tallying attempts would report a
    // workspace that was copied when nothing was.
    return {
      workspaceFiles: (await repo.listFiles(to)).length - already.size,
      tasks: (await repo.listTasks(to)).length,
    };
  } catch {
    // A build that copies its artifacts but not its workspace is still worth
    // more to the caller than a thrown error that copies neither.
    return { workspaceFiles: 0, tasks: 0 };
  }
}
