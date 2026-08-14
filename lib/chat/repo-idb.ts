"use client";

import type { ChatMessage, Conversation } from "./types";
import type { ChatRepo } from "./repo";
import {
  BY_CONVERSATION,
  CONVERSATIONS,
  MESSAGES,
  deleteConversationCascade,
  del,
  get,
  getAll,
  getAllByIndex,
  openChatDb,
  put,
  putMany,
} from "./idb";

/**
 * IndexedDB driver for Atlas Chat — the local-first default (spec §1.5).
 *
 * Replaces the single-blob localStorage driver, which re-serialized every
 * conversation on every message. Here a message write touches one record.
 *
 * Messages are stored flat with a `conversationId` field and an index on it,
 * rather than nested under the conversation, so appending never rewrites the
 * thread and `listMessages` is a single indexed read.
 */

/** Stored shape: the UI message plus the foreign key the index is built on. */
type MessageRecord = ChatMessage & { conversationId: string };

const LEGACY_KEY = "atlas-chat-v1";
const MIGRATED_FLAG = "atlas-chat-idb-migrated";

interface LegacyBlob {
  conversations: Conversation[];
  messages: Record<string, ChatMessage[]>;
}

/**
 * One-time import of the localStorage blob.
 *
 * The legacy value is intentionally NOT deleted — if a user rolls back to a
 * build without this driver, their history should still be there. A separate
 * flag records that the import happened, so re-running is cheap and idempotent.
 */
async function migrateLegacyBlob(db: IDBDatabase): Promise<void> {
  if (typeof localStorage === "undefined") return;
  try {
    if (localStorage.getItem(MIGRATED_FLAG) === "1") return;
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) {
      localStorage.setItem(MIGRATED_FLAG, "1");
      return;
    }
    const blob = JSON.parse(raw) as LegacyBlob;
    const conversations = blob.conversations ?? [];
    const messages: MessageRecord[] = [];
    for (const [conversationId, list] of Object.entries(blob.messages ?? {})) {
      for (const m of list ?? []) messages.push({ ...m, conversationId });
    }
    if (conversations.length) await putMany(db, CONVERSATIONS, conversations);
    if (messages.length) await putMany(db, MESSAGES, messages);
    localStorage.setItem(MIGRATED_FLAG, "1");
  } catch {
    // A corrupt legacy blob must not prevent the app from starting; the user
    // gets an empty (working) store rather than a broken one.
    try {
      localStorage.setItem(MIGRATED_FLAG, "1");
    } catch {
      /* ignore */
    }
  }
}

/** Strip the storage-only foreign key before handing a message to the UI. */
function toMessage(r: MessageRecord): ChatMessage {
  const { conversationId: _drop, ...msg } = r;
  return msg;
}

export function makeIdbRepo(): ChatRepo {
  let dbPromise: Promise<IDBDatabase> | null = null;

  const db = () => {
    if (!dbPromise) {
      dbPromise = openChatDb().then(async (d) => {
        await migrateLegacyBlob(d);
        return d;
      });
      // Don't cache a rejection — a transient failure shouldn't disable storage
      // for the rest of the session.
      dbPromise.catch(() => {
        dbPromise = null;
      });
    }
    return dbPromise;
  };

  async function touch(conversationId: string, at = Date.now()): Promise<void> {
    const d = await db();
    const conv = await get<Conversation>(d, CONVERSATIONS, conversationId);
    if (conv) await put(d, CONVERSATIONS, { ...conv, updatedAt: at });
  }

  return {
    remote: false,

    async listConversations() {
      const list = await getAll<Conversation>(await db(), CONVERSATIONS);
      return list.sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async createConversation({ id, title, modelId, projectId }) {
      const now = Date.now();
      await put(await db(), CONVERSATIONS, {
        id,
        title,
        modelId,
        projectId: projectId ?? null,
        activeLeafId: null,
        createdAt: now,
        updatedAt: now,
      } satisfies Conversation);
    },

    async updateConversation(id, patch) {
      const d = await db();
      const cur = await get<Conversation>(d, CONVERSATIONS, id);
      if (!cur) return;
      await put(d, CONVERSATIONS, {
        ...cur,
        ...patch,
        updatedAt: patch.updatedAt ?? Date.now(),
      });
    },

    async deleteConversation(id) {
      await deleteConversationCascade(await db(), id);
    },

    async listMessages(conversationId) {
      const rows = await getAllByIndex<MessageRecord>(
        await db(),
        MESSAGES,
        BY_CONVERSATION,
        conversationId,
      );
      // The index doesn't order within a key, and the tree builder relies on
      // createdAt ordering to pick the newest sibling.
      return rows.sort((a, b) => a.createdAt - b.createdAt).map(toMessage);
    },

    async addMessage(conversationId, msg) {
      // `put` upserts by keyPath, which is what regenerate/persist needs.
      await put(await db(), MESSAGES, { ...msg, conversationId });
      await touch(conversationId);
    },

    async updateMessage(conversationId, id, patch) {
      const d = await db();
      const cur = await get<MessageRecord>(d, MESSAGES, id);
      if (!cur) return;
      await put(d, MESSAGES, { ...cur, ...patch, conversationId });
    },

    async updateMessages(conversationId, patches) {
      if (!patches.length) return;
      const d = await db();
      // One transaction for the whole fold. Get-then-put per id inside it, so
      // forty messages cost one round trip rather than forty — and the fold is
      // atomic, which matters because a half-applied one would send some turns
      // and summarise the rest.
      const tx = d.transaction(MESSAGES, "readwrite");
      const store = tx.objectStore(MESSAGES);
      for (const { id, patch } of patches) {
        const req = store.get(id);
        req.onsuccess = () => {
          const cur = req.result as MessageRecord | undefined;
          // An unknown id is skipped: a fold plan can name a message the user
          // deleted between planning and applying.
          if (cur) store.put({ ...cur, ...patch, conversationId });
        };
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
      });
    },
  };
}

/** Exported for tests: clears the one-time migration marker. */
export function resetIdbMigrationFlag(): void {
  try {
    localStorage.removeItem(MIGRATED_FLAG);
  } catch {
    /* ignore */
  }
}

export { MIGRATED_FLAG, LEGACY_KEY, del };
