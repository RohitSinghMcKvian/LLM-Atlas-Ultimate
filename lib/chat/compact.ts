import type { ChatMessage } from "./types";

/**
 * Compaction that keeps the build.
 *
 * What this replaces was actively destructive. `summarizeAndContinue()` called
 * `start()` — it opened a **new conversation** and pasted a summary into the
 * composer. Artifacts, versions and (now) the workspace are all keyed by
 * conversation id, so the one operation offered for a conversation that had
 * grown too long was the one operation guaranteed to abandon everything it had
 * produced. The summary itself was lossy too: user turns clipped to 100
 * characters and the last six messages to 1500.
 *
 * The fix is to stop moving. Compaction happens **in place**: earlier messages
 * are marked `folded` and stop being sent to the model, a summary message takes
 * their place in the request, and the conversation id never changes — so the
 * artifact, its version history and the workspace are all still attached
 * afterwards. The transcript still shows the folded turns; only the request
 * shrinks.
 *
 * Folding is an *inclusion flag, not a tree edit* (see `tree.ts`): parent links
 * are untouched, so `activePath`, the sibling stepper and `activeLeafId` all
 * behave exactly as before. That property is asserted in the tests, because a
 * compaction that silently broke branching would be a bad trade.
 *
 * Pure: this module decides what to fold and what the summary says. Applying it
 * is the caller's job, which keeps the interesting rules testable without a
 * store.
 */

/**
 * Turns always kept verbatim at the end of the thread.
 *
 * The baseline, for a 128k window. Prefer `keepRecentFor` — see there for why a
 * constant is the wrong shape once the catalog holds million-token models.
 */
export const KEEP_RECENT = 8;

/** Window the constants above were chosen against, and what scaling is relative to. */
const BASELINE_WINDOW = 128_000;

/**
 * Ceiling on the keep window.
 *
 * Not the window's fault — 200 verbatim turns would fit inside a million tokens
 * — but past this point folding has stopped being compaction and the summary is
 * doing no work. If a thread this long is still under pressure, the answer is a
 * summary of the earlier part, not keeping all of it.
 */
export const MAX_KEEP_RECENT = 48;

/**
 * How many turns to keep verbatim, for a given model.
 *
 * A fold that keeps eight turns is right when eight turns is most of what fits.
 * On a million-token window it discards a conversation the model could have held
 * entirely — and unlike the transcript trimmer, what it discards cannot be
 * re-fetched with a tool call, only recalled through a lossy index. So the keep
 * window scales with the room available, floored at today's value so no model
 * folds more aggressively than it did before.
 */
export function keepRecentFor(contextWindow?: number | null): number {
  if (!contextWindow || contextWindow <= 0) return KEEP_RECENT;
  const scaled = Math.round((KEEP_RECENT * contextWindow) / BASELINE_WINDOW);
  return Math.min(MAX_KEEP_RECENT, Math.max(KEEP_RECENT, scaled));
}

/**
 * A summary of this conversation's folded turns, written by a model.
 *
 * Stored rather than derived, because a model wrote it and re-deriving it would
 * mean paying for it again on every render. `fingerprint` is what keeps that
 * safe: it pins the summary to the exact set of folded turns it was written
 * from, so folding four more turns invalidates it rather than silently
 * describing a conversation that has moved on.
 *
 * Deliberately **not** a synthetic `ChatMessage`. Putting it in the tree would
 * mean every branching, sibling-stepping, export and regenerate path had to
 * learn to ignore one message that is not really a turn.
 */
export interface FoldSummary {
  conversationId: string;
  /** `foldFingerprint` of the messages this was written from. */
  fingerprint: string;
  /** The rendered block, header included — exactly what goes in the request. */
  text: string;
  /** Which model wrote it, so the header can say so. */
  model: string;
  createdAt: number;
  foldedCount: number;
}

/**
 * Below this there is nothing worth folding.
 *
 * Folding four messages to save a few hundred tokens costs a summary that is
 * about as long as what it replaced, and leaves the user with a "N earlier
 * messages" control hiding almost nothing.
 */
export const MIN_TO_COMPACT = KEEP_RECENT + 4;

/** How much of a folded turn survives into the summary. */
const SUMMARY_EXCERPT = 240;
const MAX_SUMMARY_CHARS = 4000;

export interface CompactionPlan {
  /** Messages to mark folded. Never includes pinned turns or the recent tail. */
  foldIds: string[];
  /** How many turns the fold covers, for the transcript's disclosure control. */
  foldedCount: number;
}

/**
 * Whether the conversation is worth compacting at this pressure.
 *
 * `usage` comes from `measureHealth`. 0.8 is the existing `critical` threshold;
 * compaction fires there rather than at the 0.6 `warning` used to *suggest* it,
 * because folding is visible and should not happen while there is still plenty
 * of room.
 */
export function shouldAutoCompact(
  usage: number,
  messages: ChatMessage[],
  keepRecent: number = KEEP_RECENT,
): boolean {
  return usage >= 0.8 && foldableCount(messages, keepRecent) > 0;
}

function foldableCount(messages: ChatMessage[], keepRecent: number): number {
  if (messages.length < keepRecent + 4) return 0;
  return messages
    .slice(0, -keepRecent)
    .filter((m) => !m.pinned && !m.folded).length;
}

/**
 * Decide what to fold.
 *
 * Three things are never folded:
 *
 *  - **Pinned messages**, which is what pinning is for. They stay verbatim in
 *    the request, exactly as `buildContinuationSummary` used to promise.
 *  - **The recent tail**, so the model still has the immediate conversation.
 *  - **Anything already folded**, so repeated compaction does not re-summarise
 *    its own summaries into mush.
 */
export function planCompaction(
  messages: ChatMessage[],
  keepRecent: number = KEEP_RECENT,
): CompactionPlan | null {
  if (messages.length < keepRecent + 4) return null;

  const older = messages.slice(0, -keepRecent);
  const toFold = older.filter((m) => !m.pinned && !m.folded);
  if (toFold.length === 0) return null;

  return { foldIds: toFold.map((m) => m.id), foldedCount: toFold.length };
}

/** The folded turns, in order. The input to both the summary and the recall index. */
export function foldedMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => m.folded);
}

/** Whether anything has been folded out of this thread — gates `recall_context`. */
export function hasFoldedContext(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.folded);
}

/**
 * Staleness key for the fold: which turns are folded, and how long each is.
 *
 * Folding four more turns changes it; re-rendering the same thread does not.
 * Same FNV-1a as `transcriptFingerprint`, and used for the same reason — it is
 * what lets a stored summary be trusted without re-reading the turns it came
 * from. Returns `""` when nothing is folded, so "no fold" and "some fold" can
 * never hash to the same key.
 */
export function foldFingerprint(messages: ChatMessage[]): string {
  const folded = foldedMessages(messages);
  if (folded.length === 0) return "";
  let h = 0x811c9dc5;
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  for (const m of folded) {
    mix(m.id);
    mix(`:${m.content.length}:`);
  }
  return `${folded.length}-${(h >>> 0).toString(36)}`;
}

/**
 * The stand-in for every folded turn, derived rather than stored.
 *
 * Deriving it matters: a summary held in component state would be gone after a
 * reload, and the folded messages would then be dropped from the request with
 * *nothing* in their place — silently amnesia rather than compaction. Computing
 * it from whatever currently carries `folded` means the only thing that has to
 * survive a reload is one boolean per message.
 *
 * This is the **fallback**. When `longContext` is on, a model writes a real
 * summary and `applyFold` prefers it. The two headers are worded differently on
 * purpose: this one says outright that it is a mechanical excerpt, so the model
 * is never left to guess whether it is reading a summary of the earlier turns or
 * merely their opening sentences.
 */
export function foldedSummary(messages: ChatMessage[]): string {
  const folded = foldedMessages(messages);
  if (folded.length === 0) return "";

  const lines: string[] = [
    `[${folded.length} earlier messages were folded to save context. Below is a ` +
      `mechanical excerpt — the opening of each turn, cut at ${SUMMARY_EXCERPT} characters — ` +
      `not a written summary, so anything past the first sentence of a turn is missing. ` +
      `The full transcript is still on screen, and the build workspace and any artifacts ` +
      `are unaffected.]`,
  ];

  for (const m of folded) {
    const who = m.role === "user" ? "User" : "Atlas";
    const text = m.content.replace(/\s+/g, " ").trim();
    if (!text) continue;
    lines.push(
      `${who}: ${text.length > SUMMARY_EXCERPT ? `${text.slice(0, SUMMARY_EXCERPT)}…` : text}`,
    );
  }

  const summary = lines.join("\n");
  if (summary.length <= MAX_SUMMARY_CHARS) return summary;
  // Keep the head (what the conversation was about) and the tail (where it had
  // got to). The middle of a long thread is the most recoverable part, because
  // whatever it produced is in the workspace.
  const half = Math.floor((MAX_SUMMARY_CHARS - 40) / 2);
  return `${summary.slice(0, half)}\n…\n${summary.slice(-half)}`;
}

/**
 * The messages to send: folded turns collapsed into one summary in their place.
 *
 * The summary is injected at the position the first folded message occupied, so
 * the model reads it in chronological order rather than as a preamble detached
 * from where it belongs.
 *
 * `stored` is a model-written summary, used **only** when its fingerprint still
 * matches the current fold. A summary of a different set of turns is worse than
 * no summary: it reads as authoritative while describing a conversation that has
 * since moved, and there is no way for the model to tell. Mismatched, absent or
 * empty, this falls back to the derived excerpt, which is always available
 * because it is computed from the messages in hand.
 */
export function applyFold(messages: ChatMessage[], stored?: FoldSummary | null): ChatMessage[] {
  const fresh = stored?.text.trim() && stored.fingerprint === foldFingerprint(messages);
  const summary = fresh ? stored!.text.trim() : foldedSummary(messages);
  if (!summary) return messages;

  const out: ChatMessage[] = [];
  let injected = false;
  for (const m of messages) {
    if (m.folded) {
      if (!injected) {
        out.push({
          id: `${m.id}-fold`,
          role: "user",
          content: summary,
          createdAt: m.createdAt,
        });
        injected = true;
      }
      continue;
    }
    out.push(m);
  }
  return out;
}

/**
 * Ancestors of a message, so branching from a folded turn can unfold what it
 * depends on.
 *
 * Editing a folded message creates a branch from a point the model can no
 * longer see, which would produce an answer to a question whose context had
 * been summarised away. Unfolding the line back to the root is cheap and makes
 * the branch behave like any other.
 */
export function ancestorsOf(messages: ChatMessage[], id: string): string[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const out: string[] = [];
  // Cycle guard, for the same reason `activePath` in tree.ts carries one: parent
  // links come from persisted data, and a corrupted import that points a message
  // at itself would otherwise spin here until the tab dies.
  const seen = new Set<string>();
  let cur = byId.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur.id);
    const parentId = cur.parentId;
    cur = parentId ? byId.get(parentId) : undefined;
  }
  return out;
}
