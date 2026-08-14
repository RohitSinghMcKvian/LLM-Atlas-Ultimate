import { ARTIFACTS, ARTIFACT_STORAGE, ARTIFACT_VERSIONS, BY_ARTIFACT, BY_CONVERSATION } from "./idb";
import { subscribeIncognito } from "./incognito";

/**
 * Incognito enforcement for artifacts (§4.7, "incognito writes nothing").
 *
 * This was missing. `lib/chat/incognito.ts` names the artifact repo as one of
 * the layers that must consult the gate, and `lib/chat/repo-private.ts` blocks
 * every conversation and message write — but the artifact repo talked to
 * IndexedDB directly. So a build made in a temporary chat wrote its records, its
 * whole version history and everything the page saved through `window.storage`
 * straight to disk, attached to a conversation that only ever existed in memory.
 * Closing the tab erased the transcript and left the artifacts behind, orphaned:
 * nothing lists them, nothing can reach them, and nothing ever deletes them.
 *
 * Why an overlay rather than a `readOnly` wrapper like the chat repo's.
 *
 * Dropping artifact writes outright would break the feature inside incognito
 * rather than merely stop persisting it: the panel reads versions back out of
 * storage, so a build whose writes go nowhere shows nothing, and the `artifact`
 * tool's patches would silently fail to apply. The chat repo can get away with
 * dropping writes because zustand already holds the conversation in memory —
 * artifacts have no such in-memory copy.
 *
 * So writes land in memory and reads check memory before disk. Within the
 * session a build behaves exactly as it always did; nothing reaches IndexedDB;
 * closing the tab erases it with the conversation it belonged to.
 *
 * Reads still fall through to disk, matching the rule the chat repo already
 * sets: entering incognito hides nothing that is already saved, so an older
 * conversation opened in a temporary session still shows its artifact and its
 * history.
 */

/** The minimum surface `artifact-repo.ts` needs from a backing store. */
export interface ArtifactStoreDriver {
  get<T>(store: string, key: IDBValidKey): Promise<T | undefined>;
  allByIndex<T>(store: string, index: string, key: IDBValidKey): Promise<T[]>;
  /** Every row of a store. Only the sweep needs this — see artifact-gc.ts. */
  all<T>(store: string): Promise<T[]>;
  put(store: string, value: unknown): Promise<void>;
  del(store: string, key: IDBValidKey): Promise<void>;
}

/**
 * How each artifact store is keyed and indexed.
 *
 * The memory layer has to answer the same lookups IndexedDB does, and IndexedDB
 * derives both the primary key and the index key from the record itself. Rather
 * than re-deriving that from the schema at runtime, the three stores this module
 * covers are described once, here, next to the code that reads them.
 */
const SHAPES: Record<string, { key: (row: any) => IDBValidKey; indexes: Record<string, string> }> = {
  [ARTIFACTS]: {
    key: (r) => r.id,
    indexes: { [BY_CONVERSATION]: "conversationId" },
  },
  [ARTIFACT_VERSIONS]: {
    key: (r) => r.id,
    indexes: { [BY_ARTIFACT]: "artifactId" },
  },
  [ARTIFACT_STORAGE]: {
    key: (r) => [r.artifactId, r.key],
    indexes: { [BY_ARTIFACT]: "artifactId" },
  },
};

/**
 * A stable string for a key that may be an array.
 *
 * `artifact_storage` is keyed by `[artifactId, key]`, and a Map keyed by the
 * array itself would miss every lookup — two arrays with the same contents are
 * different objects. JSON is enough because both components are strings.
 */
function keyId(key: IDBValidKey): string {
  return JSON.stringify(key);
}

/**
 * Rows written this session, plus the keys deleted from it.
 *
 * Tombstones are separate from the row map because a delete has to be visible
 * over a row that exists on disk — `storage.delete(k)` on an older artifact must
 * read as gone for the rest of the session without touching IndexedDB.
 */
interface Overlay {
  rows: Map<string, Map<string, unknown>>;
  gone: Map<string, Set<string>>;
}

function emptyOverlay(): Overlay {
  return { rows: new Map(), gone: new Map() };
}

let overlay = emptyOverlay();

/**
 * Discard everything written during incognito when incognito ends.
 *
 * Without this the memory layer would outlive the mode: leaving and re-entering
 * incognito later in the same session would resurrect the earlier temporary
 * build and shadow whatever is genuinely on disk at those ids. Only the exit
 * edge clears — entering must not disturb a session already in progress.
 */
function onModeChange(active: boolean): void {
  if (!active) overlay = emptyOverlay();
}

/**
 * Subscribe, idempotently.
 *
 * Called on every store resolution rather than once at import, because
 * `resetIncognito()` clears the whole listener set — so a subscription taken at
 * module load survives exactly until the first reset, and after that the exit
 * edge would pass unnoticed and a temporary build would outlive its mode. The
 * listener set is keyed by function identity, so re-adding the same reference
 * costs nothing and repairs that.
 */
export function armArtifactOverlay(): void {
  subscribeIncognito(onModeChange);
}

/** Test seam, and the hook for a session reset. */
export function resetArtifactOverlay(): void {
  overlay = emptyOverlay();
}

function bucket<T>(map: Map<string, Map<string, T>>, store: string): Map<string, T> {
  let b = map.get(store);
  if (!b) {
    b = new Map();
    map.set(store, b);
  }
  return b;
}

function tombstones(store: string): Set<string> {
  let t = overlay.gone.get(store);
  if (!t) {
    t = new Set();
    overlay.gone.set(store, t);
  }
  return t;
}

/**
 * Memory over `base`: writes stay in memory, reads prefer it, deletes tombstone.
 *
 * Applied per call rather than baked in, so the mode can be toggled mid-session
 * — the same split `workspaceRepo()` makes between the cached driver choice and
 * the write policy.
 */
export function privateArtifactStore(base: ArtifactStoreDriver): ArtifactStoreDriver {
  return {
    async get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
      const id = keyId(key);
      if (tombstones(store).has(id)) return undefined;
      const local = bucket(overlay.rows, store).get(id);
      if (local !== undefined) return local as T;
      return base.get<T>(store, key);
    },

    /**
     * The union of what is on disk and what this session wrote.
     *
     * A session row replaces the stored one at the same primary key rather than
     * appearing beside it, which is what makes an edit to an *existing*
     * artifact behave normally inside incognito: the new version is added, and
     * the record's updated `currentVersion` supersedes the stored row instead of
     * producing two rows the caller has to disambiguate.
     */
    async allByIndex<T>(store: string, index: string, key: IDBValidKey): Promise<T[]> {
      const shape = SHAPES[store];
      const field = shape?.indexes[index];
      const stored = await base.allByIndex<T>(store, index, key);
      const dead = tombstones(store);
      const merged = new Map<string, T>();
      for (const row of stored) {
        const id = keyId(shape.key(row));
        if (!dead.has(id)) merged.set(id, row);
      }
      for (const [id, row] of bucket(overlay.rows, store)) {
        if (dead.has(id)) continue;
        if (field && (row as any)?.[field] !== key) continue;
        merged.set(id, row as T);
      }
      return [...merged.values()];
    },

    async all<T>(store: string): Promise<T[]> {
      const shape = SHAPES[store];
      const dead = tombstones(store);
      const merged = new Map<string, T>();
      for (const row of await base.all<T>(store)) {
        const id = keyId(shape.key(row));
        if (!dead.has(id)) merged.set(id, row);
      }
      for (const [id, row] of bucket(overlay.rows, store)) {
        if (!dead.has(id)) merged.set(id, row as T);
      }
      return [...merged.values()];
    },

    async put(store: string, value: unknown): Promise<void> {
      const shape = SHAPES[store];
      if (!shape) return;
      const id = keyId(shape.key(value));
      tombstones(store).delete(id);
      bucket(overlay.rows, store).set(id, value);
    },

    async del(store: string, key: IDBValidKey): Promise<void> {
      const id = keyId(key);
      bucket(overlay.rows, store).delete(id);
      tombstones(store).add(id);
    },
  };
}
