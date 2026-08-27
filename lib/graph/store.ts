"use client";

import {
  BY_KIND,
  GRAPH_EDGES,
  GRAPH_NODES,
  deleteByIndex,
  getAll,
  getAllByIndex,
  idbAvailable,
  openChatDb,
  putMany,
} from "@/lib/chat/idb";
import type { GraphDelta, GraphEdge, GraphNode, NodeKind } from "./types";

/**
 * Persistence for the *workspace* half of the graph, and only that half.
 *
 * The catalog and news halves are rebuilt from the shipped snapshot on load
 * (see `lib/graph/atlas-graph.ts`), because they are a pure function of a
 * version hash the app already tracks. Storing them would save a few
 * milliseconds and buy a staleness bug on every sync. What is stored here is the
 * part no snapshot can regenerate: what the user made.
 *
 * Client-only, like every other IndexedDB module in the repo. Every read
 * degrades to empty rather than throwing, so a browser with IndexedDB disabled
 * gets a catalog-only graph instead of a broken page.
 */

/** An edge row carries a derived primary key, since an edge has no natural id. */
interface StoredEdge extends GraphEdge {
  key: string;
}

export function edgeKey(e: GraphEdge): string {
  return `${e.from}|${e.kind}|${e.to}`;
}

async function db(): Promise<IDBDatabase | null> {
  if (!idbAvailable()) return null;
  try {
    return await openChatDb();
  } catch {
    return null;
  }
}

export async function loadWorkspaceGraph(): Promise<GraphDelta> {
  const d = await db();
  if (!d) return { nodes: [], edges: [] };
  try {
    const [nodes, edges] = await Promise.all([
      getAll<GraphNode>(d, GRAPH_NODES),
      getAll<StoredEdge>(d, GRAPH_EDGES),
    ]);
    return { nodes, edges: edges.map(({ key: _key, ...e }) => e) };
  } catch {
    return { nodes: [], edges: [] };
  }
}

/**
 * Write a delta.
 *
 * Upsert rather than replace: the workspace graph is written incrementally from
 * several sources (a new conversation, a saved artifact, a memory) and a
 * wholesale rewrite would mean every writer needed the whole picture. Both
 * stores are keyed by something derived from content, so re-running a builder
 * over unchanged data is a no-op rather than a duplicate.
 */
export async function saveWorkspaceDelta(delta: GraphDelta): Promise<void> {
  const d = await db();
  if (!d) return;
  try {
    if (delta.nodes.length) await putMany(d, GRAPH_NODES, delta.nodes);
    if (delta.edges.length) {
      await putMany(
        d,
        GRAPH_EDGES,
        delta.edges.map<StoredEdge>((e) => ({ ...e, key: edgeKey(e) })),
      );
    }
  } catch {
    /* A graph that cannot be persisted still works for this session. */
  }
}

/**
 * Drop every node of one kind and the edges touching them.
 *
 * Used when a source is re-indexed wholesale — deleting a conversation, say.
 * Edges are swept by scanning rather than by an index because the store is
 * small (the workspace overlay, not the catalog) and a second index would have
 * to be kept correct on every write for a path that runs rarely.
 */
export async function clearWorkspaceKind(kind: NodeKind): Promise<void> {
  const d = await db();
  if (!d) return;
  try {
    const doomed = new Set(
      (await getAllByIndex<GraphNode>(d, GRAPH_NODES, BY_KIND, kind)).map((n) => n.id),
    );
    if (doomed.size === 0) return;
    await deleteByIndex(d, GRAPH_NODES, BY_KIND, kind);
    const edges = await getAll<StoredEdge>(d, GRAPH_EDGES);
    const survivors = edges.filter((e) => !doomed.has(e.from) && !doomed.has(e.to));
    if (survivors.length !== edges.length) {
      await clearStore(d, GRAPH_EDGES);
      if (survivors.length) await putMany(d, GRAPH_EDGES, survivors);
    }
  } catch {
    /* Same reasoning as above: a failed sweep must not break the session. */
  }
}

function clearStore(d: IDBDatabase, store: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function resetWorkspaceGraph(): Promise<void> {
  const d = await db();
  if (!d) return;
  try {
    await clearStore(d, GRAPH_NODES);
    await clearStore(d, GRAPH_EDGES);
  } catch {
    /* ignore */
  }
}
