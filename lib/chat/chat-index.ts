"use client";

import {
  BY_CONVERSATION,
  CHAT_CHUNKS,
  deleteByIndex,
  getAll,
  idbAvailable,
  openChatDb,
  putMany,
} from "./idb";
import { chunkText } from "./chunk";
import { cosine, type Embedder, type Embedding } from "./embed";
import { isIncognito } from "./incognito";
import { uuid, type ChatMessage } from "./types";

/**
 * Past-chat search (spec §4.7): "what did we discuss about X" should find the
 * earlier conversation and cite it.
 *
 * Reuses P3's retrieval machinery wholesale — the same `chunkText` splitter, the
 * same `Embedder` contract, the same brute-force cosine — over a separate
 * `chat_chunks` store. Two stores rather than one shared table because the
 * lifecycles differ: project chunks are invalidated when a file changes, chat
 * chunks when a conversation gains a turn, and the staleness checks would fight
 * each other in a single index.
 *
 * Retrieval is lexical by default, exactly as in P3, with the same honest
 * caveat: it matches wording, not meaning. For recalling a past discussion that
 * is a smaller handicap than it sounds — people tend to search for a topic using
 * the words they used at the time.
 */

interface StoredChatChunk {
  id: string;
  conversationId: string;
  /** Denormalised so a search result can be cited without a second lookup. */
  title: string;
  updatedAt: number;
  chunkIndex: number;
  text: string;
  vector: number[];
  dims: number;
  model: string;
  /** Fingerprint of the messages this index was built from. */
  fingerprint: string;
}

export interface PastChatHit {
  conversationId: string;
  title: string;
  chunkIndex: number;
  text: string;
  score: number;
  updatedAt: number;
}

/** Chats shorter than this aren't worth indexing — nothing to recall yet. */
const MIN_INDEXABLE_CHARS = 200;
/** Chat turns are shorter than documents, so chunk smaller than P3's 2000. */
const CHAT_TARGET_CHARS = 1200;
const CHAT_OVERLAP_CHARS = 150;

async function db(): Promise<IDBDatabase | null> {
  if (!idbAvailable()) return null;
  try {
    return await openChatDb();
  } catch {
    return null;
  }
}

/**
 * Flatten a thread into searchable text.
 *
 * Role labels are kept in the text because they carry meaning for recall — "I
 * said I preferred X" and "you suggested X" are different facts, and a chunk
 * that has lost its speaker can't distinguish them.
 *
 * Empty and errored turns are dropped. A failure notice ("the provider did not
 * respond…") is mechanism, not conversation: indexing it dilutes the vectors,
 * and worse, it can surface as a search hit and be cited back to the user as
 * something they discussed.
 */
export function transcriptOf(messages: ChatMessage[]): string {
  return messages
    .filter((m) => !m.error && m.content.trim())
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.trim()}`)
    .join("\n\n");
}

/**
 * Cheap staleness key for a thread.
 *
 * Message ids plus content lengths, not the content itself: appending a turn or
 * editing one both change it, while re-rendering the same thread does not. FNV-1a
 * for consistency with `filesFingerprint`.
 */
export function transcriptFingerprint(messages: ChatMessage[]): string {
  let h = 0x811c9dc5;
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  for (const m of messages) {
    mix(m.id);
    mix(`:${m.content.length}:`);
  }
  return (h >>> 0).toString(36);
}

/**
 * Index (or re-index) one conversation.
 *
 * Idempotent by fingerprint, so calling it after every assistant turn is cheap
 * when nothing changed. Skipped entirely in incognito — a temporary chat that
 * left a searchable index behind would be the exact leak the mode exists to
 * prevent, and the index is the least obvious of the three write paths.
 */
export async function indexConversation(
  conversation: { id: string; title: string; updatedAt?: number },
  messages: ChatMessage[],
  embed: Embedder,
): Promise<{ indexed: boolean; chunks: number }> {
  if (isIncognito()) return { indexed: false, chunks: 0 };
  const d = await db();
  if (!d) return { indexed: false, chunks: 0 };

  const transcript = transcriptOf(messages);
  if (transcript.length < MIN_INDEXABLE_CHARS) return { indexed: false, chunks: 0 };

  const fingerprint = transcriptFingerprint(messages);
  const existing = (await allChunks(d)).filter((c) => c.conversationId === conversation.id);
  if (existing.length > 0 && existing[0].fingerprint === fingerprint) {
    return { indexed: false, chunks: existing.length };
  }

  const texts = chunkText(transcript, {
    targetChars: CHAT_TARGET_CHARS,
    overlapChars: CHAT_OVERLAP_CHARS,
  });
  if (texts.length === 0) return { indexed: false, chunks: 0 };

  const embeddings: Embedding[] = await embed(texts);
  const updatedAt = conversation.updatedAt ?? Date.now();
  const rows: StoredChatChunk[] = texts.map((text, i) => ({
    id: uuid(),
    conversationId: conversation.id,
    title: conversation.title,
    updatedAt,
    chunkIndex: i,
    text,
    vector: embeddings[i].vector,
    dims: embeddings[i].dims,
    model: embeddings[i].model,
    fingerprint,
  }));

  // Clear first so a shortened or edited thread can't leave orphan chunks that
  // would keep matching text the user has since removed.
  await deleteByIndex(d, CHAT_CHUNKS, BY_CONVERSATION, conversation.id);
  await putMany(d, CHAT_CHUNKS, rows);
  return { indexed: true, chunks: rows.length };
}

async function allChunks(d: IDBDatabase): Promise<StoredChatChunk[]> {
  try {
    return await getAll<StoredChatChunk>(d, CHAT_CHUNKS);
  } catch {
    return [];
  }
}

/** Drop one conversation's index (called when the conversation is deleted). */
export async function clearConversationIndex(conversationId: string): Promise<void> {
  const d = await db();
  if (!d) return;
  await deleteByIndex(d, CHAT_CHUNKS, BY_CONVERSATION, conversationId);
}

export interface SearchPastChatsOptions {
  /** Don't return the conversation the user is currently in. */
  excludeConversationId?: string;
  k?: number;
  /**
   * Floor on cosine similarity. Without one, a query with no real match still
   * returns the k least-bad chunks, and the model cites them as if they were
   * answers — a confident wrong citation is worse than "nothing found".
   */
  minScore?: number;
}

export const DEFAULT_MIN_SCORE = 0.05;

/** Top-k chunks across all indexed conversations, best first. */
export async function searchPastChats(
  query: string,
  embed: Embedder,
  opts: SearchPastChatsOptions = {},
): Promise<PastChatHit[]> {
  const d = await db();
  if (!d) return [];
  const [q] = await embed([query]);
  if (!q) return [];

  const k = opts.k ?? 5;
  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;
  const rows = await allChunks(d);

  const scored = rows
    .filter(
      (r) =>
        r.conversationId !== opts.excludeConversationId &&
        // Same guard as project retrieval: never score a lexical vector against
        // a provider vector, or two different dimensionalities.
        r.dims === q.dims &&
        r.model === q.model,
    )
    .map((r) => ({
      conversationId: r.conversationId,
      title: r.title,
      chunkIndex: r.chunkIndex,
      text: r.text,
      updatedAt: r.updatedAt,
      score: cosine(r.vector, q.vector),
    }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score);

  // One chunk per conversation: five excerpts from the same thread crowd out
  // four other threads that each answer part of the question.
  const seen = new Set<string>();
  const out: PastChatHit[] = [];
  for (const hit of scored) {
    if (seen.has(hit.conversationId)) continue;
    seen.add(hit.conversationId);
    out.push(hit);
    if (out.length >= k) break;
  }
  return out;
}

/**
 * Format hits for the model, carrying the citation with the text.
 *
 * The title and id travel with each excerpt so the model can attribute a claim
 * to a specific past conversation rather than to "we talked about this before".
 */
export function formatPastChats(hits: PastChatHit[]): string {
  if (hits.length === 0) {
    return "No past conversations matched that. Say so rather than guessing at what was discussed.";
  }
  return hits
    .map(
      (h, i) =>
        `[${i + 1}] from "${h.title}" (conversation ${h.conversationId}, ` +
        `last updated ${new Date(h.updatedAt).toISOString().slice(0, 10)})\n${h.text}`,
    )
    .join("\n\n");
}

/** How many conversations currently have an index, for the memory dialog. */
export async function indexedConversationCount(): Promise<number> {
  const d = await db();
  if (!d) return 0;
  return new Set((await allChunks(d)).map((c) => c.conversationId)).size;
}

/** Wipe the whole past-chat index (a user-facing "forget my history" action). */
export async function clearPastChatIndex(): Promise<void> {
  const d = await db();
  if (!d) return;
  const rows = await allChunks(d);
  const ids = new Set(rows.map((r) => r.conversationId));
  for (const id of ids) await deleteByIndex(d, CHAT_CHUNKS, BY_CONVERSATION, id);
}
