import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { SWEEP_MIN_AGE_MS, deleteBuild, sweepOrphanedBuilds } from "./artifact-gc";
import {
  listArtifactsForConversation,
  listVersions,
  recordVersion,
  resetArtifactDb,
  softDeleteArtifact,
  storageGet,
  storageSet,
} from "./artifact-repo";
import { resetIncognito, setIncognito } from "./incognito";
import { ARTIFACTS, ARTIFACT_STORAGE, ARTIFACT_VERSIONS, getAll, openChatDb } from "./idb";
import { resetWorkspaceRepo, workspaceRepo } from "./workspace/repo";
import { resetWorkspaceDb } from "./workspace/repo-idb";

/**
 * Counted against the raw stores, not through the repo. The repo already hides
 * soft-deleted records, so a repo-level check would report a build as collected
 * while every one of its rows was still on disk — which is the exact failure
 * this module exists to fix.
 */
async function rawCounts() {
  const d = await openChatDb();
  return {
    artifacts: (await getAll(d, ARTIFACTS)).length,
    versions: (await getAll(d, ARTIFACT_VERSIONS)).length,
    storage: (await getAll(d, ARTIFACT_STORAGE)).length,
  };
}

const v = (conversationId: string, code: string, path?: string) => ({
  conversationId,
  path,
  kind: "html" as const,
  lang: "html",
  title: path ?? "Page",
  code,
});

/**
 * A build with two files, two versions, and a saved storage row.
 *
 * Returns the *two-version* record by path, not by position. `[0]` was
 * position-dependent — records come back in primary-key order, and the key is a
 * generated id — so which file this handed back was effectively random, and the
 * two-versions assertion below failed on roughly two runs in three.
 */
async function seed(conversationId: string) {
  await recordVersion(v(conversationId, "<p>one</p>", "index.html"));
  await recordVersion(v(conversationId, "<p>two</p>", "index.html"));
  await recordVersion(v(conversationId, "body{}", "styles.css"));
  const all = await listArtifactsForConversation(conversationId);
  const rec = all.find((r) => r.path === "index.html") ?? all[0];
  await storageSet(rec.id, "score", 1);
  return rec;
}

/** Backdate every artifact record so the sweep's grace period is satisfied. */
async function backdate(): Promise<void> {
  const d = await openChatDb();
  const rows = await getAll<{ id: string; updatedAt: number }>(d, ARTIFACTS);
  const tx = d.transaction(ARTIFACTS, "readwrite");
  for (const row of rows) {
    tx.objectStore(ARTIFACTS).put({ ...row, updatedAt: Date.now() - SWEEP_MIN_AGE_MS - 1000 });
  }
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(null);
    tx.onerror = () => reject(tx.error);
  });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetArtifactDb();
  resetWorkspaceDb();
  resetWorkspaceRepo();
  resetIncognito();
});

afterEach(() => {
  resetIncognito();
});

describe("deleteBuild", () => {
  it("removes records, every version and every storage row", async () => {
    await seed("gone");
    expect(await rawCounts()).toEqual({ artifacts: 2, versions: 3, storage: 1 });

    const result = await deleteBuild("gone");
    expect(result).toEqual({ files: 2, versions: 3, storageRows: 1 });
    expect(await rawCounts()).toEqual({ artifacts: 0, versions: 0, storage: 0 });
  });

  it("removes a soft-deleted file too", async () => {
    await seed("gone");
    expect(await softDeleteArtifact("gone", "styles.css")).toMatchObject({ ok: true });
    // Still on disk — that is what a soft delete means.
    expect((await rawCounts()).artifacts).toBe(2);

    expect(await deleteBuild("gone")).toMatchObject({ files: 2 });
    expect(await rawCounts()).toEqual({ artifacts: 0, versions: 0, storage: 0 });
  });

  it("clears the /workspace filesystem as well", async () => {
    const repo = await workspaceRepo();
    await repo.writeFile("gone", "/workspace/index.html", "<p>one</p>");
    await repo.setGoal("gone", "A page");
    await repo.replaceTasks("gone", [
      { id: "t1", conversationId: "gone", title: "Write it", status: "done", order: 0 },
    ]);
    await seed("gone");

    await deleteBuild("gone");
    expect(await repo.snapshot("gone")).toEqual({ goal: "", files: [], tasks: [] });
  });

  it("leaves every other conversation alone", async () => {
    await seed("gone");
    const keeper = await seed("keep");

    await deleteBuild("gone");
    expect((await listArtifactsForConversation("keep")).length).toBe(2);
    expect(await listVersions(keeper.id)).toHaveLength(2);
    expect(await storageGet(keeper.id, "score")).toBe(1);
  });

  it("is a no-op for a conversation with no build", async () => {
    expect(await deleteBuild("never-existed")).toEqual({ files: 0, versions: 0, storageRows: 0 });
  });

  it("does not touch disk in incognito", async () => {
    await seed("saved");
    const before = await rawCounts();

    setIncognito(true);
    await deleteBuild("saved");
    // Hidden for the session...
    expect(await listArtifactsForConversation("saved")).toHaveLength(0);
    // ...but nothing was written, which is the mode's whole contract.
    expect(await rawCounts()).toEqual(before);

    setIncognito(false);
    expect(await listArtifactsForConversation("saved")).toHaveLength(2);
  });
});

describe("sweepOrphanedBuilds", () => {
  it("collects a build whose conversation is gone", async () => {
    await seed("orphan");
    await seed("alive");
    await backdate();

    const result = await sweepOrphanedBuilds(["alive"], { authoritative: true });
    expect(result).toMatchObject({ conversations: 1, files: 2, versions: 3, storageRows: 1 });
    expect(await listArtifactsForConversation("orphan")).toHaveLength(0);
    expect(await listArtifactsForConversation("alive")).toHaveLength(2);
  });

  it("spares a build newer than the grace period", async () => {
    await seed("orphan");
    await seed("alive");
    // Not backdated: both were written just now.

    const result = await sweepOrphanedBuilds(["alive"], { authoritative: true });
    expect(result.conversations).toBe(0);
    expect(await listArtifactsForConversation("orphan")).toHaveLength(2);
  });

  it("judges a build by its newest file, not its oldest", async () => {
    await seed("orphan");
    await backdate();
    // One file touched since. The build is being used by something, whatever
    // the conversation list says, so none of it is collected.
    await recordVersion(v("orphan", "body{color:red}", "styles.css"));

    expect(await sweepOrphanedBuilds(["alive"], { authoritative: true })).toMatchObject({
      conversations: 0,
    });
    expect(await listArtifactsForConversation("orphan")).toHaveLength(2);
  });

  it("refuses to run when the caller is not authoritative", async () => {
    await seed("orphan");
    await backdate();

    const result = await sweepOrphanedBuilds(["alive"], { authoritative: false });
    expect(result.skipped).toBe("not-authoritative");
    expect(result.conversations).toBe(0);
    expect(await listArtifactsForConversation("orphan")).toHaveLength(2);
  });

  it("refuses an empty conversation list, which is what a failed read looks like", async () => {
    await seed("orphan");
    await backdate();

    const result = await sweepOrphanedBuilds([], { authoritative: true });
    expect(result.skipped).toBe("no-conversations");
    expect(await listArtifactsForConversation("orphan")).toHaveLength(2);
  });

  it("collects several orphans in one pass", async () => {
    await seed("a");
    await seed("b");
    await seed("alive");
    await backdate();

    const result = await sweepOrphanedBuilds(["alive"], { authoritative: true });
    expect(result).toMatchObject({ conversations: 2, files: 4, versions: 6, storageRows: 2 });
    expect(await rawCounts()).toEqual({ artifacts: 2, versions: 3, storage: 1 });
  });

  it("collects an orphan's workspace too", async () => {
    const repo = await workspaceRepo();
    await repo.writeFile("orphan", "/workspace/index.html", "<p>one</p>");
    await seed("orphan");
    await seed("alive");
    await backdate();

    await sweepOrphanedBuilds(["alive"], { authoritative: true });
    expect((await repo.snapshot("orphan")).files).toHaveLength(0);
  });

  it("honours an explicit clock and grace period", async () => {
    await seed("orphan");
    await seed("alive");

    const result = await sweepOrphanedBuilds(["alive"], {
      authoritative: true,
      minAgeMs: 0,
      now: Date.now() + 1,
    });
    expect(result.conversations).toBe(1);
  });
});
