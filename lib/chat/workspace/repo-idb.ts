"use client";

import {
  BY_CONVERSATION,
  WORKSPACE_FILES,
  WORKSPACE_META,
  WORKSPACE_TASKS,
  del,
  deleteByIndex,
  get,
  getAllByIndex,
  openChatDb,
  put,
  putMany,
} from "../idb";
import type { WorkspaceRepo } from "./repo";
import type { WorkspaceFile, WorkspaceMeta, WorkspaceTask } from "./types";

/**
 * IndexedDB driver for the workspace (DB v8).
 *
 * Files use a composite `[conversationId, path]` key, so a read or write is a
 * single-record operation with no index to keep consistent — the same reasoning
 * that keyed `artifact_storage` by `[artifactId, key]`.
 *
 * The connection is memoized, and a rejection is deliberately not cached: a
 * transient failure (an upgrade blocked by another tab) must be retried on the
 * next call rather than disabling the workspace for the rest of the session.
 */

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openChatDb().catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

/** Test seam: drop the memoized connection so a fresh IDBFactory is picked up. */
export function resetWorkspaceDb(): void {
  dbPromise = null;
}

export function makeIdbWorkspaceRepo(): WorkspaceRepo {
  return {
    async listFiles(conversationId) {
      return getAllByIndex<WorkspaceFile>(
        await db(),
        WORKSPACE_FILES,
        BY_CONVERSATION,
        conversationId,
      );
    },

    async readFile(conversationId, path) {
      return get<WorkspaceFile>(await db(), WORKSPACE_FILES, [conversationId, path]);
    },

    async writeFile(conversationId, path, content) {
      const row: WorkspaceFile = { conversationId, path, content, updatedAt: Date.now() };
      await put(await db(), WORKSPACE_FILES, row);
    },

    async removeFile(conversationId, path) {
      await del(await db(), WORKSPACE_FILES, [conversationId, path]);
    },

    async listTasks(conversationId) {
      const rows = await getAllByIndex<WorkspaceTask>(
        await db(),
        WORKSPACE_TASKS,
        BY_CONVERSATION,
        conversationId,
      );
      return rows.sort((a, b) => a.order - b.order);
    },

    async replaceTasks(conversationId, tasks) {
      // Delete-then-insert rather than diffing: the ledger is small, it is
      // always written as a whole list, and a diff would have to reason about
      // ids the caller may have regenerated. Two transactions rather than one
      // because `deleteByIndex` owns its own; the window between them holds an
      // empty ledger, which reads as "no plan" rather than as wrong data.
      const d = await db();
      await deleteByIndex(d, WORKSPACE_TASKS, BY_CONVERSATION, conversationId);
      await putMany(
        d,
        WORKSPACE_TASKS,
        tasks.map((t) => ({ ...t, conversationId })),
      );
    },

    async getMeta(conversationId) {
      return get<WorkspaceMeta>(await db(), WORKSPACE_META, conversationId);
    },

    async setGoal(conversationId, goal) {
      const row: WorkspaceMeta = { conversationId, goal, updatedAt: Date.now() };
      await put(await db(), WORKSPACE_META, row);
    },

    async snapshot(conversationId) {
      const d = await db();
      const [files, tasks, meta] = await Promise.all([
        getAllByIndex<WorkspaceFile>(d, WORKSPACE_FILES, BY_CONVERSATION, conversationId),
        getAllByIndex<WorkspaceTask>(d, WORKSPACE_TASKS, BY_CONVERSATION, conversationId),
        get<WorkspaceMeta>(d, WORKSPACE_META, conversationId),
      ]);
      return {
        goal: meta?.goal ?? "",
        files,
        tasks: tasks.sort((a, b) => a.order - b.order),
      };
    },

    async clear(conversationId) {
      const d = await db();
      await deleteByIndex(d, WORKSPACE_FILES, BY_CONVERSATION, conversationId);
      await deleteByIndex(d, WORKSPACE_TASKS, BY_CONVERSATION, conversationId);
      await del(d, WORKSPACE_META, conversationId);
    },
  };
}
