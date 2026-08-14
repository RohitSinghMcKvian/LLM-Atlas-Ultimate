import { describe, it, expect } from "vitest";
import {
  ROOT,
  emptyTree,
  childrenMap,
  activePath,
  siblingsOf,
  activeLeafId,
  selectSibling,
  putNode,
  patchNode,
  treeFromList,
  activeFromLeaf,
  pathTo,
  type Tree,
} from "./tree";
import type { ChatMessage } from "./types";

function msg(
  id: string,
  parentId: string | null,
  createdAt: number,
  extras?: Partial<ChatMessage>,
): ChatMessage {
  return {
    id,
    role: "user",
    content: id,
    createdAt,
    parentId,
    ...extras,
  };
}

function treeOf(...list: ChatMessage[]): Tree {
  const nodes: Record<string, ChatMessage> = {};
  for (const m of list) nodes[m.id] = m;
  return { nodes, active: {} };
}

describe("childrenMap", () => {
  it("groups children under their parent key, roots under ROOT", () => {
    const t = treeOf(msg("a", null, 1), msg("b", "a", 2), msg("c", "a", 3));
    const kids = childrenMap(t.nodes);
    expect(kids.get(ROOT)).toEqual(["a"]);
    expect(kids.get("a")).toEqual(["b", "c"]);
  });

  it("orders siblings oldest to newest by createdAt", () => {
    const t = treeOf(msg("late", "p", 300), msg("early", "p", 100), msg("mid", "p", 200));
    expect(childrenMap(t.nodes).get("p")).toEqual(["early", "mid", "late"]);
  });

  it("breaks createdAt ties deterministically by id", () => {
    const t = treeOf(msg("zzz", "p", 50), msg("aaa", "p", 50), msg("mmm", "p", 50));
    expect(childrenMap(t.nodes).get("p")).toEqual(["aaa", "mmm", "zzz"]);
  });

  it("treats undefined parentId the same as a root", () => {
    const nodes: Record<string, ChatMessage> = {
      r: { id: "r", role: "user", content: "r", createdAt: 1 },
    };
    expect(childrenMap(nodes).get(ROOT)).toEqual(["r"]);
  });

  it("returns an empty map for an empty node set", () => {
    expect(childrenMap({}).size).toBe(0);
  });
});

describe("activePath", () => {
  it("returns [] for an empty tree", () => {
    expect(activePath(emptyTree())).toEqual([]);
  });

  it("walks a linear chain in order", () => {
    const t = treeOf(msg("a", null, 1), msg("b", "a", 2), msg("c", "b", 3));
    expect(activePath(t).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("defaults to the newest child when no active pointer is set", () => {
    const t = treeOf(msg("a", null, 1), msg("b1", "a", 2), msg("b2", "a", 3));
    expect(activePath(t).map((m) => m.id)).toEqual(["a", "b2"]);
  });

  it("follows explicit active pointers over the newest-child default", () => {
    const base = treeOf(msg("a", null, 1), msg("b1", "a", 2), msg("b2", "a", 3));
    const t: Tree = { ...base, active: { a: "b1" } };
    expect(activePath(t).map((m) => m.id)).toEqual(["a", "b1"]);
  });

  it("ignores an active pointer that is not a child of that parent", () => {
    const base = treeOf(msg("a", null, 1), msg("b1", "a", 2), msg("b2", "a", 3));
    const t: Tree = { ...base, active: { a: "nope" } };
    expect(activePath(t).map((m) => m.id)).toEqual(["a", "b2"]);
  });

  it("terminates on a cycle instead of looping forever", () => {
    // a -> b, and b's active pointer sends us back to b's own subtree entry.
    const t: Tree = {
      nodes: {
        a: msg("a", null, 1),
        b: msg("b", "a", 2),
        c: msg("c", "b", 3),
      },
      active: { a: "b", b: "c", c: "c" },
    };
    const path = activePath(t);
    expect(path.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });
});

describe("siblingsOf", () => {
  it("returns the sibling ids and the index of the target", () => {
    const t = treeOf(msg("a", null, 1), msg("b1", "a", 2), msg("b2", "a", 3), msg("b3", "a", 4));
    expect(siblingsOf(t, "b2")).toEqual({ ids: ["b1", "b2", "b3"], index: 1 });
  });

  it("returns a lone self-sibling for an unknown id", () => {
    expect(siblingsOf(emptyTree(), "ghost")).toEqual({ ids: ["ghost"], index: 0 });
  });

  it("treats root messages as siblings of each other", () => {
    const t = treeOf(msg("r1", null, 1), msg("r2", null, 2));
    expect(siblingsOf(t, "r1")).toEqual({ ids: ["r1", "r2"], index: 0 });
  });
});

describe("activeLeafId", () => {
  it("returns null for an empty tree", () => {
    expect(activeLeafId(emptyTree())).toBeNull();
  });

  it("returns the last node on the active path", () => {
    const t = treeOf(msg("a", null, 1), msg("b", "a", 2), msg("c", "b", 3));
    expect(activeLeafId(t)).toBe("c");
  });
});

describe("selectSibling", () => {
  it("points the parent key at the chosen id", () => {
    const t = treeOf(msg("a", null, 1), msg("b1", "a", 2), msg("b2", "a", 3));
    expect(selectSibling(t, "b1")).toEqual({ a: "b1" });
  });

  it("returns the existing active map unchanged for an unknown id", () => {
    const t = treeOf(msg("a", null, 1));
    expect(selectSibling(t, "ghost")).toBe(t.active);
  });
});

describe("putNode / patchNode", () => {
  it("putNode inserts and makes the node active for its parent", () => {
    const t = putNode(emptyTree(), msg("a", null, 1));
    expect(t.nodes.a).toBeDefined();
    expect(t.active[ROOT]).toBe("a");
  });

  it("putNode returns a new nodes object (identity changes)", () => {
    const before = emptyTree();
    const after = putNode(before, msg("a", null, 1));
    expect(after.nodes).not.toBe(before.nodes);
  });

  it("patchNode shallow-merges and leaves active untouched", () => {
    const t = putNode(emptyTree(), msg("a", null, 1));
    const patched = patchNode(t, "a", { content: "updated" });
    expect(patched.nodes.a.content).toBe("updated");
    expect(patched.nodes.a.createdAt).toBe(1);
    expect(patched.active).toBe(t.active);
    expect(patched.nodes).not.toBe(t.nodes);
  });

  it("patchNode is a no-op for an unknown id", () => {
    const t = putNode(emptyTree(), msg("a", null, 1));
    expect(patchNode(t, "ghost", { content: "x" })).toBe(t);
  });
});

describe("treeFromList", () => {
  it("chains legacy flat messages linearly", () => {
    const list: ChatMessage[] = [
      { id: "a", role: "user", content: "a", createdAt: 1 },
      { id: "b", role: "assistant", content: "b", createdAt: 2 },
      { id: "c", role: "user", content: "c", createdAt: 3 },
    ];
    const t = treeFromList(list);
    expect(t.nodes.a.parentId).toBeNull();
    expect(t.nodes.b.parentId).toBe("a");
    expect(t.nodes.c.parentId).toBe("b");
    expect(activePath(t).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("trusts an explicit parentId when present", () => {
    const list = [msg("a", null, 1), msg("b1", "a", 2), msg("b2", "a", 3)];
    const t = treeFromList(list);
    expect(t.nodes.b2.parentId).toBe("a");
    expect(activePath(t).map((m) => m.id)).toEqual(["a", "b2"]);
  });
});

describe("caching does not leak between distinct node maps", () => {
  it("recomputes after putNode changes the node set", () => {
    let t = putNode(emptyTree(), msg("a", null, 1));
    expect(activePath(t).map((m) => m.id)).toEqual(["a"]);
    t = putNode(t, msg("b", "a", 2));
    expect(activePath(t).map((m) => m.id)).toEqual(["a", "b"]);
    t = putNode(t, msg("b2", "a", 3));
    expect(activePath(t).map((m) => m.id)).toEqual(["a", "b2"]);
  });

  it("recomputes after patchNode replaces the node set", () => {
    let t = putNode(putNode(emptyTree(), msg("a", null, 1)), msg("b", "a", 2));
    expect(siblingsOf(t, "b").ids).toEqual(["b"]);
    t = patchNode(t, "b", { content: "changed" });
    expect(activePath(t).map((m) => m.content)).toEqual(["a", "changed"]);
    expect(siblingsOf(t, "b").ids).toEqual(["b"]);
  });

  it("returns consistent results when called repeatedly on the same tree", () => {
    const t = treeOf(msg("a", null, 1), msg("b1", "a", 2), msg("b2", "a", 3));
    expect(activePath(t)).toEqual(activePath(t));
    expect(siblingsOf(t, "b1")).toEqual(siblingsOf(t, "b1"));
    expect(childrenMap(t.nodes).get("a")).toEqual(["b1", "b2"]);
  });
});

// ── activeFromLeaf ──────────────────────────────────────────────────────────
// The persisted branch pointer: one leaf id must be enough to restore the whole
// visible path across a reload or another device.

describe("activeFromLeaf", () => {
  const nodes = treeOf(
    msg("root", null, 1),
    msg("a", "root", 2),
    msg("b", "root", 3),
    msg("a1", "a", 4),
    msg("b1", "b", 5),
  ).nodes;

  it("restores a non-default branch that activePath would otherwise skip", () => {
    // "b" is the newest child of root, so without a pointer the path follows it.
    expect(activePath({ nodes, active: {} }).map((m) => m.id)).toEqual(["root", "b", "b1"]);
    const active = activeFromLeaf(nodes, "a1");
    expect(activePath({ nodes, active }).map((m) => m.id)).toEqual(["root", "a", "a1"]);
  });

  it("names one child at every level from the leaf up", () => {
    expect(activeFromLeaf(nodes, "a1")).toEqual({ [ROOT]: "root", root: "a", a: "a1" });
  });

  it("falls back to newest-child for an unknown leaf", () => {
    expect(activeFromLeaf(nodes, "does-not-exist")).toEqual({});
    expect(activeFromLeaf(nodes, null)).toEqual({});
    expect(activeFromLeaf(nodes, undefined)).toEqual({});
  });

  it("round-trips with activeLeafId", () => {
    const active = activeFromLeaf(nodes, "a1");
    expect(activeLeafId({ nodes, active })).toBe("a1");
  });

  it("terminates on a cyclic parent chain", () => {
    const cyclic: Record<string, ChatMessage> = {
      x: { ...msg("x", "y", 1) },
      y: { ...msg("y", "x", 2) },
    };
    expect(() => activeFromLeaf(cyclic, "x")).not.toThrow();
  });
});

// ── pathTo ──────────────────────────────────────────────────────────────────

describe("pathTo", () => {
  const nodes = treeOf(
    msg("root", null, 1),
    msg("a", "root", 2),
    msg("b", "root", 3),
    msg("a1", "a", 4),
  ).nodes;

  it("returns root-first history along the node's own branch", () => {
    expect(pathTo(nodes, "a1").map((m) => m.id)).toEqual(["root", "a", "a1"]);
  });

  it("excludes messages on sibling branches", () => {
    expect(pathTo(nodes, "a1").map((m) => m.id)).not.toContain("b");
  });

  it("returns just the node for a root", () => {
    expect(pathTo(nodes, "root").map((m) => m.id)).toEqual(["root"]);
  });

  it("returns empty for an unknown id", () => {
    expect(pathTo(nodes, "ghost")).toEqual([]);
  });

  it("terminates on a cyclic parent chain", () => {
    const cyclic: Record<string, ChatMessage> = {
      x: { ...msg("x", "y", 1) },
      y: { ...msg("y", "x", 2) },
    };
    expect(() => pathTo(cyclic, "x")).not.toThrow();
  });
});
