"use client";

import { chunkText } from "./chunk";
import { foldFingerprint, foldedMessages } from "./compact";
import { cosine, type Embedder, type Embedding } from "./embed";
import {
  BY_CONVERSATION,
  deleteByIndex,
  FOLD_CHUNKS,
  getAllByIndex,
  idbAvailable,
  openChatDb,
  putMany,
} from "./idb";
import { isIncognito } from "./incognito";
import { uuid, type ChatMessage } from "./types";

/**
 * Getting the original wording back out of a folded conversation.
 *
 * A summary is a lossy stand-in by construction. The model reading one has no
 * way to recover a number, a path or the exact phrasing of a requirement, and
 * the observed failure is not that it says "I don't know" — it is that it
 * confidently produces a plausible substitute. This is the escape hatch: the
 * folded turns stay searchable, so anything the summary dropped can be fetched
 * verbatim.
 *
 * A **separate tool** from `search_past_chats`, and a separate store, for three
 * reasons that each matter on their own:
 *
 *  - *Citation semantics.* A hit from ten minutes ago in this thread is not
 *    another conversation. A model told to cite it as one will say "we discussed
 *    this in a previous chat" about something the user said on this screen.
 *  - *Gate.* Recalling your own current conversation must not require the Memory
 *    toggle. That toggle is about mining history across threads; this is about
 *    reading the thread you are in.
 *  - *Staleness.* `indexConversation` wipes a conversation's `CHAT_CHUNKS`
 *    before writing, and its key is "the thread gained a turn". This index's key
 *    is "the fold set changed". Sharing a store would have the two wiping each
 *    other on alternate turns.
 *
 * Everything else is reused verbatim — `chunkText`, the `Embedder` contract,
 * brute-force `cosine`. Retrieval is lexical, with the same honest caveat as
 * everywhere else: it matches wording, not meaning. Here that handicap is at its
 * smallest, because someone recalling their own thread searches with the words
 * they used at the time.
 */

interface StoredFoldChunk {
  id: string;
  conversationId: string;
  /** The turn this came from, so the UI can scroll to it. */
  messageId: string;
  /** 1-based position in the conversation, so the model can say which turn. */
  turnIndex: number;
  role: "user" | "assistant";
  chunkIndex: number;
  text: string;
  vector: number[];
  dims: number;
  model: string;
  /** `foldFingerprint` of the fold this index was built from. */
  fingerprint: string;
}

export interface RecallHit {
  messageId: string;
  turnIndex: number;
  role: "user" | "assistant";
  text: string;
  score: number;
}

/** Turns shorter than this carry nothing worth a chunk of their own. */
const MIN_INDEXABLE_CHARS = 40;
const RECALL_TARGET_CHARS = 1_200;
const RECALL_OVERLAP_CHARS = 150;

/**
 * Ceiling on what one recall returns.
 *
 * The point of a fold is that those turns are not in the request. A recall that
 * can pull back twenty thousand characters of them re-creates the problem it was
 * invented to solve, one tool call at a time.
 */
export const RECALL_MAX_CHARS = 6_000;
export const RECALL_MIN_SCORE = 0.05;

async function db(): Promise<IDBDatabase | null> {
  if (!idbAvailable()) return null;
  try {
    return await openChatDb();
  } catch {
    return null;
  }
}

/**
 * Index this conversation's folded turns. Returns how many chunks were written.
 *
 * **Chunked per turn, not over a flattened transcript.** Flattening is what
 * `chat-index.ts` does, and it is right there: a past conversation is recalled
 * as a whole. Here it would be wrong, because a chunk that spans the boundary
 * between two turns has lost which one it came from, and "you said" versus "you
 * were told" is exactly the distinction a recall exists to settle.
 *
 * Skipped entirely in incognito. An index outliving a temporary chat is the leak
 * the mode exists to prevent, and it is the least obvious of the write paths.
 */
export async function indexFoldedTurns(
  conversationId: string,
  messages: ChatMessage[],
  embed: Embedder,
): Promise<number> {
  if (isIncognito()) return 0;
  const d = await db();
  if (!d) return 0;

  const fingerprint = foldFingerprint(messages);
  if (!fingerprint) return 0;

  // True 1-based position in the thread, not position among the folded turns:
  // pinned messages are interleaved and stay unfolded, so the two diverge, and
  // the number is only useful if it matches what the user can count on screen.
  const positions = new Map(messages.map((m, i) => [m.id, i + 1]));
  const folded = foldedMessages(messages);

  const existing = await chunksFor(d, conversationId);
  if (existing.length > 0 && existing[0].fingerprint === fingerprint) return existing.length;

  const pending: Omit<StoredFoldChunk, "vector" | "dims" | "model" | "id">[] = [];
  for (const m of folded) {
    const text = m.content.trim();
    if (m.error || text.length < MIN_INDEXABLE_CHARS) continue;
    const parts = chunkText(text, {
      targetChars: RECALL_TARGET_CHARS,
      overlapChars: RECALL_OVERLAP_CHARS,
    });
    parts.forEach((part, chunkIndex) => {
      pending.push({
        conversationId,
        messageId: m.id,
        turnIndex: positions.get(m.id) ?? 0,
        role: m.role === "user" ? "user" : "assistant",
        chunkIndex,
        text: part,
        fingerprint,
      });
    });
  }
  if (pending.length === 0) return 0;

  const embeddings: Embedding[] = await embed(pending.map((p) => p.text));
  const rows: StoredFoldChunk[] = pending.map((p, i) => ({
    ...p,
    id: uuid(),
    vector: embeddings[i].vector,
    dims: embeddings[i].dims,
    model: embeddings[i].model,
  }));

  // Cleared first for the same reason the past-chat index is: an unfold, an edit
  // or a branch would otherwise leave orphan chunks that keep matching text this
  // conversation no longer contains.
  await deleteByIndex(d, FOLD_CHUNKS, BY_CONVERSATION, conversationId);
  await putMany(d, FOLD_CHUNKS, rows);
  return rows.length;
}

async function chunksFor(d: IDBDatabase, conversationId: string): Promise<StoredFoldChunk[]> {
  try {
    return await getAllByIndex<StoredFoldChunk>(d, FOLD_CHUNKS, BY_CONVERSATION, conversationId);
  } catch {
    return [];
  }
}

export interface RecallOptions {
  k?: number;
  minScore?: number;
}

/** Best matching folded turns in this conversation, best first. */
export async function recallContext(
  conversationId: string,
  query: string,
  embed: Embedder,
  opts: RecallOptions = {},
): Promise<RecallHit[]> {
  const d = await db();
  if (!d) return [];
  const [q] = await embed([query]);
  if (!q) return [];

  const k = opts.k ?? 4;
  const minScore = opts.minScore ?? RECALL_MIN_SCORE;

  const scored = (await chunksFor(d, conversationId))
    // Same guard as project and past-chat retrieval: never score a lexical
    // vector against a provider vector, or two different dimensionalities.
    .filter((r) => r.dims === q.dims && r.model === q.model)
    .map((r) => ({
      messageId: r.messageId,
      turnIndex: r.turnIndex,
      role: r.role,
      text: r.text,
      score: cosine(r.vector, q.vector),
    }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score);

  // One chunk per turn: three excerpts from the same long answer crowd out three
  // other turns that each hold part of what was asked for.
  const seen = new Set<string>();
  const out: RecallHit[] = [];
  for (const hit of scored) {
    if (seen.has(hit.messageId)) continue;
    seen.add(hit.messageId);
    out.push(hit);
    if (out.length >= k) break;
  }
  // Chronological, not by score: these are turns of one conversation, and read
  // in relevance order they imply an ordering of events that never happened.
  return out.sort((a, b) => a.turnIndex - b.turnIndex);
}

/**
 * Format hits for the model, carrying the attribution with the text.
 *
 * Speaker and turn number travel with each excerpt so the model can say "you
 * said, in your twelfth message" instead of the vaguer and more dangerous "we
 * discussed" — which is how a recall of the user's own words starts sounding
 * like the model's own recollection.
 *
 * Truncated whole-excerpt at a time rather than mid-excerpt: half a quotation
 * attributed to a specific turn is worse than one fewer quotation.
 */
export function formatRecall(hits: RecallHit[], maxChars = RECALL_MAX_CHARS): string {
  if (hits.length === 0) {
    return (
      "Nothing in the folded part of this conversation matched that. Say so plainly — " +
      "do not fill the gap with a plausible guess."
    );
  }
  const blocks: string[] = [];
  let used = 0;
  for (const h of hits) {
    const who = h.role === "user" ? "The user said" : "You said";
    const block = `[turn ${h.turnIndex}] ${who}, verbatim:\n${h.text}`;
    if (used + block.length > maxChars) break;
    blocks.push(block);
    used += block.length + 2;
  }
  if (blocks.length === 0) {
    // The single best hit is on its own over budget. Clipping it is the only way
    // to return anything, and saying so is the only way that is not a forgery.
    const h = hits[0];
    return (
      `[turn ${h.turnIndex}] ${h.role === "user" ? "The user said" : "You said"}, verbatim ` +
      `(clipped to ${maxChars} characters):\n${h.text.slice(0, maxChars)}…`
    );
  }
  const note =
    blocks.length < hits.length
      ? `\n\n[${hits.length - blocks.length} further match(es) omitted to stay within budget. ` +
        `Search again with a narrower query if you need them.]`
      : "";
  return blocks.join("\n\n") + note;
}

/** Drop one conversation's fold index (on delete, or when the fold is undone). */
export async function clearRecallIndex(conversationId: string): Promise<void> {
  const d = await db();
  if (!d) return;
  await deleteByIndex(d, FOLD_CHUNKS, BY_CONVERSATION, conversationId);
}
