import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import {
  DB_VERSION,
  WORKSPACE_FILES,
  WORKSPACE_META,
  WORKSPACE_TASKS,
  openChatDb,
} from "../idb";
import { makeIdbWorkspaceRepo, resetWorkspaceDb } from "./repo-idb";
import { planTasks, setTaskStatus } from "./tasks";
import { runFsCommand } from "../fs-commands";
import { WORKSPACE_LIMITS, workspaceFsStore } from "./fs";

/**
 * The storage half of the workspace, against a real (faked) IndexedDB.
 *
 * The pure logic is covered in `workspace.test.ts`; what needs a database is
 * the DB v8 upgrade actually creating the stores, the composite key behaving
 * per-conversation, and the ledger's delete-then-insert replace not leaking
 * rows between conversations.
 */

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

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetWorkspaceDb();
  globalThis.localStorage = fakeLocalStorage();
});

describe("DB v8 upgrade", () => {
  it("creates the three workspace stores", async () => {
    const db = await openChatDb();
    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames]).toEqual(
      expect.arrayContaining([WORKSPACE_FILES, WORKSPACE_TASKS, WORKSPACE_META]),
    );
  });

  // Additive: everything from v1–v7 has to survive, or an existing user loses
  // their conversations to a feature they never asked for.
  it("keeps every earlier store", async () => {
    const db = await openChatDb();
    expect([...db.objectStoreNames]).toEqual(
      expect.arrayContaining([
        "conversations",
        "messages",
        "artifacts",
        "artifact_versions",
        "artifact_storage",
        "project_chunks",
        "memory_files",
        "chat_chunks",
        "skills",
        "connectors",
        "plugins",
      ]),
    );
  });
});

describe("workspace files", () => {
  it("round-trips a file", async () => {
    const repo = makeIdbWorkspaceRepo();
    await repo.writeFile("c1", "/workspace/index.html", "<h1>Hi</h1>");
    const got = await repo.readFile("c1", "/workspace/index.html");
    expect(got?.content).toBe("<h1>Hi</h1>");
    expect(got?.conversationId).toBe("c1");
  });

  // The composite key is what makes two builds independent.
  it("keeps the same path in two conversations apart", async () => {
    const repo = makeIdbWorkspaceRepo();
    await repo.writeFile("c1", "/workspace/index.html", "one");
    await repo.writeFile("c2", "/workspace/index.html", "two");
    expect((await repo.readFile("c1", "/workspace/index.html"))?.content).toBe("one");
    expect((await repo.readFile("c2", "/workspace/index.html"))?.content).toBe("two");
    expect(await repo.listFiles("c1")).toHaveLength(1);
  });

  it("overwrites rather than duplicating on a second write", async () => {
    const repo = makeIdbWorkspaceRepo();
    await repo.writeFile("c1", "/workspace/a.css", "first");
    await repo.writeFile("c1", "/workspace/a.css", "second");
    const files = await repo.listFiles("c1");
    expect(files).toHaveLength(1);
    expect(files[0].content).toBe("second");
  });

  it("removes one file without touching the rest", async () => {
    const repo = makeIdbWorkspaceRepo();
    await repo.writeFile("c1", "/workspace/a", "a");
    await repo.writeFile("c1", "/workspace/b", "b");
    await repo.removeFile("c1", "/workspace/a");
    expect((await repo.listFiles("c1")).map((f) => f.path)).toEqual(["/workspace/b"]);
  });
});

describe("task ledger", () => {
  it("round-trips in order", async () => {
    const repo = makeIdbWorkspaceRepo();
    const { tasks } = planTasks("c1", ["Design", "Build", "Ship"]);
    await repo.replaceTasks("c1", tasks);
    expect((await repo.listTasks("c1")).map((t) => t.title)).toEqual(["Design", "Build", "Ship"]);
  });

  // delete-then-insert must not leave the old rows behind.
  it("replaces rather than accumulating", async () => {
    const repo = makeIdbWorkspaceRepo();
    await repo.replaceTasks("c1", planTasks("c1", ["A", "B", "C"]).tasks);
    await repo.replaceTasks("c1", planTasks("c1", ["X"]).tasks);
    const after = await repo.listTasks("c1");
    expect(after).toHaveLength(1);
    expect(after[0].title).toBe("X");
  });

  it("does not disturb another conversation's ledger", async () => {
    const repo = makeIdbWorkspaceRepo();
    await repo.replaceTasks("c1", planTasks("c1", ["A"]).tasks);
    await repo.replaceTasks("c2", planTasks("c2", ["B"]).tasks);
    await repo.replaceTasks("c1", planTasks("c1", ["A2"]).tasks);
    expect((await repo.listTasks("c2")).map((t) => t.title)).toEqual(["B"]);
  });

  it("persists a status change with its note", async () => {
    const repo = makeIdbWorkspaceRepo();
    const { tasks } = planTasks("c1", ["Design", "Build"]);
    await repo.replaceTasks("c1", tasks);
    const moved = setTaskStatus(await repo.listTasks("c1"), "1", "done", "agreed").tasks;
    await repo.replaceTasks("c1", moved);
    const after = await repo.listTasks("c1");
    expect(after[0].status).toBe("done");
    expect(after[0].note).toBe("agreed");
  });
});

describe("snapshot and clear", () => {
  it("returns goal, files and tasks together", async () => {
    const repo = makeIdbWorkspaceRepo();
    await repo.setGoal("c1", "A coffee landing page");
    await repo.writeFile("c1", "/workspace/index.html", "<h1>x</h1>");
    await repo.replaceTasks("c1", planTasks("c1", ["Design"]).tasks);
    const snap = await repo.snapshot("c1");
    expect(snap.goal).toBe("A coffee landing page");
    expect(snap.files).toHaveLength(1);
    expect(snap.tasks).toHaveLength(1);
  });

  it("empties one conversation and leaves the other", async () => {
    const repo = makeIdbWorkspaceRepo();
    await repo.setGoal("c1", "g1");
    await repo.writeFile("c1", "/workspace/a", "a");
    await repo.replaceTasks("c1", planTasks("c1", ["A"]).tasks);
    await repo.writeFile("c2", "/workspace/a", "a");

    await repo.clear("c1");
    const gone = await repo.snapshot("c1");
    expect(gone).toEqual({ goal: "", files: [], tasks: [] });
    expect(await repo.listFiles("c2")).toHaveLength(1);
  });
});

/**
 * The seam that matters most: the shared command layer driving real storage.
 *
 * `workspace.test.ts` proves the commands are correct against a fake store and
 * `fs-commands.test.ts` proves the limits are enforced; this proves the adapter
 * between them and IndexedDB does not drop anything on the way.
 */
describe("fs commands over the IndexedDB driver", () => {
  it("writes a file in chunks and reads it back whole", async () => {
    const repo = makeIdbWorkspaceRepo();
    const store = workspaceFsStore("c1", repo);
    await runFsCommand(
      { command: "create", path: "/workspace/page.html", file_text: "<html>\n" },
      store,
      WORKSPACE_LIMITS,
    );
    await runFsCommand(
      { command: "append", path: "/workspace/page.html", append_text: "<body>\n" },
      store,
      WORKSPACE_LIMITS,
    );
    await runFsCommand(
      { command: "append", path: "/workspace/page.html", append_text: "</body></html>" },
      store,
      WORKSPACE_LIMITS,
    );
    const file = await repo.readFile("c1", "/workspace/page.html");
    expect(file?.content).toBe("<html>\n<body>\n</body></html>");
  });

  it("patches a stored file in place", async () => {
    const repo = makeIdbWorkspaceRepo();
    const store = workspaceFsStore("c1", repo);
    await runFsCommand(
      { command: "create", path: "/workspace/a.html", file_text: "<h1>Old</h1>" },
      store,
      WORKSPACE_LIMITS,
    );
    const r = await runFsCommand(
      { command: "str_replace", path: "/workspace/a.html", old_str: "Old", new_str: "New" },
      store,
      WORKSPACE_LIMITS,
    );
    expect(r.isError).toBeUndefined();
    expect((await repo.readFile("c1", "/workspace/a.html"))?.content).toBe("<h1>New</h1>");
  });

  // The boundary, exercised against real storage rather than a fake.
  it("refuses to escape the workspace root", async () => {
    const repo = makeIdbWorkspaceRepo();
    const store = workspaceFsStore("c1", repo);
    const r = await runFsCommand(
      { command: "create", path: "/workspace/../atlas-keys", file_text: "x" },
      store,
      WORKSPACE_LIMITS,
    );
    expect(r.isError).toBe(true);
    expect(await repo.listFiles("c1")).toHaveLength(0);
  });
});
