// Minimal promise wrapper over IndexedDB for the chat store.
//
// Deliberately not `idb`/`dexie`: the surface actually needed here is six calls,
// and the repo's existing convention is to avoid a dependency for something this
// small (see lib/crypto/secret-box.ts, which does the same).
//
// Why IndexedDB at all (spec §1.5): the localStorage driver keeps every
// conversation in ONE JSON blob under `atlas-chat-v1`, so appending a single
// message re-serializes the entire history and re-writes it synchronously on the
// main thread. That cost grows with the whole archive, not the current thread,
// and localStorage's ~5MB ceiling is a hard cap on how much history can exist.
// Object stores give per-record writes and orders of magnitude more room.

export const DB_NAME = "atlas-chat";
export const DB_VERSION = 12;
export const CONVERSATIONS = "conversations";
export const MESSAGES = "messages";
/** Artifacts and their immutable version history (§4 Artifacts). */
export const ARTIFACTS = "artifacts";
export const ARTIFACT_VERSIONS = "artifact_versions";
/** Key/value store backing `window.storage` inside artifact iframes. */
export const ARTIFACT_STORAGE = "artifact_storage";
/** Chunk + embedding index for project-knowledge retrieval (§4.5 RAG). */
export const PROJECT_CHUNKS = "project_chunks";
/** The `/memories` filesystem, keyed by path (§4.7 memory). */
export const MEMORY_FILES = "memory_files";
/** Chunk + embedding index over past conversations, for past-chat search (§4.7). */
export const CHAT_CHUNKS = "chat_chunks";
/** Installed SKILL.md definitions, keyed by id (§4 Skills). */
export const SKILLS = "skills";
/** MCP connectors, keyed by id. Tokens are stored SEALED (§4 Connectors). */
export const CONNECTORS = "connectors";
/** Installed plugins: bundles of skills and connectors (§4 Plugins). */
export const PLUGINS = "plugins";
/**
 * The `/workspace` filesystem: the files of a build in progress, one set per
 * conversation. Separate from MEMORY_FILES because the lifetimes differ — memory
 * outlives every conversation, a workspace belongs to exactly one.
 */
export const WORKSPACE_FILES = "workspace_files";
/** The task ledger: what the build is doing, and how far it has got. */
export const WORKSPACE_TASKS = "workspace_tasks";
/** One row per conversation holding the build's goal. */
export const WORKSPACE_META = "workspace_meta";
/**
 * Binary deliverables the Python sandbox produced: .xlsx, .docx, .pdf, images.
 *
 * Separate from WORKSPACE_FILES because that store holds `content: string`, and
 * a .xlsx is a zip container — round-tripping it through UTF-8 would produce
 * mojibake that opens in nothing, with the original bytes already gone.
 */
export const BLOB_FILES = "blob_files";
/**
 * One model-written summary per conversation, standing in for its folded turns.
 *
 * Its own store rather than a column on the conversation: it is written by a
 * background job on a different schedule from everything else about a
 * conversation, and a partial write must not be able to touch the title or the
 * model. Keyed by conversation, because there is exactly one live fold.
 */
export const FOLD_SUMMARIES = "fold_summaries";
/**
 * Chunk + embedding index over *this* conversation's folded turns, for
 * `recall_context`.
 *
 * Deliberately not shared with CHAT_CHUNKS. `indexConversation` clears a
 * conversation's rows before writing, so a shared store would have the two
 * indexes destroying each other on every turn — and the staleness keys differ
 * anyway (the fold set changed, versus the thread gained a turn).
 */
export const FOLD_CHUNKS = "fold_chunks";
/**
 * The user's own half of the Atlas knowledge graph (§Graph-RAG).
 *
 * Only the *workspace overlay* lives here — conversations, artifacts, memories
 * and the like. The catalog and news halves are derived from the shipped
 * snapshot on load and deliberately never stored: they are a pure function of a
 * version hash the app already tracks, so persisting them would buy a few
 * milliseconds and cost a whole class of staleness bugs.
 */
export const GRAPH_NODES = "graph_nodes";
export const GRAPH_EDGES = "graph_edges";
/**
 * Orchestrated agent runs: the append-only trace of a plan and everything it
 * did. Its own store because a run outlives the turn that started it — that is
 * the point of persisting it — and because a partial write must not be able to
 * touch a message.
 */
export const ORCHESTRA_RUNS = "orchestra_runs";
/** Index on graph_nodes.kind. */
export const BY_KIND = "by_kind";
/**
 * Comparison runs and their lanes (Atlas Compare).
 *
 * Two stores rather than one document, because a run is checkpointed while six
 * lanes are streaming at once: keeping lanes separate means a write for one
 * lane's progress does not re-serialize the other five, and a checkpoint taken
 * as the tab goes away cannot half-write the run's own header.
 *
 * Deliberately not the chat stores. A run is not a conversation — it has no
 * turns, no branches, and a lifetime measured in minutes — and reusing
 * `conversations` would have made every chat query filter a discriminator.
 */
export const COMPARE_RUNS = "compare_runs";
export const COMPARE_LANES = "compare_lanes";
/**
 * Comparison sessions — the conversation a run belongs to.
 *
 * Its own store rather than a field on the newest run, because a session
 * outlives every individual turn: it is renamed, pinned and listed in the
 * history rail while its runs come and go, and the rail must be able to read
 * every session header without loading a single answer.
 */
export const COMPARE_SESSIONS = "compare_sessions";
/** Index on messages.conversationId, for loading one thread. */
export const BY_CONVERSATION = "by_conversation";
/** Index on compare_lanes.runId, for loading one run's lanes. */
export const BY_RUN = "by_run";
/** Index on compare_runs.sessionId, for loading a session's turns in one read. */
export const BY_SESSION = "by_session";
/** Index on artifact_versions.artifactId / artifact_storage.artifactId. */
export const BY_ARTIFACT = "by_artifact";
/** Index on project_chunks.projectId. */
export const BY_PROJECT = "by_project";

/** True when this environment can back the store with IndexedDB. */
export function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

export function openChatDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    // Guarded per store rather than switched on oldVersion, so the same code
    // path upgrades a v1 database and creates a fresh v2 one.
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CONVERSATIONS)) {
        db.createObjectStore(CONVERSATIONS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(MESSAGES)) {
        const s = db.createObjectStore(MESSAGES, { keyPath: "id" });
        s.createIndex(BY_CONVERSATION, "conversationId", { unique: false });
      }
      if (!db.objectStoreNames.contains(ARTIFACTS)) {
        const s = db.createObjectStore(ARTIFACTS, { keyPath: "id" });
        s.createIndex(BY_CONVERSATION, "conversationId", { unique: false });
      }
      if (!db.objectStoreNames.contains(ARTIFACT_VERSIONS)) {
        const s = db.createObjectStore(ARTIFACT_VERSIONS, { keyPath: "id" });
        s.createIndex(BY_ARTIFACT, "artifactId", { unique: false });
      }
      if (!db.objectStoreNames.contains(ARTIFACT_STORAGE)) {
        // Composite key: one row per (artifact, key) pair.
        const s = db.createObjectStore(ARTIFACT_STORAGE, { keyPath: ["artifactId", "key"] });
        s.createIndex(BY_ARTIFACT, "artifactId", { unique: false });
      }
      if (!db.objectStoreNames.contains(PROJECT_CHUNKS)) {
        const s = db.createObjectStore(PROJECT_CHUNKS, { keyPath: "id" });
        s.createIndex(BY_PROJECT, "projectId", { unique: false });
      }
      if (!db.objectStoreNames.contains(MEMORY_FILES)) {
        // Keyed by path: paths are already unique and are how the tool addresses
        // files, so there is no separate id to keep in sync.
        db.createObjectStore(MEMORY_FILES, { keyPath: "path" });
      }
      if (!db.objectStoreNames.contains(CHAT_CHUNKS)) {
        const s = db.createObjectStore(CHAT_CHUNKS, { keyPath: "id" });
        s.createIndex(BY_CONVERSATION, "conversationId", { unique: false });
      }
      if (!db.objectStoreNames.contains(SKILLS)) {
        db.createObjectStore(SKILLS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(CONNECTORS)) {
        db.createObjectStore(CONNECTORS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(PLUGINS)) {
        db.createObjectStore(PLUGINS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(WORKSPACE_FILES)) {
        // Composite key: paths are unique per conversation, not globally, and a
        // surrogate id would need an index to be looked up by the pair anyway.
        const s = db.createObjectStore(WORKSPACE_FILES, { keyPath: ["conversationId", "path"] });
        s.createIndex(BY_CONVERSATION, "conversationId", { unique: false });
      }
      if (!db.objectStoreNames.contains(WORKSPACE_TASKS)) {
        const s = db.createObjectStore(WORKSPACE_TASKS, { keyPath: "id" });
        s.createIndex(BY_CONVERSATION, "conversationId", { unique: false });
      }
      if (!db.objectStoreNames.contains(WORKSPACE_META)) {
        db.createObjectStore(WORKSPACE_META, { keyPath: "conversationId" });
      }
      if (!db.objectStoreNames.contains(FOLD_SUMMARIES)) {
        db.createObjectStore(FOLD_SUMMARIES, { keyPath: "conversationId" });
      }
      if (!db.objectStoreNames.contains(FOLD_CHUNKS)) {
        const s = db.createObjectStore(FOLD_CHUNKS, { keyPath: "id" });
        s.createIndex(BY_CONVERSATION, "conversationId", { unique: false });
      }
      if (!db.objectStoreNames.contains(GRAPH_NODES)) {
        const s = db.createObjectStore(GRAPH_NODES, { keyPath: "id" });
        s.createIndex(BY_KIND, "kind", { unique: false });
      }
      if (!db.objectStoreNames.contains(GRAPH_EDGES)) {
        // Keyed by the triple, so re-running a builder is idempotent rather
        // than appending a second copy of every edge it already wrote.
        db.createObjectStore(GRAPH_EDGES, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(ORCHESTRA_RUNS)) {
        const s = db.createObjectStore(ORCHESTRA_RUNS, { keyPath: "id" });
        s.createIndex(BY_CONVERSATION, "conversationId", { unique: false });
      }
      if (!db.objectStoreNames.contains(COMPARE_SESSIONS)) {
        db.createObjectStore(COMPARE_SESSIONS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(COMPARE_RUNS)) {
        const s = db.createObjectStore(COMPARE_RUNS, { keyPath: "id" });
        s.createIndex(BY_SESSION, "sessionId", { unique: false });
      } else {
        // The store already exists from v11, so the guard above cannot add the
        // index to it. An index added after a store has to be created inside the
        // version-change transaction, which is the one this handler runs in.
        const s = req.transaction?.objectStore(COMPARE_RUNS);
        if (s && !s.indexNames.contains(BY_SESSION)) {
          s.createIndex(BY_SESSION, "sessionId", { unique: false });
        }
      }
      if (!db.objectStoreNames.contains(COMPARE_LANES)) {
        // Composite key: lane ids are unique per run, not globally, and the same
        // model routinely appears in many runs.
        const s = db.createObjectStore(COMPARE_LANES, { keyPath: ["runId", "id"] });
        s.createIndex(BY_RUN, "runId", { unique: false });
      }
      if (!db.objectStoreNames.contains(BLOB_FILES)) {
        // Same composite key as WORKSPACE_FILES, so a produced file and a text
        // file share one address space and cannot collide on path.
        const s = db.createObjectStore(BLOB_FILES, { keyPath: ["conversationId", "path"] });
        s.createIndex(BY_CONVERSATION, "conversationId", { unique: false });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // A later version opened in another tab cannot upgrade while this
      // connection is held. Closing on request is what lets that upgrade
      // proceed; without it the other tab hangs on `blocked` forever. The
      // memoized promise in each repo is dropped on the next failed call, so
      // the connection reopens at the new version.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    // The inverse case: *this* tab is trying to upgrade and an older connection
    // elsewhere is holding it open. Phrased so the caller can tell the user what
    // to do, because the only fix is on their side.
    req.onblocked = () =>
      reject(
        new Error(
          "Atlas needs to upgrade its local database, but another Atlas tab is open. Close the other tabs and reload.",
        ),
      );
  });
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Await transaction completion, not just the request — writes aren't durable until then. */
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

export async function getAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return wrap(db.transaction(store, "readonly").objectStore(store).getAll() as IDBRequest<T[]>);
}

export async function getAllByIndex<T>(
  db: IDBDatabase,
  store: string,
  index: string,
  key: IDBValidKey,
): Promise<T[]> {
  return wrap(
    db.transaction(store, "readonly").objectStore(store).index(index).getAll(key) as IDBRequest<T[]>,
  );
}

export async function get<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  return wrap(db.transaction(store, "readonly").objectStore(store).get(key) as IDBRequest<T | undefined>);
}

export async function put(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).put(value);
  return done(tx);
}

export async function putMany(db: IDBDatabase, store: string, values: unknown[]): Promise<void> {
  if (values.length === 0) return;
  const tx = db.transaction(store, "readwrite");
  const s = tx.objectStore(store);
  for (const v of values) s.put(v);
  return done(tx);
}

export async function del(db: IDBDatabase, store: string, key: IDBValidKey): Promise<void> {
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).delete(key);
  return done(tx);
}

/** Delete every record whose `index` equals `key`, in one transaction. */
export async function deleteByIndex(
  db: IDBDatabase,
  store: string,
  index: string,
  key: IDBValidKey,
): Promise<void> {
  const tx = db.transaction(store, "readwrite");
  const cur = tx.objectStore(store).index(index).openKeyCursor(IDBKeyRange.only(key));
  cur.onsuccess = () => {
    const c = cur.result;
    if (!c) return;
    tx.objectStore(store).delete(c.primaryKey);
    c.continue();
  };
  return done(tx);
}

/** Delete a conversation and its messages in ONE transaction, so it can't half-apply. */
export async function deleteConversationCascade(
  db: IDBDatabase,
  conversationId: string,
): Promise<void> {
  const tx = db.transaction([CONVERSATIONS, MESSAGES], "readwrite");
  tx.objectStore(CONVERSATIONS).delete(conversationId);
  const idx = tx.objectStore(MESSAGES).index(BY_CONVERSATION);
  // openKeyCursor: only the primary keys are needed, so the records are never
  // deserialized. Matters for threads with large attachment payloads.
  const cur = idx.openKeyCursor(IDBKeyRange.only(conversationId));
  cur.onsuccess = () => {
    const c = cur.result;
    if (!c) return;
    tx.objectStore(MESSAGES).delete(c.primaryKey);
    c.continue();
  };
  return done(tx);
}
