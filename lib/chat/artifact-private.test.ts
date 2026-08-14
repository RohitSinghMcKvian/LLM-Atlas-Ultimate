import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { resetIncognito, setIncognito } from "./incognito";
import { resetArtifactOverlay } from "./artifact-private";
import { ARTIFACTS, ARTIFACT_STORAGE, ARTIFACT_VERSIONS, getAll, openChatDb } from "./idb";
import {
  listArtifactsForConversation,
  listVersions,
  recordVersion,
  renameArtifact,
  resetArtifactDb,
  softDeleteArtifact,
  storageDelete,
  storageGet,
  storageList,
  storageSet,
} from "./artifact-repo";

/**
 * The guarantee under test is a privacy one: a build made in a temporary chat
 * must work for the length of the session and leave nothing on disk.
 *
 * So every assertion here is doubled — once through the repo (does the feature
 * still behave?) and once against the raw object stores (did anything actually
 * get written?). Checking only the repo would pass just as happily if the
 * overlay were removed and the writes went straight to IndexedDB, which is the
 * exact bug this exists to prevent.
 */
async function rawCounts(): Promise<{ artifacts: number; versions: number; storage: number }> {
  const d = await openChatDb();
  return {
    artifacts: (await getAll(d, ARTIFACTS)).length,
    versions: (await getAll(d, ARTIFACT_VERSIONS)).length,
    storage: (await getAll(d, ARTIFACT_STORAGE)).length,
  };
}

/**
 * Sorted, because `listArtifactsForConversation` orders by `createdAt` and two
 * files written in the same millisecond tie. Which of them comes back first is
 * not what any of these tests is about.
 */
async function paths(conversationId: string): Promise<string[]> {
  const rows = await listArtifactsForConversation(conversationId);
  return rows.map((r) => r.path ?? "").sort();
}

const v = (conversationId: string, code: string, path?: string) => ({
  conversationId,
  path,
  kind: "html" as const,
  lang: "html",
  title: "Page",
  code,
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetArtifactDb();
  resetIncognito();
});

afterEach(() => {
  resetIncognito();
  resetArtifactOverlay();
});

describe("incognito artifact writes", () => {
  it("keeps a build usable in the session without touching IndexedDB", async () => {
    setIncognito(true);

    await recordVersion(v("temp", "<p>one</p>"));
    const second = await recordVersion(v("temp", "<p>two</p>"));

    // The feature works: two versions, current pointer advanced.
    expect(second?.versionNumber).toBe(2);
    const files = await listArtifactsForConversation("temp");
    expect(files).toHaveLength(1);
    expect(files[0].currentVersion).toBe(2);
    expect(await listVersions(files[0].id)).toHaveLength(2);

    // And nothing was persisted.
    expect(await rawCounts()).toEqual({ artifacts: 0, versions: 0, storage: 0 });
  });

  it("keeps window.storage in memory too", async () => {
    setIncognito(true);
    const rec = await recordVersion(v("temp", "<p>one</p>"));
    const id = (await listArtifactsForConversation("temp"))[0].id;
    expect(rec).not.toBeNull();

    await storageSet(id, "score", 42);
    await storageSet(id, "name", "ada");
    expect(await storageGet(id, "score")).toBe(42);
    expect(await storageList(id)).toEqual(["name", "score"]);

    expect((await rawCounts()).storage).toBe(0);
  });

  it("forgets the whole build when incognito ends", async () => {
    setIncognito(true);
    await recordVersion(v("temp", "<p>one</p>"));
    expect(await listArtifactsForConversation("temp")).toHaveLength(1);

    setIncognito(false);
    expect(await listArtifactsForConversation("temp")).toHaveLength(0);
    expect(await rawCounts()).toEqual({ artifacts: 0, versions: 0, storage: 0 });
  });

  it("does not resurrect an earlier temporary build on re-entry", async () => {
    setIncognito(true);
    await recordVersion(v("temp", "<p>one</p>"));
    setIncognito(false);
    setIncognito(true);
    expect(await listArtifactsForConversation("temp")).toHaveLength(0);
  });
});

describe("incognito reads", () => {
  /**
   * Entering incognito must hide nothing that is already saved — the same rule
   * `repo-private.ts` sets for conversations. A build from before the mode was
   * turned on stays readable, and stays editable *in memory*.
   */
  it("still reads a build saved before the mode was turned on", async () => {
    await recordVersion(v("saved", "<p>one</p>"));
    const before = await rawCounts();

    setIncognito(true);
    const files = await listArtifactsForConversation("saved");
    expect(files).toHaveLength(1);
    expect(await listVersions(files[0].id)).toHaveLength(1);
    expect(await rawCounts()).toEqual(before);
  });

  it("applies an edit to a saved build in memory only, and rolls it back on exit", async () => {
    await recordVersion(v("saved", "<p>one</p>"));

    setIncognito(true);
    await recordVersion(v("saved", "<p>two</p>"));
    const id = (await listArtifactsForConversation("saved"))[0].id;
    // In-session: the new version is there, and the record it belongs to is the
    // updated one rather than a second row beside the stored copy.
    expect(await listVersions(id)).toHaveLength(2);
    expect((await listArtifactsForConversation("saved"))[0].currentVersion).toBe(2);
    expect((await rawCounts()).versions).toBe(1);

    setIncognito(false);
    expect(await listVersions(id)).toHaveLength(1);
    expect((await listArtifactsForConversation("saved"))[0].currentVersion).toBe(1);
  });

  it("hides a saved storage key deleted during incognito, then restores it", async () => {
    await recordVersion(v("saved", "<p>one</p>"));
    const id = (await listArtifactsForConversation("saved"))[0].id;
    await storageSet(id, "score", 7);

    setIncognito(true);
    await storageDelete(id, "score");
    expect(await storageGet(id, "score")).toBeUndefined();
    expect(await storageList(id)).toEqual([]);
    // The row is still on disk: incognito dropped the delete, it did not perform it.
    expect((await rawCounts()).storage).toBe(1);

    setIncognito(false);
    expect(await storageGet(id, "score")).toBe(7);
  });

  it("hides a saved file soft-deleted during incognito, then restores it", async () => {
    await recordVersion(v("saved", "<p>one</p>", "index.html"));
    await recordVersion(v("saved", "body{}", "styles.css"));

    setIncognito(true);
    expect(await softDeleteArtifact("saved", "styles.css")).toMatchObject({ ok: true });
    expect(await paths("saved")).toEqual(["index.html"]);

    setIncognito(false);
    expect(await paths("saved")).toEqual(["index.html", "styles.css"]);
  });

  it("renames a saved file in memory only", async () => {
    await recordVersion(v("saved", "<p>one</p>", "index.html"));

    setIncognito(true);
    expect(await renameArtifact("saved", "index.html", "home.html")).toMatchObject({ ok: true });
    expect(await paths("saved")).toEqual(["home.html"]);

    setIncognito(false);
    expect(await paths("saved")).toEqual(["index.html"]);
  });
});

describe("normal mode", () => {
  it("is unaffected — writes still land in IndexedDB", async () => {
    await recordVersion(v("c1", "<p>one</p>"));
    const id = (await listArtifactsForConversation("c1"))[0].id;
    await storageSet(id, "k", 1);
    expect(await rawCounts()).toEqual({ artifacts: 1, versions: 1, storage: 1 });
  });
});
