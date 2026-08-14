// A conversation is a DAG of message turns. The UI renders one linear "active
// path" through it; edits and regenerations create siblings (branches) that the
// user can navigate between (§4.2). This module is pure: it operates on a node
// map + an `active` pointer map and never touches storage or React.

import type { ChatMessage } from "./types";

/** Virtual parent key for root messages (first turn of a branch). */
export const ROOT = "__root__";

export interface Tree {
  /** All messages across every branch of the active conversation, keyed by id. */
  nodes: Record<string, ChatMessage>;
  /** parentKey → chosen child id. Absent ⇒ default to the newest child. */
  active: Record<string, string>;
}

export const emptyTree = (): Tree => ({ nodes: {}, active: {} });

const keyOf = (m: ChatMessage): string => m.parentId ?? ROOT;

// `childrenMap` sorts every node in the conversation. Both `activePath` and
// `siblingsOf` call it, and the chat view calls `siblingsOf` once per rendered
// message — which made a render O(N² log N), re-paid on every keystroke and
// every streaming flush.
//
// Keying the cache on the `nodes` object itself keeps the module referentially
// pure: `putNode`, `patchNode`, and `treeFromList` all allocate a fresh `nodes`
// literal, so any mutation is a new identity and therefore a cache miss. The
// cache can go cold but never stale, and a WeakMap lets dropped conversations
// be collected.
const childrenCache = new WeakMap<
  Record<string, ChatMessage>,
  Map<string, string[]>
>();

const DEV = process.env.NODE_ENV !== "production";

/** parentKey → child ids, ordered oldest→newest by createdAt. */
export function childrenMap(nodes: Record<string, ChatMessage>): Map<string, string[]> {
  const cached = childrenCache.get(nodes);
  if (cached) return cached;

  const map = new Map<string, string[]>();
  const ids = Object.keys(nodes).sort(
    (a, b) => nodes[a].createdAt - nodes[b].createdAt || (a < b ? -1 : 1),
  );
  for (const id of ids) {
    const k = keyOf(nodes[id]);
    const arr = map.get(k);
    if (arr) arr.push(id);
    else map.set(k, [id]);
  }

  // Callers now share these arrays (`siblingsOf` hands one straight back), so
  // freeze them in development to catch a mutating caller immediately.
  if (DEV) for (const arr of map.values()) Object.freeze(arr);

  childrenCache.set(nodes, map);
  return map;
}

/** The linear path currently shown: follow `active` pointers, else newest child. */
export function activePath(tree: Tree): ChatMessage[] {
  const kids = childrenMap(tree.nodes);
  const path: ChatMessage[] = [];
  const seen = new Set<string>();
  let k = ROOT;
  while (true) {
    const cs = kids.get(k);
    if (!cs || cs.length === 0) break;
    let chosen = tree.active[k];
    if (!chosen || !cs.includes(chosen)) chosen = cs[cs.length - 1];
    if (seen.has(chosen)) break; // cycle guard (should never happen)
    seen.add(chosen);
    path.push(tree.nodes[chosen]);
    k = chosen;
  }
  return path;
}

/** Sibling ids (turns sharing a parent) and the index of `id` among them. */
export function siblingsOf(tree: Tree, id: string): { ids: string[]; index: number } {
  const m = tree.nodes[id];
  if (!m) return { ids: [id], index: 0 };
  const ids = childrenMap(tree.nodes).get(keyOf(m)) ?? [id];
  return { ids, index: Math.max(0, ids.indexOf(id)) };
}

/** Id of the last node on the active path (where new turns attach), or null. */
export function activeLeafId(tree: Tree): string | null {
  const path = activePath(tree);
  return path.length ? path[path.length - 1].id : null;
}

/** Put `id` on the active path by pointing its parent at it. */
export function selectSibling(tree: Tree, id: string): Record<string, string> {
  const node = tree.nodes[id];
  if (!node) return tree.active;
  return { ...tree.active, [keyOf(node)]: id };
}

/** Insert/replace a node and make it the active choice for its parent. */
export function putNode(tree: Tree, msg: ChatMessage): Tree {
  return {
    nodes: { ...tree.nodes, [msg.id]: msg },
    active: { ...tree.active, [keyOf(msg)]: msg.id },
  };
}

/** Shallow-patch a node in place (no active change). */
export function patchNode(
  tree: Tree,
  id: string,
  patch: Partial<ChatMessage>,
): Tree {
  const cur = tree.nodes[id];
  if (!cur) return tree;
  return { ...tree, nodes: { ...tree.nodes, [id]: { ...cur, ...patch } } };
}

/**
 * Rebuild the `active` pointer map from a single remembered leaf id.
 *
 * Persisting one leaf is enough to restore the whole visible path: walking
 * parent links from it names exactly one child at every level. That is why the
 * conversation stores `activeLeafId` rather than the full pointer map — one id
 * syncs across devices cleanly, where a map would need merging.
 *
 * Returns {} for an unknown or dangling leaf, which makes `activePath` fall back
 * to "newest child" — the same behaviour as a conversation never opened before.
 */
export function activeFromLeaf(
  nodes: Record<string, ChatMessage>,
  leafId: string | null | undefined,
): Record<string, string> {
  if (!leafId || !nodes[leafId]) return {};
  const active: Record<string, string> = {};
  const seen = new Set<string>();
  let cur: ChatMessage | undefined = nodes[leafId];
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    active[keyOf(cur)] = cur.id;
    const parentId: string | null | undefined = cur.parentId;
    cur = parentId ? nodes[parentId] : undefined;
  }
  return active;
}

/**
 * The messages from the root down to `id` inclusive, along its own branch.
 * Used by fork, which copies a prefix of the conversation into a new one.
 */
export function pathTo(nodes: Record<string, ChatMessage>, id: string): ChatMessage[] {
  const out: ChatMessage[] = [];
  const seen = new Set<string>();
  let cur: ChatMessage | undefined = nodes[id];
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    const parentId: string | null | undefined = cur.parentId;
    cur = parentId ? nodes[parentId] : undefined;
  }
  return out.reverse();
}

/** Build a tree from a flat, chronological message list (migration / load). */
export function treeFromList(list: ChatMessage[]): Tree {
  const nodes: Record<string, ChatMessage> = {};
  let prev: string | null = null;
  for (const m of list) {
    // If parentId is already present (tree-aware store), trust it; otherwise
    // chain messages linearly (legacy flat conversations).
    const parentId = m.parentId !== undefined ? m.parentId : prev;
    nodes[m.id] = { ...m, parentId };
    prev = m.id;
  }
  return { nodes, active: {} };
}
