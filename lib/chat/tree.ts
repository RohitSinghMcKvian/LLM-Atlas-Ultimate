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

/** parentKey → child ids, ordered oldest→newest by createdAt. */
export function childrenMap(nodes: Record<string, ChatMessage>): Map<string, string[]> {
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
