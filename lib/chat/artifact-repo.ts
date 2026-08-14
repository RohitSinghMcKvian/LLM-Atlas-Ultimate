"use client";

import {
  ARTIFACTS,
  ARTIFACT_STORAGE,
  ARTIFACT_VERSIONS,
  BY_ARTIFACT,
  BY_CONVERSATION,
  del,
  get,
  getAll,
  getAllByIndex,
  idbAvailable,
  openChatDb,
  put,
} from "./idb";
import { uuid } from "./types";
import type { ArtifactType } from "./artifact-sandbox";
import { isIncognito } from "./incognito";
import {
  armArtifactOverlay,
  privateArtifactStore,
  resetArtifactOverlay,
  type ArtifactStoreDriver,
} from "./artifact-private";

/**
 * Persistence for artifacts, their version history, and the key/value store
 * backing `window.storage` (spec §4).
 *
 * Before this, artifacts were re-derived from message text on every render:
 * they had no identity, so nothing could be attached to them — no stable
 * storage key, no publish target, and no revert beyond scrolling the scrubber.
 *
 * Identity model: one artifact per (conversation, path).
 *
 * It used to be one artifact per conversation full stop, which meant a second
 * deliverable became *version N+1 of the first*. A landing page plus its
 * stylesheet, a four-screen app, or a report alongside a deck were all
 * structurally impossible — the panel could only ever show one evolving
 * document. Paths fix that without disturbing versioning: each path keeps its
 * own immutable history.
 *
 * Conversations that predate this have artifacts with no path. They are read as
 * `DEFAULT_PATH` and, crucially, **keep their existing id** — `artifact_storage`
 * is keyed by artifact id, so re-identifying them would orphan whatever
 * `window.storage` data the page had written.
 *
 * Versions are immutable. "Revert to v1" does not delete v2 — it moves the
 * `currentVersion` pointer, so the later work is still recoverable.
 */

/**
 * What an artifact with no explicit path is called.
 *
 * Every pre-existing artifact, and every new one the model writes without a
 * `path=` attribute, lands here — so the common single-file case still behaves
 * as one document with one history.
 */
export const DEFAULT_PATH = "index.html";

export interface ArtifactRecord {
  id: string;
  conversationId: string;
  /** Optional in storage for records written before paths existed. */
  path?: string;
  kind: ArtifactType;
  title: string;
  currentVersion: number;
  /**
   * When the file was removed from the build (§P15). Set means "gone" to every
   * listing; the record, its versions and its `window.storage` rows all stay.
   *
   * A soft delete because this module's whole contract is that versions are
   * immutable — "revert to v1" moves a pointer rather than destroying v2. A
   * hard delete would make the model the one actor that can throw away work the
   * user never agreed to lose, which is a strange power to hand it in a build
   * it is iterating on. Re-creating the same path revives this record instead
   * of minting a new id, so the file's history and its saved storage survive a
   * delete-then-recreate round trip.
   */
  deletedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** A record's path, with the pre-multi-file default applied. */
export function pathOf(rec: ArtifactRecord): string {
  return rec.path || DEFAULT_PATH;
}

export interface ArtifactVersionRecord {
  id: string;
  artifactId: string;
  versionNumber: number;
  /** Assistant message that produced this version, when known. */
  messageId?: string;
  kind: ArtifactType;
  lang: string;
  title: string;
  code: string;
  createdAt: number;
}

export interface ArtifactStorageRow {
  artifactId: string;
  key: string;
  value: unknown;
  /** Reserved for cross-artifact sharing; always false for now. */
  shared: boolean;
  updatedAt: number;
}

// Memoized: every helper below calls db(), and opening a fresh IDBDatabase per
// operation would leak a connection each time (nothing closes them) and block
// any later version upgrade. A rejection is not cached, so a transient failure
// doesn't disable artifacts for the rest of the session.
let dbPromise: Promise<IDBDatabase> | null = null;

async function db(): Promise<IDBDatabase | null> {
  if (!idbAvailable()) return null;
  if (!dbPromise) {
    dbPromise = openChatDb();
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  try {
    return await dbPromise;
  } catch {
    return null;
  }
}

/** Test seam: drop the cached connection so a fresh IDBFactory is picked up. */
export function resetArtifactDb(): void {
  dbPromise = null;
  resetArtifactOverlay();
}

function idbDriver(d: IDBDatabase): ArtifactStoreDriver {
  return {
    get: (store, key) => get(d, store, key),
    allByIndex: (store, index, key) => getAllByIndex(d, store, index, key),
    all: (store) => getAll(d, store),
    put: (store, value) => put(d, store, value),
    del: (store, key) => del(d, store, key),
  };
}

/**
 * A store with nothing in it, for incognito in a browser that has no IndexedDB.
 *
 * Without it those two conditions together would disable artifacts entirely,
 * which is backwards: a session that is already refusing to persist has no need
 * of a database, and users who turn on incognito are exactly the users whose
 * browser is most likely to have blocked storage in the first place.
 */
const NO_STORE: ArtifactStoreDriver = {
  async get() {
    return undefined;
  },
  async allByIndex() {
    return [];
  },
  async all() {
    return [];
  },
  async put() {},
  async del() {},
};

/**
 * The backing store for every function below.
 *
 * The incognito wrap is decided per call rather than cached with the connection,
 * so toggling the mode takes effect on the next write instead of on the next
 * reload — the same split `workspaceRepo()` makes.
 *
 * Exported for `artifact-remix.ts` alone, which has to write records and version
 * rows verbatim — same version numbers, same timestamps — and so cannot go
 * through `recordVersion`. Exporting it rather than moving the copier in here
 * keeps this module about one build; nothing else should reach for it.
 */
export async function artifactStore(): Promise<ArtifactStoreDriver | null> {
  armArtifactOverlay();
  const d = await db();
  if (isIncognito()) return privateArtifactStore(d ? idbDriver(d) : NO_STORE);
  return d ? idbDriver(d) : null;
}

/**
 * Every artifact in a conversation, oldest first so the entry file leads.
 *
 * Deleted files are excluded. `includeDeleted` exists for the two callers that
 * need the raw set — reviving a path, and refusing to rename onto one — and for
 * nothing else: a listing that silently contained removed files would put them
 * back in the panel and in the model's context.
 */
export async function listArtifactsForConversation(
  conversationId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<ArtifactRecord[]> {
  const s = await artifactStore();
  if (!s) return [];
  const rows = await s.allByIndex<ArtifactRecord>(ARTIFACTS, BY_CONVERSATION, conversationId);
  return rows
    .filter((r) => options.includeDeleted || r.deletedAt == null)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** One artifact by path, applying the pre-multi-file default. */
export async function getArtifactByPath(
  conversationId: string,
  path: string = DEFAULT_PATH,
  options: { includeDeleted?: boolean } = {},
): Promise<ArtifactRecord | null> {
  const rows = await listArtifactsForConversation(conversationId, options);
  return rows.find((r) => pathOf(r) === path) ?? null;
}

/**
 * The conversation's primary artifact, or null.
 *
 * Kept because most callers want "the thing to show first" rather than a
 * specific file, and because it preserves the old behaviour exactly for the
 * single-artifact conversations that are still the common case.
 */
export async function getArtifactForConversation(
  conversationId: string,
): Promise<ArtifactRecord | null> {
  const rows = await listArtifactsForConversation(conversationId);
  return rows[0] ?? null;
}

export async function listVersions(artifactId: string): Promise<ArtifactVersionRecord[]> {
  const s = await artifactStore();
  if (!s) return [];
  const rows = await s.allByIndex<ArtifactVersionRecord>(
    ARTIFACT_VERSIONS,
    BY_ARTIFACT,
    artifactId,
  );
  return rows.sort((a, b) => a.versionNumber - b.versionNumber);
}

/**
 * Record a version, creating the conversation's artifact on first sight.
 *
 * Idempotent in two ways, both of which matter because this is called from the
 * message-persist path that can re-run for the same turn:
 *  - Re-recording the same `messageId` updates that version in place rather
 *    than appending a duplicate (a regenerated turn edits its own version).
 *  - Identical code with no messageId is ignored, so a re-render can't inflate
 *    the history.
 */
export async function recordVersion(input: {
  conversationId: string;
  messageId?: string;
  /** Which file this is. Omitted means the conversation's default document. */
  path?: string;
  kind: ArtifactType;
  lang: string;
  title: string;
  code: string;
}): Promise<ArtifactVersionRecord | null> {
  const s = await artifactStore();
  if (!s) return null;
  const now = Date.now();
  const path = input.path || DEFAULT_PATH;

  // Deleted records are in scope here on purpose: writing to a path that was
  // removed revives that record rather than starting a second one at the same
  // path, which would leave two rows the listing has to disambiguate and orphan
  // whatever `window.storage` the first one held.
  let artifact = await getArtifactByPath(input.conversationId, path, { includeDeleted: true });
  if (!artifact) {
    artifact = {
      id: uuid(),
      conversationId: input.conversationId,
      path,
      kind: input.kind,
      title: input.title,
      currentVersion: 0,
      createdAt: now,
      updatedAt: now,
    };
    await s.put(ARTIFACTS, artifact);
  } else if (artifact.deletedAt != null) {
    const { deletedAt: _gone, ...revived } = artifact;
    artifact = { ...revived, path, updatedAt: now };
    await s.put(ARTIFACTS, artifact);
  } else if (!artifact.path) {
    // Lazy backfill (R4/R9). The id is deliberately preserved: `artifact_storage`
    // is keyed by it, so minting a new one here would orphan whatever the page
    // had saved through `window.storage`.
    artifact = { ...artifact, path };
    await s.put(ARTIFACTS, artifact);
  }

  const existing = await listVersions(artifact.id);

  if (input.messageId) {
    const sameTurn = existing.find((v) => v.messageId === input.messageId);
    if (sameTurn) {
      if (sameTurn.code === input.code) return sameTurn;
      const updated: ArtifactVersionRecord = {
        ...sameTurn,
        kind: input.kind,
        lang: input.lang,
        title: input.title,
        code: input.code,
      };
      await s.put(ARTIFACT_VERSIONS, updated);
      return updated;
    }
  }

  const last = existing[existing.length - 1];
  if (last && last.code === input.code) return last;

  const version: ArtifactVersionRecord = {
    id: uuid(),
    artifactId: artifact.id,
    versionNumber: (last?.versionNumber ?? 0) + 1,
    messageId: input.messageId,
    kind: input.kind,
    lang: input.lang,
    title: input.title,
    code: input.code,
    createdAt: now,
  };
  await s.put(ARTIFACT_VERSIONS, version);
  await s.put(ARTIFACTS, {
    ...artifact,
    path,
    kind: input.kind,
    title: input.title,
    currentVersion: version.versionNumber,
    updatedAt: now,
  });
  return version;
}

/** Point the artifact at an earlier version. Later versions are kept. */
export async function revertToVersion(
  artifactId: string,
  versionNumber: number,
): Promise<ArtifactRecord | null> {
  const s = await artifactStore();
  if (!s) return null;
  const artifact = await s.get<ArtifactRecord>(ARTIFACTS, artifactId);
  if (!artifact) return null;
  const versions = await listVersions(artifactId);
  if (!versions.some((v) => v.versionNumber === versionNumber)) return artifact;
  const updated = { ...artifact, currentVersion: versionNumber, updatedAt: Date.now() };
  await s.put(ARTIFACTS, updated);
  return updated;
}

/**
 * Outcome of a delete or rename, in the vocabulary the tool reports (§P15).
 *
 * A discriminated result rather than a thrown error: every one of these is a
 * thing the model can reasonably get wrong mid-build, and each needs its own
 * sentence back so the next attempt is better informed.
 */
export type ArtifactMoveResult =
  | { ok: true; record: ArtifactRecord }
  | { ok: false; reason: "missing" | "occupied" | "last-file" | "unavailable" };

/**
 * Remove a file from the build, keeping everything about it.
 *
 * Refuses the last remaining file: a build with no files is not a state any
 * caller has a use for, and it would leave the panel with nothing to show and
 * the model with nothing to patch.
 */
export async function softDeleteArtifact(
  conversationId: string,
  path: string,
): Promise<ArtifactMoveResult> {
  const s = await artifactStore();
  if (!s) return { ok: false, reason: "unavailable" };
  const live = await listArtifactsForConversation(conversationId);
  const target = live.find((r) => pathOf(r) === path);
  if (!target) return { ok: false, reason: "missing" };
  if (live.length <= 1) return { ok: false, reason: "last-file" };
  const updated = { ...target, deletedAt: Date.now(), updatedAt: Date.now() };
  await s.put(ARTIFACTS, updated);
  return { ok: true, record: updated };
}

/**
 * Move a file to another path, keeping its id.
 *
 * Keeping the id is the point: `artifact_storage` is keyed by it, and so is
 * every version row. A rename implemented as create-plus-delete would silently
 * drop the file's history and whatever the page had saved through
 * `window.storage`.
 *
 * A deleted record still occupies its path here. Reviving it by rename would be
 * a second, less obvious way to undelete, and the model has a direct one: write
 * to the path.
 */
export async function renameArtifact(
  conversationId: string,
  from: string,
  to: string,
): Promise<ArtifactMoveResult> {
  const s = await artifactStore();
  if (!s) return { ok: false, reason: "unavailable" };
  if (from === to) {
    const same = await getArtifactByPath(conversationId, from);
    return same ? { ok: true, record: same } : { ok: false, reason: "missing" };
  }
  const all = await listArtifactsForConversation(conversationId, { includeDeleted: true });
  const target = all.find((r) => pathOf(r) === from && r.deletedAt == null);
  if (!target) return { ok: false, reason: "missing" };
  if (all.some((r) => pathOf(r) === to)) return { ok: false, reason: "occupied" };
  const updated = { ...target, path: to, updatedAt: Date.now() };
  await s.put(ARTIFACTS, updated);
  return { ok: true, record: updated };
}

// ── window.storage backend ──────────────────────────────────────────────────

export async function storageGet(artifactId: string, key: string): Promise<unknown> {
  const s = await artifactStore();
  if (!s) return undefined;
  const row = await s.get<ArtifactStorageRow>(ARTIFACT_STORAGE, [artifactId, key]);
  return row?.value;
}

export async function storageSet(
  artifactId: string,
  key: string,
  value: unknown,
): Promise<void> {
  const s = await artifactStore();
  if (!s) return;
  await s.put(ARTIFACT_STORAGE, {
    artifactId,
    key,
    value,
    shared: false,
    updatedAt: Date.now(),
  } satisfies ArtifactStorageRow);
}

export async function storageDelete(artifactId: string, key: string): Promise<void> {
  const s = await artifactStore();
  if (!s) return;
  await s.del(ARTIFACT_STORAGE, [artifactId, key]);
}

/** Keys for an artifact, optionally filtered by prefix. Sorted for stability. */
export async function storageList(artifactId: string, prefix?: string): Promise<string[]> {
  const s = await artifactStore();
  if (!s) return [];
  const rows = await s.allByIndex<ArtifactStorageRow>(ARTIFACT_STORAGE, BY_ARTIFACT, artifactId);
  return rows
    .map((r) => r.key)
    .filter((k) => (prefix ? k.startsWith(prefix) : true))
    .sort();
}
