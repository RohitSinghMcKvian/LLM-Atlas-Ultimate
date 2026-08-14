import { describe, it, expect, beforeEach } from "vitest";
import {
  fsCommandSchema,
  fsDirectoryBlock,
  resolveConfinedPath,
  runFsCommand,
  type FsFile,
  type FsLimits,
  type FsStore,
} from "./fs-commands";
import { z } from "zod";

/**
 * What `memory-fs.test.ts` does not cover.
 *
 * The six shared commands are exercised there against `/memories`, and moving
 * them here would duplicate 300 lines to test the same code. This file covers
 * what the generalisation added: a second root, `append`, the whole-store byte
 * ceiling, and the fact that `append` must be refused where it was not offered.
 */

const ROOT = "/workspace";

const LIMITS: FsLimits = {
  root: ROOT,
  maxFileBytes: 1024,
  maxFiles: 4,
  maxTotalBytes: 2048,
  allowAppend: true,
};

function fakeStore(seed: Record<string, string> = {}) {
  const files = new Map<string, FsFile>();
  for (const [path, text] of Object.entries(seed)) files.set(path, { path, text, updatedAt: 1 });
  const store: FsStore = {
    async list() {
      return [...files.values()];
    },
    async read(path) {
      return files.get(path);
    },
    async write(path, text) {
      files.set(path, { path, text, updatedAt: Date.now() });
    },
    async remove(path) {
      files.delete(path);
    },
  };
  return { store, files };
}

describe("resolveConfinedPath under a second root", () => {
  it("accepts paths inside /workspace", () => {
    expect(resolveConfinedPath("/workspace/index.html", ROOT)).toEqual({
      path: "/workspace/index.html",
    });
    expect(resolveConfinedPath("/workspace/src/App.jsx", ROOT)).toEqual({
      path: "/workspace/src/App.jsx",
    });
  });

  // The whole reason the check is shared rather than copied.
  it.each([
    "/workspace/../atlas-keys",
    "/workspace/../../etc/passwd",
    "/workspace/a/../../outside",
    "/memories/notes.md",
    "/workspacebutnot/x",
  ])("rejects %s", (bad) => {
    expect(resolveConfinedPath(bad, ROOT)).toHaveProperty("error");
  });

  it("rejects control characters, including an embedded NUL", () => {
    expect(resolveConfinedPath("/workspace/x\u0000.html", ROOT)).toHaveProperty("error");
    expect(resolveConfinedPath("/workspace/x\n.html", ROOT)).toHaveProperty("error");
    expect(resolveConfinedPath("/workspace/x\u007f.html", ROOT)).toHaveProperty("error");
  });

  it("keeps the two roots isolated from each other", () => {
    expect(resolveConfinedPath("/workspace/x", "/memories")).toHaveProperty("error");
    expect(resolveConfinedPath("/memories/x", ROOT)).toHaveProperty("error");
  });
});

describe("fsCommandSchema", () => {
  it("renders as a flat object even with append, not an anyOf", () => {
    const json = z.toJSONSchema(fsCommandSchema({ root: ROOT, maxFileBytes: 10, append: true }), {
      io: "input",
    }) as { type?: string; anyOf?: unknown; properties?: Record<string, unknown>; required?: string[] };
    expect(json.type).toBe("object");
    expect(json.anyOf).toBeUndefined();
    expect(json.properties).toHaveProperty("append_text");
    expect(json.required).toEqual(["command"]);
  });

  it("omits append_text when the root does not allow appending", () => {
    const json = z.toJSONSchema(fsCommandSchema({ root: "/memories", maxFileBytes: 10 }), {
      io: "input",
    }) as { properties?: Record<string, unknown> };
    expect(json.properties).not.toHaveProperty("append_text");
  });
});

describe("append", () => {
  let ctx: ReturnType<typeof fakeStore>;
  beforeEach(() => {
    ctx = fakeStore();
  });
  const run = (input: Parameters<typeof runFsCommand>[0]) => runFsCommand(input, ctx.store, LIMITS);

  it("creates the file when it does not exist yet", async () => {
    const r = await run({ command: "append", path: "/workspace/a.html", append_text: "<h1>hi" });
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("Created");
    expect(ctx.files.get("/workspace/a.html")?.text).toBe("<h1>hi");
  });

  // The point of the command: a file assembled across several turns.
  it("concatenates chunks with no separator inserted", async () => {
    await run({ command: "append", path: "/workspace/a.js", append_text: "const a = 1;\n" });
    await run({ command: "append", path: "/workspace/a.js", append_text: "const b = 2;\n" });
    expect(ctx.files.get("/workspace/a.js")?.text).toBe("const a = 1;\nconst b = 2;\n");
  });

  // Raw concatenation is deliberate: a chunk may continue the previous line
  // mid-statement, and a helpfully-inserted newline would corrupt it.
  it("does not add a newline between chunks", async () => {
    await run({ command: "append", path: "/workspace/a.js", append_text: "const x = [1," });
    await run({ command: "append", path: "/workspace/a.js", append_text: "2];" });
    expect(ctx.files.get("/workspace/a.js")?.text).toBe("const x = [1,2];");
  });

  it("reports the running line count so the model can track progress", async () => {
    const r = await run({ command: "append", path: "/workspace/a.txt", append_text: "1\n2\n3" });
    expect(r.content).toContain("3 lines");
  });

  it("requires append_text and names it", async () => {
    const r = await run({ command: "append", path: "/workspace/a.txt" });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("append_text");
  });

  it("refuses the root itself", async () => {
    const r = await run({ command: "append", path: ROOT, append_text: "x" });
    expect(r.isError).toBe(true);
  });

  it("validates the path before touching the store", async () => {
    const r = await run({ command: "append", path: "/workspace/../evil", append_text: "x" });
    expect(r.isError).toBe(true);
    expect(ctx.files.size).toBe(0);
  });

  it("is refused where the root did not offer it", async () => {
    const noAppend: FsLimits = { ...LIMITS, allowAppend: false };
    const r = await runFsCommand(
      { command: "append", path: "/workspace/a.txt", append_text: "x" },
      ctx.store,
      noAppend,
    );
    expect(r.isError).toBe(true);
    expect(ctx.files.size).toBe(0);
  });

  it("still enforces the per-file ceiling as the file grows", async () => {
    await run({ command: "append", path: "/workspace/a.txt", append_text: "a".repeat(1000) });
    const r = await run({ command: "append", path: "/workspace/a.txt", append_text: "b".repeat(100) });
    expect(r.isError).toBe(true);
    expect(ctx.files.get("/workspace/a.txt")?.text.length).toBe(1000);
  });
});

describe("whole-store byte ceiling", () => {
  let ctx: ReturnType<typeof fakeStore>;
  beforeEach(() => {
    ctx = fakeStore();
  });
  const run = (input: Parameters<typeof runFsCommand>[0]) => runFsCommand(input, ctx.store, LIMITS);

  it("rejects a write that would push the store over its total", async () => {
    await run({ command: "create", path: "/workspace/a", file_text: "a".repeat(1000) });
    await run({ command: "create", path: "/workspace/b", file_text: "b".repeat(1000) });
    const r = await run({ command: "create", path: "/workspace/c", file_text: "c".repeat(500) });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("budget");
    expect(ctx.files.has("/workspace/c")).toBe(false);
  });

  // Counting the file being replaced would reject an edit for the size it used
  // to be, which makes a full store impossible to shrink from.
  it("does not count the file being overwritten against the total", async () => {
    await run({ command: "create", path: "/workspace/a", file_text: "a".repeat(1500) });
    const r = await run({ command: "create", path: "/workspace/a", file_text: "a".repeat(900) });
    expect(r.isError).toBeUndefined();
    expect(ctx.files.get("/workspace/a")?.text.length).toBe(900);
  });

  it("applies to append as well as create", async () => {
    // 1000 + 1000 already stored; a third file of 100 would reach 2100, past the
    // 2048 total. Deliberately a new file: appending to an existing one hits the
    // 1024 per-file cap first, so it would not exercise the total.
    await run({ command: "create", path: "/workspace/a", file_text: "a".repeat(1000) });
    await run({ command: "create", path: "/workspace/b", file_text: "b".repeat(1000) });
    const r = await run({ command: "append", path: "/workspace/c", append_text: "c".repeat(100) });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("budget");
    expect(ctx.files.has("/workspace/c")).toBe(false);
  });

  it("is not enforced when the root sets no total", async () => {
    const unbounded: FsLimits = { ...LIMITS, maxTotalBytes: undefined };
    await runFsCommand(
      { command: "create", path: "/workspace/a", file_text: "a".repeat(1000) },
      ctx.store,
      unbounded,
    );
    const r = await runFsCommand(
      { command: "create", path: "/workspace/b", file_text: "b".repeat(1000) },
      ctx.store,
      unbounded,
    );
    expect(r.isError).toBeUndefined();
  });
});

describe("fsDirectoryBlock", () => {
  it("is empty with no files, so the prompt gains nothing", () => {
    expect(fsDirectoryBlock([], { lead: "Files:" })).toBe("");
  });

  it("lists paths and sizes but never contents", () => {
    const block = fsDirectoryBlock([{ path: "/workspace/a", text: "SECRET", updatedAt: 1 }], {
      lead: "Files:",
    });
    expect(block).toContain("/workspace/a");
    expect(block).not.toContain("SECRET");
  });

  // The block is sent on every request, so it must not grow with the store.
  it("caps the listing and says how many were omitted", () => {
    const many: FsFile[] = Array.from({ length: 200 }, (_, i) => ({
      path: `/workspace/f${String(i).padStart(3, "0")}`,
      text: "x",
      updatedAt: 1,
    }));
    const block = fsDirectoryBlock(many, { lead: "Files:", maxEntries: 10 });
    expect(block.split("\n")).toHaveLength(12); // lead + 10 entries + the remainder line
    expect(block).toContain("and 190 more");
  });
});
