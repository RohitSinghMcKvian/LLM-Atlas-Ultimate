import type { ChatRepo } from "./repo";
import type { ChatMessage } from "./types";

/**
 * A ChatRepo that reads but never writes — the enforcement mechanism for
 * incognito mode.
 *
 * Wrapping the repo is what makes "incognito writes nothing" *provable* rather
 * than merely intended. Every persistence path in the app goes through the
 * `ChatRepo` interface, so blocking the interface blocks all of them at once —
 * including any write added later by a phase that never heard of incognito. The
 * alternative, an `if (isIncognito()) return` at each of the ~8 call sites in
 * chat-store, would be one forgotten branch away from leaking a conversation the
 * user explicitly asked not to keep.
 *
 * Reads pass through unchanged: entering incognito hides nothing that is already
 * saved, so existing history stays browsable. The current conversation lives in
 * the zustand store's in-memory state, which is why the session still works with
 * every write dropped — and why closing the tab is what erases it.
 *
 * Deletes are blocked too. That may read as over-broad, but a delete is a
 * durable mutation of saved data, and the guarantee being made is about the
 * *storage layer*, not about intent. A user who wants to delete history can
 * leave incognito first; a bug that deletes history because incognito relaxed
 * the rule for one method is unrecoverable.
 */
export function readOnlyRepo(base: ChatRepo): ChatRepo {
  return {
    // Surfaced as-is: the UI's "synced" indicator should keep describing where
    // the data it is *reading* comes from, not claim to be local.
    remote: base.remote,

    listConversations: () => base.listConversations(),
    listMessages: (conversationId: string): Promise<ChatMessage[]> =>
      base.listMessages(conversationId),

    async createConversation() {
      /* incognito: dropped */
    },
    async updateConversation() {
      /* incognito: dropped */
    },
    async deleteConversation() {
      /* incognito: dropped */
    },
    async addMessage() {
      /* incognito: dropped */
    },
    async updateMessage() {
      /* incognito: dropped */
    },
    async updateMessages() {
      /* incognito: dropped */
    },
  };
}
