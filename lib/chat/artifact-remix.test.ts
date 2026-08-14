import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { copyBuild, hasBuild } from "./artifact-remix";
import {
  listArtifactsForConversation,
  listVersions,
  pathOf,
  recordVersion,
  renameArtifact,
  resetArtifactDb,
  softDeleteArtifact,
  storageGet,
  storageList,
  storageSet,
} from "./artifact-repo";
import { resetIncognito, setIncognito } from "./incognito";
import { resetWorkspaceRepo, workspaceRepo } from "./workspace/repo";
import { resetWorkspaceDb } from "./workspace/repo-idb";

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

const v = (conversationId: string, code: string, path?: string, messageId?: string) => ({
  conversationId,
  path,
  messageId,
  kind: "html" as const,
  lang: "html",
  title: path ?? "Page",
  code,
});

async function byPath(conversationId: string) {
  const rows = await listArtifactsForConversation(conversationId);
  return new Map(rows.map((r) => [pathOf(r), r]));
}

describe("copyBuild", () => {
  it("copies every file with its full version history", async () => {
    await recordVersion(v("a", "<p>one</p>", "index.html", "m1"));
    await recordVersion(v("a", "<p>two</p>", "index.html", "m2"));
    await recordVersion(v("a", "body{}", "styles.css", "m3"));

    const result = await copyBuild("a", "b");
    expect(result).toMatchObject({ files: 2, versions: 3 });

    const copies = await byPath("b");
    expect([...copies.keys()].sort()).toEqual(["index.html", "styles.css"]);
    const page = copies.get("index.html")!;
    expect(page.currentVersion).toBe(2);
    const versions = await listVersions(page.id);
    expect(versions.map((x) => x.versionNumber)).toEqual([1, 2]);
    expect(versions.map((x) => x.code)).toEqual(["<p>one</p>", "<p>two</p>"]);
  });

  it("gives the copy its own ids so the two builds never write over each other", async () => {
    await recordVersion(v("a", "<p>one</p>", "index.html"));
    const original = (await byPath("a")).get("index.html")!;
    await storageSet(original.id, "score", 1);

    await copyBuild("a", "b");
    const copy = (await byPath("b")).get("index.html")!;
    expect(copy.id).not.toBe(original.id);

    // Writing through the copy leaves the original alone.
    await storageSet(copy.id, "score", 99);
    expect(await storageGet(original.id, "score")).toBe(1);
    expect(await storageGet(copy.id, "score")).toBe(99);
  });

  it("carries the page's saved storage across", async () => {
    await recordVersion(v("a", "<p>one</p>", "index.html"));
    const original = (await byPath("a")).get("index.html")!;
    await storageSet(original.id, "todos", ["milk"]);
    await storageSet(original.id, "theme", "dark");

    const result = await copyBuild("a", "b");
    expect(result.storageRows).toBe(2);

    const copy = (await byPath("b")).get("index.html")!;
    expect(await storageList(copy.id)).toEqual(["theme", "todos"]);
    expect(await storageGet(copy.id, "todos")).toEqual(["milk"]);
  });

  it("drops messageId, so a copied version is not mistaken for the same turn", async () => {
    await recordVersion(v("a", "<p>one</p>", "index.html", "m1"));
    await copyBuild("a", "b");
    const copy = (await byPath("b")).get("index.html")!;
    expect((await listVersions(copy.id))[0].messageId).toBeUndefined();

    // The proof it matters: recording under the source's message id appends
    // rather than overwriting the copied version.
    await recordVersion(v("b", "<p>changed</p>", "index.html", "m1"));
    expect(await listVersions(copy.id)).toHaveLength(2);
  });

  it("does not copy a deleted file", async () => {
    await recordVersion(v("a", "<p>one</p>", "index.html"));
    await recordVersion(v("a", "body{}", "styles.css"));
    expect(await softDeleteArtifact("a", "styles.css")).toMatchObject({ ok: true });

    const result = await copyBuild("a", "b");
    expect(result.files).toBe(1);
    expect([...(await byPath("b")).keys()]).toEqual(["index.html"]);
  });

  it("copies a renamed file under its current path", async () => {
    await recordVersion(v("a", "<p>one</p>", "index.html"));
    await recordVersion(v("a", "body{}", "styles.css"));
    expect(await renameArtifact("a", "styles.css", "css/main.css")).toMatchObject({ ok: true });

    await copyBuild("a", "b");
    expect([...(await byPath("b")).keys()].sort()).toEqual(["css/main.css", "index.html"]);
  });

  it("keeps the file order the panel shows", async () => {
    await recordVersion(v("a", "<p>one</p>", "index.html"));
    await new Promise((r) => setTimeout(r, 2));
    await recordVersion(v("a", "body{}", "styles.css"));
    await new Promise((r) => setTimeout(r, 2));
    await recordVersion(v("a", "//", "app.js"));

    const before = (await listArtifactsForConversation("a")).map(pathOf);
    await copyBuild("a", "b");
    expect((await listArtifactsForConversation("b")).map(pathOf)).toEqual(before);
  });

  it("skips a path the destination already has rather than overwriting it", async () => {
    await recordVersion(v("a", "<p>source</p>", "index.html"));
    await recordVersion(v("b", "<p>destination</p>", "index.html"));

    const result = await copyBuild("a", "b");
    expect(result.files).toBe(0);
    const kept = (await byPath("b")).get("index.html")!;
    expect((await listVersions(kept.id))[0].code).toBe("<p>destination</p>");
  });

  it("refuses to copy a conversation onto itself", async () => {
    await recordVersion(v("a", "<p>one</p>", "index.html"));
    expect(await copyBuild("a", "a")).toMatchObject({ files: 0, versions: 0 });
    expect((await byPath("a")).size).toBe(1);
  });

  it("is a no-op when there is no build", async () => {
    expect(await hasBuild("a")).toBe(false);
    expect(await copyBuild("a", "b")).toMatchObject({ files: 0, versions: 0, storageRows: 0 });
  });
});

describe("copyBuild and the workspace", () => {
  it("copies the files, the ledger and the goal", async () => {
    const repo = await workspaceRepo();
    await repo.writeFile("a", "/workspace/index.html", "<p>one</p>");
    await repo.writeFile("a", "/workspace/app.js", "console.log(1)");
    await repo.setGoal("a", "A landing page");
    await repo.replaceTasks("a", [
      { id: "t1", conversationId: "a", title: "Write the page", status: "done", order: 0 },
      { id: "t2", conversationId: "a", title: "Style it", status: "pending", order: 1 },
    ]);
    await recordVersion(v("a", "<p>one</p>", "index.html"));

    const result = await copyBuild("a", "b");
    expect(result).toMatchObject({ workspaceFiles: 2, tasks: 2 });

    const snap = await repo.snapshot("b");
    expect(snap.files.map((f) => f.path).sort()).toEqual([
      "/workspace/app.js",
      "/workspace/index.html",
    ]);
    expect(snap.goal).toBe("A landing page");
    // The ledger keeps its statuses: the work really is done in the copy.
    expect(snap.tasks.map((t) => t.status)).toEqual(["done", "pending"]);
    // ...under this conversation's own task ids.
    expect(snap.tasks.every((t) => t.conversationId === "b")).toBe(true);
    expect(snap.tasks.map((t) => t.id)).not.toEqual(["t1", "t2"]);
  });

  it("copies the workspace even when the artifact half has nothing to do", async () => {
    const repo = await workspaceRepo();
    await repo.writeFile("a", "/workspace/index.html", "<p>one</p>");
    expect(await copyBuild("a", "b")).toMatchObject({ files: 0, workspaceFiles: 1 });
  });
});

describe("copyBuild in incognito", () => {
  it("reports the workspace as uncopied, because that repo drops the writes", async () => {
    const repo = await workspaceRepo();
    await repo.writeFile("a", "/workspace/index.html", "<p>one</p>");
    await recordVersion(v("a", "<p>one</p>", "index.html"));

    setIncognito(true);
    const result = await copyBuild("a", "b");
    // The artifacts land in the session overlay and are usable...
    expect(result.files).toBe(1);
    expect((await byPath("b")).size).toBe(1);
    // ...and the count does not claim a workspace copy that never happened.
    expect(result.workspaceFiles).toBe(0);
  });

  it("leaves nothing behind once incognito ends", async () => {
    await recordVersion(v("a", "<p>one</p>", "index.html"));
    setIncognito(true);
    await copyBuild("a", "b");
    expect((await byPath("b")).size).toBe(1);

    setIncognito(false);
    expect((await byPath("b")).size).toBe(0);
    // The source is untouched by any of it.
    expect((await byPath("a")).size).toBe(1);
  });
});
