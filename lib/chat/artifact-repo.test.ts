import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import {
  DEFAULT_PATH,
  getArtifactByPath,
  getArtifactForConversation,
  listArtifactsForConversation,
  pathOf,
  listVersions,
  recordVersion,
  renameArtifact,
  resetArtifactDb,
  revertToVersion,
  softDeleteArtifact,
  storageDelete,
  storageGet,
  storageList,
  storageSet,
} from "./artifact-repo";

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
  resetArtifactDb();
  globalThis.localStorage = fakeLocalStorage();
});

const v = (code: string, messageId?: string) => ({
  conversationId: "c1",
  messageId,
  kind: "html" as const,
  lang: "html",
  title: "Page",
  code,
});

describe("recordVersion", () => {
  it("creates the artifact on first version", async () => {
    const rec = await recordVersion(v("<p>one</p>", "m1"));
    expect(rec?.versionNumber).toBe(1);
    const art = await getArtifactForConversation("c1");
    expect(art).toMatchObject({ conversationId: "c1", currentVersion: 1, kind: "html" });
  });

  it("appends v2 and advances the current pointer", async () => {
    await recordVersion(v("<p>one</p>", "m1"));
    const second = await recordVersion(v("<p>two</p>", "m2"));
    expect(second?.versionNumber).toBe(2);
    expect((await getArtifactForConversation("c1"))?.currentVersion).toBe(2);
    expect((await listVersions(second!.artifactId)).map((x) => x.code)).toEqual([
      "<p>one</p>",
      "<p>two</p>",
    ]);
  });

  it("reuses one artifact per conversation", async () => {
    await recordVersion(v("<p>one</p>", "m1"));
    const a1 = await getArtifactForConversation("c1");
    await recordVersion(v("<p>two</p>", "m2"));
    const a2 = await getArtifactForConversation("c1");
    expect(a2!.id).toBe(a1!.id);
  });

  it("keeps separate conversations separate", async () => {
    await recordVersion(v("<p>one</p>", "m1"));
    await recordVersion({ ...v("<p>other</p>", "m9"), conversationId: "c2" });
    const a = await getArtifactForConversation("c1");
    const b = await getArtifactForConversation("c2");
    expect(a!.id).not.toBe(b!.id);
    expect(await listVersions(a!.id)).toHaveLength(1);
    expect(await listVersions(b!.id)).toHaveLength(1);
  });

  // This is the important idempotency case: the persist path can run more than
  // once for the same turn, and must not inflate the history.
  it("does not duplicate when the same message is recorded twice", async () => {
    const first = await recordVersion(v("<p>one</p>", "m1"));
    const again = await recordVersion(v("<p>one</p>", "m1"));
    expect(again!.id).toBe(first!.id);
    expect(await listVersions(first!.artifactId)).toHaveLength(1);
  });

  it("updates in place when a turn is regenerated with new code", async () => {
    const first = await recordVersion(v("<p>one</p>", "m1"));
    const edited = await recordVersion(v("<p>edited</p>", "m1"));
    expect(edited!.id).toBe(first!.id);
    expect(edited!.versionNumber).toBe(1);
    const all = await listVersions(first!.artifactId);
    expect(all).toHaveLength(1);
    expect(all[0].code).toBe("<p>edited</p>");
  });

  it("ignores an identical re-record with no message id", async () => {
    await recordVersion(v("<p>same</p>"));
    await recordVersion(v("<p>same</p>"));
    const art = await getArtifactForConversation("c1");
    expect(await listVersions(art!.id)).toHaveLength(1);
  });

  it("tracks the artifact kind as it changes", async () => {
    await recordVersion(v("<p>html</p>", "m1"));
    await recordVersion({ ...v("const A=1", "m2"), kind: "react", lang: "jsx", title: "Comp" });
    const art = await getArtifactForConversation("c1");
    expect(art).toMatchObject({ kind: "react", title: "Comp" });
  });

  it("returns null for a conversation with no artifact", async () => {
    expect(await getArtifactForConversation("nope")).toBeNull();
  });
});

describe("revertToVersion", () => {
  it("moves the pointer back without destroying later versions", async () => {
    await recordVersion(v("<p>one</p>", "m1"));
    const second = await recordVersion(v("<p>two</p>", "m2"));
    const art = await revertToVersion(second!.artifactId, 1);
    expect(art?.currentVersion).toBe(1);
    // v2 must still be recoverable — revert is not delete.
    expect(await listVersions(second!.artifactId)).toHaveLength(2);
  });

  it("ignores a version number that doesn't exist", async () => {
    const first = await recordVersion(v("<p>one</p>", "m1"));
    const art = await revertToVersion(first!.artifactId, 99);
    expect(art?.currentVersion).toBe(1);
  });

  it("returns null for an unknown artifact", async () => {
    expect(await revertToVersion("ghost", 1)).toBeNull();
  });
});

describe("window.storage backend", () => {
  const A = "artifact-a";
  const B = "artifact-b";

  it("round-trips a value", async () => {
    await storageSet(A, "score", 42);
    expect(await storageGet(A, "score")).toBe(42);
  });

  it("stores structured values", async () => {
    const value = { items: [1, 2, 3], nested: { ok: true } };
    await storageSet(A, "state", value);
    expect(await storageGet(A, "state")).toEqual(value);
  });

  it("overwrites on repeated set", async () => {
    await storageSet(A, "k", "first");
    await storageSet(A, "k", "second");
    expect(await storageGet(A, "k")).toBe("second");
    expect(await storageList(A)).toEqual(["k"]);
  });

  it("returns undefined for a missing key", async () => {
    expect(await storageGet(A, "absent")).toBeUndefined();
  });

  it("deletes", async () => {
    await storageSet(A, "k", 1);
    await storageDelete(A, "k");
    expect(await storageGet(A, "k")).toBeUndefined();
    expect(await storageList(A)).toEqual([]);
  });

  it("lists keys sorted", async () => {
    await storageSet(A, "c", 1);
    await storageSet(A, "a", 1);
    await storageSet(A, "b", 1);
    expect(await storageList(A)).toEqual(["a", "b", "c"]);
  });

  it("filters by prefix", async () => {
    await storageSet(A, "todo:1", 1);
    await storageSet(A, "todo:2", 1);
    await storageSet(A, "meta", 1);
    expect(await storageList(A, "todo:")).toEqual(["todo:1", "todo:2"]);
  });

  // Namespacing is a security property: one artifact must not read another's data.
  it("isolates artifacts from each other", async () => {
    await storageSet(A, "secret", "a-value");
    await storageSet(B, "secret", "b-value");
    expect(await storageGet(A, "secret")).toBe("a-value");
    expect(await storageGet(B, "secret")).toBe("b-value");
    expect(await storageList(A)).toEqual(["secret"]);
  });

  it("deleting in one artifact leaves the other intact", async () => {
    await storageSet(A, "k", 1);
    await storageSet(B, "k", 2);
    await storageDelete(A, "k");
    expect(await storageGet(B, "k")).toBe(2);
  });
});

/**
 * Several artifacts in one conversation.
 *
 * 0007 allowed exactly one, so a second deliverable became version N+1 of the
 * first. These cover the new identity — (conversation, path) — and the one
 * property the migration must not break: an existing artifact keeps its id, and
 * therefore keeps whatever `window.storage` wrote against it.
 */
describe("multi-artifact by path", () => {
  const at = (path: string | undefined, code: string, messageId?: string) => ({
    conversationId: "c1",
    messageId,
    path,
    kind: "html" as const,
    lang: "html",
    title: path ?? "Artifact",
    code,
  });

  it("keeps a separate history per path", async () => {
    await recordVersion(at("index.html", "<h1>one</h1>"));
    await recordVersion(at("index.html", "<h1>two</h1>"));
    await recordVersion(at("styles.css", "body{}"));

    const files = await listArtifactsForConversation("c1");
    expect(files.map(pathOf).sort()).toEqual(["index.html", "styles.css"]);

    const page = await getArtifactByPath("c1", "index.html");
    const css = await getArtifactByPath("c1", "styles.css");
    expect((await listVersions(page!.id)).map((v) => v.code)).toEqual([
      "<h1>one</h1>",
      "<h1>two</h1>",
    ]);
    expect(await listVersions(css!.id)).toHaveLength(1);
  });

  it("treats an artifact with no path as the default document", async () => {
    await recordVersion(at(undefined, "<h1>x</h1>"));
    const rec = await getArtifactByPath("c1");
    expect(rec).not.toBeNull();
    expect(pathOf(rec!)).toBe(DEFAULT_PATH);
  });

  // The single-artifact case has to be untouched by all of this.
  it("still collapses repeated unnamed writes into one history", async () => {
    await recordVersion(at(undefined, "a"));
    await recordVersion(at(undefined, "b"));
    const files = await listArtifactsForConversation("c1");
    expect(files).toHaveLength(1);
    expect(await listVersions(files[0].id)).toHaveLength(2);
  });

  // R9: artifact_storage is keyed by artifact id. Re-identifying a backfilled
  // artifact would silently orphan whatever the page had saved.
  it("preserves the id — and the window.storage data — when backfilling a path", async () => {
    await recordVersion(at(undefined, "<h1>original</h1>"));
    const before = (await listArtifactsForConversation("c1"))[0];
    await storageSet(before.id, "draft", { title: "kept" });

    // A later turn names the same default file explicitly.
    await recordVersion(at(DEFAULT_PATH, "<h1>edited</h1>"));

    const after = (await listArtifactsForConversation("c1"))[0];
    expect(after.id).toBe(before.id);
    expect(pathOf(after)).toBe(DEFAULT_PATH);
    expect(await storageGet(after.id, "draft")).toEqual({ title: "kept" });
    expect(await listArtifactsForConversation("c1")).toHaveLength(1);
  });

  it("reverts one file without touching another", async () => {
    await recordVersion(at("index.html", "v1"));
    await recordVersion(at("index.html", "v2"));
    await recordVersion(at("styles.css", "css1"));

    const page = await getArtifactByPath("c1", "index.html");
    await revertToVersion(page!.id, 1);

    expect((await getArtifactByPath("c1", "index.html"))!.currentVersion).toBe(1);
    expect((await getArtifactByPath("c1", "styles.css"))!.currentVersion).toBe(1);
    // Reverting never deletes: v2 is still recoverable.
    expect(await listVersions(page!.id)).toHaveLength(2);
  });

  it("keeps two conversations apart", async () => {
    await recordVersion(at("index.html", "one"));
    await recordVersion({ ...at("index.html", "two"), conversationId: "c2" });
    expect(await listArtifactsForConversation("c1")).toHaveLength(1);
    expect(await listArtifactsForConversation("c2")).toHaveLength(1);
  });

  // ── delete and rename (§P15) ───────────────────────────────────────────────
  // Both keep the record's id, because `artifact_storage` and every version row
  // are keyed by it. Losing it is how a rename silently becomes data loss.

  describe("removing and moving a file", () => {
    it("hides a deleted file from the listing", async () => {
      await recordVersion(at("index.html", "page"));
      await recordVersion(at("styles.css", "css"));

      expect(await softDeleteArtifact("c1", "styles.css")).toMatchObject({ ok: true });
      const live = await listArtifactsForConversation("c1");
      expect(live.map(pathOf)).toEqual(["index.html"]);
    });

    it("keeps the record, its versions and its storage", async () => {
      await recordVersion(at("index.html", "page"));
      await recordVersion(at("styles.css", "v1"));
      await recordVersion(at("styles.css", "v2"));
      const css = (await getArtifactByPath("c1", "styles.css"))!;
      await storageSet(css.id, "draft", { keep: true });

      await softDeleteArtifact("c1", "styles.css");

      const all = await listArtifactsForConversation("c1", { includeDeleted: true });
      const still = all.find((r) => pathOf(r) === "styles.css")!;
      expect(still.id).toBe(css.id);
      expect(await listVersions(css.id)).toHaveLength(2);
      expect(await storageGet(css.id, "draft")).toEqual({ keep: true });
    });

    it("brings a deleted file back on the same id when it is written again", async () => {
      await recordVersion(at("index.html", "page"));
      await recordVersion(at("styles.css", "v1"));
      const before = (await getArtifactByPath("c1", "styles.css"))!;
      await storageSet(before.id, "draft", { keep: true });
      await softDeleteArtifact("c1", "styles.css");

      await recordVersion(at("styles.css", "v2"));

      const after = (await getArtifactByPath("c1", "styles.css"))!;
      expect(after.id).toBe(before.id);
      expect(after.deletedAt).toBeUndefined();
      // Continuous history, not a fresh file that happens to share a name.
      expect(await listVersions(after.id)).toHaveLength(2);
      expect(await storageGet(after.id, "draft")).toEqual({ keep: true });
    });

    it("refuses to remove the only file", async () => {
      await recordVersion(at("index.html", "page"));
      expect(await softDeleteArtifact("c1", "index.html")).toEqual({
        ok: false,
        reason: "last-file",
      });
      expect(await listArtifactsForConversation("c1")).toHaveLength(1);
    });

    it("reports a path that is not there", async () => {
      await recordVersion(at("index.html", "page"));
      await recordVersion(at("styles.css", "css"));
      expect(await softDeleteArtifact("c1", "nope.js")).toEqual({ ok: false, reason: "missing" });
    });

    it("renames in place, keeping the id, history and storage", async () => {
      await recordVersion(at("src/App.jsx", "v1"));
      await recordVersion(at("src/App.jsx", "v2"));
      const before = (await getArtifactByPath("c1", "src/App.jsx"))!;
      await storageSet(before.id, "draft", { keep: true });

      expect(await renameArtifact("c1", "src/App.jsx", "src/Main.jsx")).toMatchObject({ ok: true });

      expect(await getArtifactByPath("c1", "src/App.jsx")).toBeNull();
      const after = (await getArtifactByPath("c1", "src/Main.jsx"))!;
      expect(after.id).toBe(before.id);
      expect(await listVersions(after.id)).toHaveLength(2);
      expect(await storageGet(after.id, "draft")).toEqual({ keep: true });
    });

    it("refuses to rename onto a path that exists", async () => {
      await recordVersion(at("index.html", "page"));
      await recordVersion(at("styles.css", "css"));
      expect(await renameArtifact("c1", "styles.css", "index.html")).toEqual({
        ok: false,
        reason: "occupied",
      });
      expect((await getArtifactByPath("c1", "index.html"))!.currentVersion).toBe(1);
    });

    it("refuses to rename onto a deleted path", async () => {
      // The record is still there holding that name, and reviving it by rename
      // would be a second, less obvious way to undelete.
      await recordVersion(at("index.html", "page"));
      await recordVersion(at("old.css", "css"));
      await recordVersion(at("new.css", "css2"));
      await softDeleteArtifact("c1", "old.css");
      expect(await renameArtifact("c1", "new.css", "old.css")).toEqual({
        ok: false,
        reason: "occupied",
      });
    });

    it("renaming a path that is not there is a miss, not a create", async () => {
      await recordVersion(at("index.html", "page"));
      expect(await renameArtifact("c1", "ghost.css", "real.css")).toEqual({
        ok: false,
        reason: "missing",
      });
      expect(await listArtifactsForConversation("c1")).toHaveLength(1);
    });

    it("treats a rename to the same path as a no-op", async () => {
      await recordVersion(at("index.html", "page"));
      expect(await renameArtifact("c1", "index.html", "index.html")).toMatchObject({ ok: true });
      expect(await listArtifactsForConversation("c1")).toHaveLength(1);
    });
  });
});
