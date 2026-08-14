import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { makeIdbRepo, LEGACY_KEY, MIGRATED_FLAG } from "./repo-idb";
import type { ChatMessage } from "./types";

// The driver is pure IndexedDB + localStorage, so a shim for each is enough to
// exercise it exactly as the browser would.

function fakeLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const msg = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: "user",
  content: `body ${id}`,
  parentId: null,
  createdAt: 1000,
  ...over,
});

beforeEach(() => {
  // Fresh database and storage per test — IndexedDB is global and sticky.
  globalThis.indexedDB = new IDBFactory();
  globalThis.localStorage = fakeLocalStorage();
});

afterEach(() => {
  globalThis.localStorage.clear();
});

describe("conversations", () => {
  it("creates and lists", async () => {
    const repo = makeIdbRepo();
    await repo.createConversation({ id: "c1", title: "First" });
    const list = await repo.listConversations();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "c1", title: "First", projectId: null });
  });

  it("is not remote", () => {
    expect(makeIdbRepo().remote).toBe(false);
  });

  it("orders newest-updated first", async () => {
    const repo = makeIdbRepo();
    await repo.createConversation({ id: "old", title: "Old" });
    await repo.createConversation({ id: "new", title: "New" });
    await repo.updateConversation("old", { updatedAt: 1 });
    expect((await repo.listConversations()).map((c) => c.id)).toEqual(["new", "old"]);
  });

  it("patches without clobbering untouched fields", async () => {
    const repo = makeIdbRepo();
    await repo.createConversation({ id: "c1", title: "First", modelId: "m1" });
    await repo.updateConversation("c1", { title: "Renamed" });
    const [c] = await repo.listConversations();
    expect(c.title).toBe("Renamed");
    expect(c.modelId).toBe("m1");
  });

  it("ignores a patch for a conversation that doesn't exist", async () => {
    const repo = makeIdbRepo();
    await expect(repo.updateConversation("ghost", { title: "x" })).resolves.toBeUndefined();
    expect(await repo.listConversations()).toHaveLength(0);
  });
});

describe("messages", () => {
  it("round-trips and strips the storage-only foreign key", async () => {
    const repo = makeIdbRepo();
    await repo.createConversation({ id: "c1", title: "T" });
    await repo.addMessage("c1", msg("m1"));
    const [out] = await repo.listMessages("c1");
    expect(out).toEqual(msg("m1"));
    expect("conversationId" in out).toBe(false);
  });

  it("returns messages in createdAt order regardless of write order", async () => {
    const repo = makeIdbRepo();
    await repo.createConversation({ id: "c1", title: "T" });
    await repo.addMessage("c1", msg("late", { createdAt: 300 }));
    await repo.addMessage("c1", msg("early", { createdAt: 100 }));
    await repo.addMessage("c1", msg("mid", { createdAt: 200 }));
    expect((await repo.listMessages("c1")).map((m) => m.id)).toEqual(["early", "mid", "late"]);
  });

  it("keeps conversations isolated from each other", async () => {
    const repo = makeIdbRepo();
    await repo.createConversation({ id: "c1", title: "A" });
    await repo.createConversation({ id: "c2", title: "B" });
    await repo.addMessage("c1", msg("m1"));
    await repo.addMessage("c2", msg("m2"));
    expect((await repo.listMessages("c1")).map((m) => m.id)).toEqual(["m1"]);
    expect((await repo.listMessages("c2")).map((m) => m.id)).toEqual(["m2"]);
  });

  it("upserts by id, which is what regenerate relies on", async () => {
    const repo = makeIdbRepo();
    await repo.createConversation({ id: "c1", title: "T" });
    await repo.addMessage("c1", msg("m1", { content: "v1" }));
    await repo.addMessage("c1", msg("m1", { content: "v2" }));
    const list = await repo.listMessages("c1");
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe("v2");
  });

  it("preserves parentId, so the branch tree survives a reload", async () => {
    const repo = makeIdbRepo();
    await repo.createConversation({ id: "c1", title: "T" });
    await repo.addMessage("c1", msg("root", { parentId: null, createdAt: 1 }));
    await repo.addMessage("c1", msg("a", { parentId: "root", createdAt: 2 }));
    await repo.addMessage("c1", msg("b", { parentId: "root", createdAt: 3 }));
    const byId = Object.fromEntries((await repo.listMessages("c1")).map((m) => [m.id, m]));
    expect(byId.a.parentId).toBe("root");
    expect(byId.b.parentId).toBe("root");
  });

  it("patches a message in place", async () => {
    const repo = makeIdbRepo();
    await repo.createConversation({ id: "c1", title: "T" });
    await repo.addMessage("c1", msg("m1", { role: "assistant", content: "" }));
    await repo.updateMessage("c1", "m1", { content: "streamed", promptTokens: 12 });
    const [m] = await repo.listMessages("c1");
    expect(m.content).toBe("streamed");
    expect(m.promptTokens).toBe(12);
    expect(m.role).toBe("assistant");
  });

  // The localStorage driver silently dropped `pinned`; IndexedDB stores the
  // whole record, so it must not.
  it("persists pinned", async () => {
    const repo = makeIdbRepo();
    await repo.createConversation({ id: "c1", title: "T" });
    await repo.addMessage("c1", msg("m1"));
    await repo.updateMessage("c1", "m1", { pinned: true });
    expect((await repo.listMessages("c1"))[0].pinned).toBe(true);
  });

  it("bumps the conversation's updatedAt when a message lands", async () => {
    const repo = makeIdbRepo();
    await repo.createConversation({ id: "c1", title: "T" });
    await repo.updateConversation("c1", { updatedAt: 1 });
    await repo.addMessage("c1", msg("m1"));
    expect((await repo.listConversations())[0].updatedAt).toBeGreaterThan(1);
  });
});

describe("cascade delete", () => {
  it("removes the conversation and every message under it", async () => {
    const repo = makeIdbRepo();
    await repo.createConversation({ id: "c1", title: "Doomed" });
    await repo.createConversation({ id: "c2", title: "Kept" });
    for (const id of ["m1", "m2", "m3"]) await repo.addMessage("c1", msg(id));
    await repo.addMessage("c2", msg("keep"));

    await repo.deleteConversation("c1");

    expect((await repo.listConversations()).map((c) => c.id)).toEqual(["c2"]);
    expect(await repo.listMessages("c1")).toHaveLength(0);
    // The neighbouring thread must be untouched.
    expect((await repo.listMessages("c2")).map((m) => m.id)).toEqual(["keep"]);
  });
});

describe("migration from the localStorage blob", () => {
  const legacy = {
    conversations: [
      { id: "c1", title: "Legacy", createdAt: 5, updatedAt: 9 },
      { id: "c2", title: "Legacy 2", createdAt: 1, updatedAt: 2 },
    ],
    messages: {
      c1: [msg("m1", { createdAt: 1 }), msg("m2", { parentId: "m1", createdAt: 2 })],
      c2: [msg("m3")],
    },
  };

  it("imports conversations and messages on first use", async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
    const repo = makeIdbRepo();
    expect((await repo.listConversations()).map((c) => c.id)).toEqual(["c1", "c2"]);
    expect((await repo.listMessages("c1")).map((m) => m.id)).toEqual(["m1", "m2"]);
    expect((await repo.listMessages("c2")).map((m) => m.id)).toEqual(["m3"]);
  });

  it("keeps parent links through the import", async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
    const repo = makeIdbRepo();
    const list = await repo.listMessages("c1");
    expect(list.find((m) => m.id === "m2")?.parentId).toBe("m1");
  });

  it("leaves the legacy blob in place, so a rollback still has the data", async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
    await makeIdbRepo().listConversations();
    expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
  });

  it("marks itself done and does not re-import over newer edits", async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
    const repo = makeIdbRepo();
    await repo.listConversations();
    expect(localStorage.getItem(MIGRATED_FLAG)).toBe("1");

    await repo.updateConversation("c1", { title: "Renamed after migration" });
    // A fresh driver against the same database must not resurrect the old title.
    const again = makeIdbRepo();
    const c1 = (await again.listConversations()).find((c) => c.id === "c1");
    expect(c1?.title).toBe("Renamed after migration");
  });

  it("does not re-import a conversation the user deleted", async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
    const repo = makeIdbRepo();
    await repo.deleteConversation("c1");
    const again = makeIdbRepo();
    expect((await again.listConversations()).map((c) => c.id)).toEqual(["c2"]);
  });

  it("starts clean when there is nothing to migrate", async () => {
    const repo = makeIdbRepo();
    expect(await repo.listConversations()).toEqual([]);
    expect(localStorage.getItem(MIGRATED_FLAG)).toBe("1");
  });

  it("survives a corrupt legacy blob rather than failing to start", async () => {
    localStorage.setItem(LEGACY_KEY, "{not json at all");
    const repo = makeIdbRepo();
    await expect(repo.listConversations()).resolves.toEqual([]);
    // And it still works afterwards.
    await repo.createConversation({ id: "fresh", title: "New" });
    expect((await repo.listConversations()).map((c) => c.id)).toEqual(["fresh"]);
  });

  it("tolerates a legacy blob with missing sections", async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ conversations: [{ id: "c1", title: "T", createdAt: 1, updatedAt: 1 }] }));
    const repo = makeIdbRepo();
    expect((await repo.listConversations()).map((c) => c.id)).toEqual(["c1"]);
    expect(await repo.listMessages("c1")).toEqual([]);
  });
});

/**
 * The batched write compaction needs.
 *
 * `updateMessage` had **zero** production callers when this was written —
 * compaction went through the store's in-memory patch, so a folded thread
 * un-folded itself on reload and immediately re-triggered the same auto-fold.
 * The whole derived-summary design rests on one boolean per message surviving,
 * and these are the assertions that would have caught it not surviving.
 */
describe("updateMessages", () => {
  const seed = async (repo: ReturnType<typeof makeIdbRepo>, n: number) => {
    await repo.createConversation({ id: "c1", title: "T" });
    for (let i = 0; i < n; i++) {
      await repo.addMessage("c1", msg(`m${i}`, { createdAt: 1000 + i }));
    }
  };

  it("folds a whole plan in one call, and it survives a reload", async () => {
    const repo = makeIdbRepo();
    await seed(repo, 40);
    const ids = Array.from({ length: 32 }, (_, i) => `m${i}`);

    await repo.updateMessages(
      "c1",
      ids.map((id) => ({ id, patch: { folded: true } })),
    );

    // A *fresh* driver, i.e. what a page reload does.
    const reloaded = makeIdbRepo();
    const after = await reloaded.listMessages("c1");
    expect(after.filter((m) => m.folded)).toHaveLength(32);
    expect(after.filter((m) => !m.folded)).toHaveLength(8);
  });

  it("unfolds the same way, so undo is durable too", async () => {
    const repo = makeIdbRepo();
    await seed(repo, 4);
    const ids = ["m0", "m1"];
    await repo.updateMessages("c1", ids.map((id) => ({ id, patch: { folded: true } })));
    await repo.updateMessages("c1", ids.map((id) => ({ id, patch: { folded: false } })));
    expect((await makeIdbRepo().listMessages("c1")).some((m) => m.folded)).toBe(false);
  });

  // A fold plan can name a message the user deleted between planning and
  // applying; that must not abort the transaction and lose the whole fold.
  it("skips an unknown id rather than failing the batch", async () => {
    const repo = makeIdbRepo();
    await seed(repo, 3);
    await repo.updateMessages("c1", [
      { id: "m0", patch: { folded: true } },
      { id: "ghost", patch: { folded: true } },
      { id: "m2", patch: { folded: true } },
    ]);
    const after = await makeIdbRepo().listMessages("c1");
    expect(after.filter((m) => m.folded).map((m) => m.id)).toEqual(["m0", "m2"]);
  });

  it("leaves every other field alone", async () => {
    const repo = makeIdbRepo();
    await repo.createConversation({ id: "c1", title: "T" });
    await repo.addMessage("c1", msg("m0", { content: "keep me", pinned: true }));
    await repo.updateMessages("c1", [{ id: "m0", patch: { folded: true } }]);
    const [row] = await makeIdbRepo().listMessages("c1");
    expect(row.content).toBe("keep me");
    expect(row.pinned).toBe(true);
    expect(row.folded).toBe(true);
  });

  it("does nothing with an empty batch", async () => {
    const repo = makeIdbRepo();
    await seed(repo, 2);
    await expect(repo.updateMessages("c1", [])).resolves.toBeUndefined();
    expect(await repo.listMessages("c1")).toHaveLength(2);
  });

  it("applies heterogeneous patches in one batch", async () => {
    const repo = makeIdbRepo();
    await seed(repo, 2);
    await repo.updateMessages("c1", [
      { id: "m0", patch: { folded: true } },
      { id: "m1", patch: { pinned: true } },
    ]);
    const after = await makeIdbRepo().listMessages("c1");
    expect(after.find((m) => m.id === "m0")?.folded).toBe(true);
    expect(after.find((m) => m.id === "m1")?.pinned).toBe(true);
  });
});
