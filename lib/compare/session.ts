// A comparison session: the conversation a run belongs to.
//
// Until now `CompareRun` was the whole unit — one question, six lanes, done.
// Asking a follow-up meant starting from nothing: new run, new evidence, models
// with no memory of what they had just said. A session is the missing container:
// an ordered list of turns against one lane set, with one evidence pack, one
// title, and one decision about whether any of it is written down.
//
// Pure. The runtime owns the live session; storage owns the saved one; this
// module owns the rules that govern both, so they cannot disagree.

import type { CompareRun, Depth } from "./types";

export interface CompareSession {
  id: string;
  /** The first question, truncated. Renameable. */
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  /**
   * Chosen when the session is created and never flipped.
   *
   * Deliberately unlike `lib/chat/incognito.ts`, where the mode is global and
   * can be toggled mid-conversation. A per-session choice cannot leak by being
   * forgotten, and it removes the question of what happens to the half of a
   * session that was already on disk when the switch was thrown.
   */
  incognito: boolean;
  /** The lane set. May change between turns; a lane added late has no history. */
  modelIds: string[];
  depth: Depth;
  web?: boolean;
  /** Run ids in turn order. */
  turnIds: string[];
  /** Set when this session was forked from another. */
  forkedFrom?: { sessionId: string; turnIndex: number };
}

/**
 * A session's title, from its first question.
 *
 * Copied from `chat-store.ts`'s `titleFrom`, including the 48-character cut, so
 * the two history rails truncate identically. Atlas has never generated titles
 * with a model — the truncation is the whole feature — and this does not add
 * one: a title is worth about a tenth of a cent of nobody's money.
 */
export function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return "New comparison";
  return t.length > 48 ? `${t.slice(0, 48)}…` : t;
}

let counter = 0;

/** Ids are prefixed so a stray one is identifiable in a storage dump. */
export function sessionId(): string {
  counter += 1;
  return `cs_${Date.now().toString(36)}_${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function runId(): string {
  counter += 1;
  return `cr_${Date.now().toString(36)}_${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export interface NewSessionInput {
  question: string;
  modelIds: string[];
  depth: Depth;
  incognito?: boolean;
  web?: boolean;
  now?: number;
}

export function newSession(input: NewSessionInput): CompareSession {
  const now = input.now ?? Date.now();
  return {
    id: sessionId(),
    title: titleFrom(input.question),
    createdAt: now,
    updatedAt: now,
    incognito: input.incognito ?? false,
    modelIds: [...input.modelIds],
    depth: input.depth,
    web: input.web,
    turnIds: [],
  };
}

/**
 * Record a turn on a session.
 *
 * Idempotent: re-appending a run already in the list is a no-op rather than a
 * duplicate, because the runtime checkpoints the same turn more than once and a
 * duplicated id would make `turnIndexOf` ambiguous.
 */
export function appendTurn(
  session: CompareSession,
  id: string,
  now: number = Date.now(),
): CompareSession {
  if (session.turnIds.includes(id)) return { ...session, updatedAt: now };
  return { ...session, turnIds: [...session.turnIds, id], updatedAt: now };
}

export function turnIndexOf(session: CompareSession, id: string): number {
  return session.turnIds.indexOf(id);
}

/** Runs in turn order, skipping ids the store no longer has. */
export function orderedTurns(session: CompareSession, runs: CompareRun[]): CompareRun[] {
  const byId = new Map(runs.map((r) => [r.id, r]));
  return session.turnIds.map((id) => byId.get(id)).filter((r): r is CompareRun => Boolean(r));
}

/**
 * Change the lane set mid-session.
 *
 * The session's own list is what a new turn is planned from, so this is all it
 * takes. Which turn a lane joined at is *derived* from the runs rather than
 * stored here — see `laneJoinedAt` in `./thread` — because storing it twice is
 * how the two get to disagree.
 */
export function setLanes(
  session: CompareSession,
  modelIds: string[],
  now: number = Date.now(),
): CompareSession {
  return { ...session, modelIds: [...modelIds], updatedAt: now };
}

export function renameSession(
  session: CompareSession,
  title: string,
  now: number = Date.now(),
): CompareSession {
  const next = title.trim();
  return { ...session, title: next || "Untitled", updatedAt: now };
}

export function togglePinned(session: CompareSession, now: number = Date.now()): CompareSession {
  return { ...session, pinned: !session.pinned, updatedAt: now };
}

export interface ForkResult {
  session: CompareSession;
  /** Copies of the turns up to and including `turnIndex`, with fresh ids. */
  runs: CompareRun[];
}

/**
 * Branch a new session from an existing turn.
 *
 * Copies the prefix rather than sharing it, mirroring `chat-store.forkConversation`.
 * Sharing would mean editing one session mutated the other's history, and the
 * whole point of a fork is to change what happens next without disturbing what
 * already did.
 *
 * The forked session inherits `incognito`: a fork of a temporary session must
 * not become the durable copy the user declined to make.
 */
export function forkSession(
  session: CompareSession,
  runs: CompareRun[],
  turnIndex: number,
  now: number = Date.now(),
): ForkResult | null {
  const turns = orderedTurns(session, runs);
  if (turnIndex < 0 || turnIndex >= turns.length) return null;

  const id = sessionId();
  const copied: CompareRun[] = turns.slice(0, turnIndex + 1).map((run, i) => ({
    ...run,
    id: runId(),
    sessionId: id,
    turnIndex: i,
  }));

  return {
    session: {
      ...session,
      id,
      title: `${session.title} (fork)`,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      turnIds: copied.map((r) => r.id),
      forkedFrom: { sessionId: session.id, turnIndex },
    },
    runs: copied,
  };
}

/**
 * The evidence pack a follow-up inherits.
 *
 * The first turn that gathered anything wins, and every later turn reuses it —
 * which is what keeps citation numbers meaning the same thing for the life of a
 * session. A turn that ran `refreshedEvidence` replaces it from that point on.
 */
export function inheritedEvidence(runs: CompareRun[]): CompareRun["evidence"] | undefined {
  let pack: CompareRun["evidence"] | undefined;
  for (const run of runs) {
    if (!run.evidence) continue;
    const empty = run.evidence.sources.length === 0 && run.evidence.documents.length === 0;
    if (empty) continue;
    if (!pack || run.refreshedEvidence) pack = run.evidence;
  }
  return pack;
}

/** One line for the history rail's second row. */
export function describeSession(session: CompareSession, laneCount?: number): string {
  const turns = session.turnIds.length;
  const parts = [`${turns} turn${turns === 1 ? "" : "s"}`];
  const lanes = laneCount ?? session.modelIds.length;
  if (lanes) parts.push(`${lanes} model${lanes === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
