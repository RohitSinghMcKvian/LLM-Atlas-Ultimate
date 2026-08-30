// Durable storage for comparison sessions, their turns and their lanes.
//
// This is what makes a run survive the page, and now what makes a *session*
// survive it. Three stores, because their write rates differ by orders of
// magnitude: a lane is checkpointed every few seconds while six of them stream,
// a run header settles once per stage, and a session header changes when it is
// renamed. Keeping them apart means a lane 40 kB into an answer never forces the
// session title to be re-serialized alongside it.
//
// The interface exists for one reason beyond tidiness: `ephemeralCompareRepo`
// is an explicit object literal, so a write method added later that nobody
// remembered to block is a **type error** rather than a silent leak. That is the
// same property `lib/chat/repo-private.ts` relies on, and it is the whole
// argument for a seam over an `if (incognito) return` at each call site.

"use client";

import {
  BY_RUN,
  BY_SESSION,
  COMPARE_LANES,
  COMPARE_RUNS,
  COMPARE_SESSIONS,
  del,
  deleteByIndex,
  get,
  getAll,
  getAllByIndex,
  idbAvailable,
  openChatDb,
  put,
  putMany,
} from "@/lib/chat/idb";
import type { CompareSession } from "./session";
import { emptyStages, type CompareRun, type LaneState } from "./types";

/** The run header, without its lanes — those live in their own store. */
type RunRecord = Omit<CompareRun, "lanes">;

/** A lane plus the foreign key its index is built on. */
type LaneRecord = LaneState & { runId: string };

export interface CompareRepo {
  /** Sessions newest first. Headers only — turns are loaded on demand. */
  listSessions(limit?: number): Promise<CompareSession[]>;
  loadSession(id: string): Promise<{ session: CompareSession; runs: CompareRun[] } | undefined>;
  saveSession(session: CompareSession): Promise<void>;
  /** Takes the session's runs and their lanes with it, in one transaction. */
  deleteSession(id: string): Promise<void>;
  saveRun(run: CompareRun): Promise<void>;
  /** The header alone. Cheap, and cannot disturb a streaming lane. */
  saveRunHeader(run: CompareRun): Promise<void>;
  saveLane(runId: string, lane: LaneState): Promise<void>;
  saveLanes(runId: string, lanes: LaneState[]): Promise<void>;
  loadRun(id: string): Promise<CompareRun | undefined>;
  deleteRun(id: string): Promise<void>;
  pruneSessions(maxAgeMs?: number, now?: number): Promise<number>;
}

/**
 * Memoized connection, dropped on failure so the next call reopens.
 *
 * The drop matters during a version upgrade: `openChatDb` closes this connection
 * on `versionchange`, and holding a stale handle would fail every subsequent
 * write silently.
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

export function resetCompareRepo(): void {
  dbPromise = null;
}

export function compareStorageAvailable(): boolean {
  return idbAvailable();
}

function split(run: CompareRun): { header: RunRecord; lanes: LaneRecord[] } {
  const { lanes, ...header } = run;
  return { header, lanes: lanes.map((l) => ({ ...l, runId: run.id })) };
}

/**
 * Rebuild a run from its two records.
 *
 * Lanes are restored to band order — IndexedDB returns index matches in key
 * order, so without this a run would come back with its columns shuffled and its
 * colours reassigned. `stages` is defaulted because a record written by an older
 * build may not have every stage, and a missing stage must read as `pending` so
 * resume re-runs it rather than skipping it.
 */
function hydrate(header: RunRecord, laneRecords: LaneRecord[]): CompareRun {
  const lanes = laneRecords
    .map(({ runId: _runId, ...lane }) => lane)
    .sort((a, b) => a.band - b.band);
  return {
    ...header,
    stages: { ...emptyStages(), ...(header.stages ?? {}) },
    lanes,
  };
}

const idbRepo: CompareRepo = {
  async listSessions(limit = 50) {
    const conn = await db();
    const all = await getAll<CompareSession>(conn, COMPARE_SESSIONS);
    return all
      .sort((a, b) => {
        // Pinned first, then most recently touched — the order the rail renders
        // in before `groupByRecency` re-buckets it.
        if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      })
      .slice(0, limit);
  },

  async loadSession(id) {
    const conn = await db();
    const session = await get<CompareSession>(conn, COMPARE_SESSIONS, id);
    if (!session) return undefined;

    const headers = await getAllByIndex<RunRecord>(conn, COMPARE_RUNS, BY_SESSION, id);
    const runs: CompareRun[] = [];
    for (const header of headers) {
      const lanes = await getAllByIndex<LaneRecord>(conn, COMPARE_LANES, BY_RUN, header.id);
      runs.push(hydrate(header, lanes));
    }
    return { session, runs };
  },

  async saveSession(session) {
    const conn = await db();
    await put(conn, COMPARE_SESSIONS, session);
  },

  async deleteSession(id) {
    const conn = await db();
    const headers = await getAllByIndex<RunRecord>(conn, COMPARE_RUNS, BY_SESSION, id);
    // Lanes first: an interrupted delete that left lane rows behind would leak
    // the answers, which is the opposite of what deleting a session is for.
    for (const header of headers) {
      await deleteByIndex(conn, COMPARE_LANES, BY_RUN, header.id);
      await del(conn, COMPARE_RUNS, header.id);
    }
    await del(conn, COMPARE_SESSIONS, id);
  },

  async saveRun(run) {
    const conn = await db();
    const { header, lanes } = split({ ...run, updatedAt: Date.now() });
    await put(conn, COMPARE_RUNS, header);
    await putMany(conn, COMPARE_LANES, lanes);
  },

  async saveRunHeader(run) {
    const conn = await db();
    const { header } = split({ ...run, updatedAt: Date.now() });
    await put(conn, COMPARE_RUNS, header);
  },

  async saveLane(runId, lane) {
    const conn = await db();
    await put(conn, COMPARE_LANES, { ...lane, runId });
  },

  async saveLanes(runId, lanes) {
    if (lanes.length === 0) return;
    const conn = await db();
    await putMany(
      conn,
      COMPARE_LANES,
      lanes.map((l) => ({ ...l, runId })),
    );
  },

  async loadRun(id) {
    const conn = await db();
    const header = await get<RunRecord>(conn, COMPARE_RUNS, id);
    if (!header) return undefined;
    const lanes = await getAllByIndex<LaneRecord>(conn, COMPARE_LANES, BY_RUN, id);
    return hydrate(header, lanes);
  },

  async deleteRun(id) {
    const conn = await db();
    await deleteByIndex(conn, COMPARE_LANES, BY_RUN, id);
    await del(conn, COMPARE_RUNS, id);
  },

  async pruneSessions(maxAgeMs = SESSION_RETENTION_MS, now = Date.now()) {
    const conn = await db();
    const all = await getAll<CompareSession>(conn, COMPARE_SESSIONS);
    // Pinned sessions are kept regardless of age: pinning is the user saying
    // this one matters, and expiring it anyway would make the pin a lie.
    const stale = all.filter((s) => !s.pinned && now - s.updatedAt > maxAgeMs);
    for (const s of stale) await idbRepo.deleteSession(s.id);
    return stale.length;
  },
};

/**
 * A repo that reads but never writes.
 *
 * Used for a temporary session. The live session lives in the runtime
 * singleton's memory, so dropping writes costs the feature nothing — unlike
 * artifacts, which read their own writes back out of storage and needed a
 * rows-and-tombstones overlay instead.
 *
 * Two rules copied deliberately from `lib/chat/repo-private.ts`:
 *
 *   * **Reads pass through unchanged.** Being in a temporary session hides
 *     nothing that is already saved.
 *   * **Deletes are blocked too.** A delete is a durable mutation of saved data,
 *     and a bug that erased history because temporary mode relaxed the rule for
 *     one method is unrecoverable.
 */
export function ephemeralCompareRepo(base: CompareRepo): CompareRepo {
  return {
    listSessions: (limit) => base.listSessions(limit),
    loadSession: (id) => base.loadSession(id),
    loadRun: (id) => base.loadRun(id),
    async saveSession() {
      /* temporary session: dropped */
    },
    async deleteSession() {
      /* temporary session: dropped */
    },
    async saveRun() {
      /* temporary session: dropped */
    },
    async saveRunHeader() {
      /* temporary session: dropped */
    },
    async saveLane() {
      /* temporary session: dropped */
    },
    async saveLanes() {
      /* temporary session: dropped */
    },
    async deleteRun() {
      /* temporary session: dropped */
    },
    async pruneSessions() {
      return 0;
    },
  };
}

/**
 * The repo for a session.
 *
 * The driver is a module constant; the write policy is decided per call. That
 * split is what lets one tab hold a saved session and a temporary one without
 * either leaking into the other — the same arrangement `chatRepo()` uses for its
 * global flag.
 */
export function compareRepo(incognito = false): CompareRepo {
  return incognito ? ephemeralCompareRepo(idbRepo) : idbRepo;
}

/**
 * Sessions are dropped after this long untouched.
 *
 * A session holds every answer from every turn, so the archive grows fast.
 * Swept opportunistically on load rather than on a timer, so a tab that is never
 * opened never sweeps.
 */
export const SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
