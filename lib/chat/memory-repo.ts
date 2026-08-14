"use client";

import { MEMORY_FILES, del, get, getAll, idbAvailable, openChatDb, put } from "./idb";
import { isIncognito } from "./incognito";
import type { MemoryFile, MemoryFsStore } from "./memory-fs";

/**
 * IndexedDB implementation of the `/memories` filesystem.
 *
 * Local-first per §1.5: memory files never leave the browser unless a Supabase
 * sync driver is added later. Keyed by path, so `read`/`write`/`remove` are
 * single-record operations with no index to keep consistent.
 */

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openChatDb().catch((e) => {
      // Don't cache a rejection: a transient failure (blocked upgrade in another
      // tab) should be retried on the next call, not remembered forever.
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

/** Test seam: drop the memoized connection. */
export function resetMemoryDb(): void {
  dbPromise = null;
}

/**
 * A store that reads normally but drops writes.
 *
 * Incognito is enforced here as well as at the ChatRepo seam because memory
 * files are a separate storage path — the whole point of the mode is that a
 * temporary conversation leaves nothing behind, and a model that helpfully
 * writes a note to `/memories` during one would defeat it. Reads stay open so
 * the model can still *use* what the user has already chosen to remember.
 */
export function memoryFsStore(): MemoryFsStore {
  return {
    async list() {
      if (!idbAvailable()) return [];
      try {
        return await getAll<MemoryFile>(await db(), MEMORY_FILES);
      } catch {
        return [];
      }
    },
    async read(path) {
      if (!idbAvailable()) return undefined;
      try {
        return await get<MemoryFile>(await db(), MEMORY_FILES, path);
      } catch {
        return undefined;
      }
    },
    async write(path, text) {
      if (!idbAvailable() || isIncognito()) return;
      const file: MemoryFile = { path, text, updatedAt: Date.now() };
      await put(await db(), MEMORY_FILES, file);
    },
    async remove(path) {
      if (!idbAvailable() || isIncognito()) return;
      await del(await db(), MEMORY_FILES, path);
    },
  };
}

/** Every memory file, for the memory dialog. */
export async function listMemoryFiles(): Promise<MemoryFile[]> {
  return memoryFsStore().list();
}

/** Delete one memory file from the UI. Respects incognito like every write. */
export async function deleteMemoryFile(path: string): Promise<void> {
  return memoryFsStore().remove(path);
}
