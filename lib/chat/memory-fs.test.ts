import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import {
  MEMORY_ROOT,
  MAX_FILES,
  MAX_FILE_BYTES,
  MEMORY_COMMANDS,
  memoryCommandSchema,
  memoryDirectoryBlock,
  resolveMemoryPath,
  runMemoryCommand,
  type MemoryFile,
  type MemoryFsStore,
} from "./memory-fs";

/** In-memory MemoryFsStore, so the command layer is tested on its own. */
function fakeStore(seed: Record<string, string> = {}) {
  const files = new Map<string, MemoryFile>();
  for (const [path, text] of Object.entries(seed)) {
    files.set(path, { path, text, updatedAt: 1 });
  }
  const store: MemoryFsStore = {
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

describe("resolveMemoryPath", () => {
  it("accepts paths inside the memory root", () => {
    expect(resolveMemoryPath("/memories/notes.md")).toEqual({
      path: "/memories/notes.md",
    });
    expect(resolveMemoryPath("/memories/a/b/c.md")).toEqual({
      path: "/memories/a/b/c.md",
    });
  });

  it("accepts the root itself", () => {
    expect(resolveMemoryPath(MEMORY_ROOT)).toEqual({ path: MEMORY_ROOT });
    // A trailing slash normalises to the root, not to an empty-named child.
    expect(resolveMemoryPath("/memories/")).toEqual({ path: MEMORY_ROOT });
  });

  it("collapses redundant separators and dot segments", () => {
    expect(resolveMemoryPath("/memories//a///b.md")).toEqual({
      path: "/memories/a/b.md",
    });
    expect(resolveMemoryPath("/memories/./a/./b.md")).toEqual({
      path: "/memories/a/b.md",
    });
  });

  // The security boundary: the model picks these strings, so traversal must fail
  // closed. Normalisation happens before the prefix check, so a `..` cannot
  // sneak past a naive startsWith.
  it.each([
    "/memories/../secret",
    "/memories/../../etc/passwd",
    "/memories/a/../../outside.md",
    "/../memories/x",
    "/etc/passwd",
    "/memorie",
    "/memoriesbutnot/x.md",
  ])("rejects %s", (bad) => {
    const r = resolveMemoryPath(bad);
    expect(r).toHaveProperty("error");
  });

  it("resolves an interior .. that stays inside the root", () => {
    // Not an escape: it lands back under /memories, so it is allowed.
    expect(resolveMemoryPath("/memories/a/../b.md")).toEqual({
      path: "/memories/b.md",
    });
  });

  it("rejects relative paths", () => {
    expect(resolveMemoryPath("memories/x.md")).toHaveProperty("error");
    expect(resolveMemoryPath("notes.md")).toHaveProperty("error");
  });

  it("rejects backslashes rather than translating them", () => {
    expect(resolveMemoryPath("\\memories\\x.md")).toHaveProperty("error");
    expect(resolveMemoryPath("/memories/a\\b.md")).toHaveProperty("error");
  });

  it("rejects control characters, including an embedded NUL", () => {
    expect(resolveMemoryPath("/memories/x\u0000.md")).toHaveProperty("error");
    expect(resolveMemoryPath("/memories/x\n.md")).toHaveProperty("error");
  });

  it("rejects empty input", () => {
    expect(resolveMemoryPath("")).toHaveProperty("error");
    expect(resolveMemoryPath("   ")).toHaveProperty("error");
  });
});

describe("memoryCommandSchema", () => {
  it("covers exactly the six documented commands", () => {
    expect([...MEMORY_COMMANDS].sort()).toEqual(
      ["create", "delete", "insert", "rename", "str_replace", "view"].sort(),
    );
  });

  it("accepts a bare view", () => {
    expect(memoryCommandSchema.parse({ command: "view" }).command).toBe("view");
  });

  it("rejects an unknown command", () => {
    expect(memoryCommandSchema.safeParse({ command: "chmod", path: "/memories/x" }).success).toBe(
      false,
    );
  });

  // The wire schema must stay a single object: several providers reject a
  // tool whose top-level parameters are an `anyOf`, which is what a
  // discriminated union renders as.
  it("renders as a flat JSON Schema object, not an anyOf", () => {
    const json = z.toJSONSchema(memoryCommandSchema, { io: "input" }) as {
      type?: string;
      anyOf?: unknown;
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(json.type).toBe("object");
    expect(json.anyOf).toBeUndefined();
    expect(json.properties).toHaveProperty("command");
    expect(json.properties).toHaveProperty("file_text");
    // Only `command` is structurally required; per-command requirements are
    // enforced by the executor so the model gets an actionable message.
    expect(json.required).toEqual(["command"]);
  });
});

describe("runMemoryCommand", () => {
  let ctx: ReturnType<typeof fakeStore>;
  beforeEach(() => {
    ctx = fakeStore();
  });

  const run = (input: unknown) =>
    runMemoryCommand(memoryCommandSchema.parse(input), ctx.store);

  // Per-command requirements are the executor's job now that the wire schema is
  // flat. The message has to name the missing field to be actionable.
  it.each([
    [{ command: "create", path: "/memories/a.md" }, "file_text"],
    [{ command: "str_replace", path: "/memories/a.md" }, "old_str"],
    [{ command: "insert", path: "/memories/a.md" }, "insert_line"],
    [{ command: "delete" }, "path"],
    [{ command: "rename", old_path: "/memories/a.md" }, "new_path"],
  ])("names the missing field for %j", async (input, field) => {
    const r = await run(input);
    expect(r.isError).toBe(true);
    expect(r.content).toContain(field);
    expect(ctx.files.size).toBe(0);
  });

  it("rejects a traversal path before touching the store", async () => {
    const r = await run({ command: "create", path: "/memories/../evil", file_text: "x" });
    expect(r.isError).toBe(true);
    expect(ctx.files.size).toBe(0);
  });

  it("view on an empty root explains itself", async () => {
    const r = await run({ command: "view" });
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("empty");
  });

  it("create then view round-trips with line numbers", async () => {
    await run({ command: "create", path: "/memories/notes.md", file_text: "one\ntwo" });
    const r = await run({ command: "view", path: "/memories/notes.md" });
    expect(r.content).toContain("1\tone");
    expect(r.content).toContain("2\ttwo");
  });

  it("view of the root lists files with sizes, sorted", async () => {
    await run({ command: "create", path: "/memories/z.md", file_text: "zz" });
    await run({ command: "create", path: "/memories/a.md", file_text: "a" });
    const r = await run({ command: "view" });
    expect(r.content.indexOf("/memories/a.md")).toBeLessThan(
      r.content.indexOf("/memories/z.md"),
    );
    expect(r.content).toContain("2 bytes");
  });

  it("create overwrites and says so", async () => {
    const first = await run({ command: "create", path: "/memories/a.md", file_text: "1" });
    expect(first.content).toContain("Created");
    const second = await run({ command: "create", path: "/memories/a.md", file_text: "2" });
    expect(second.content).toContain("Overwrote");
    expect(ctx.files.get("/memories/a.md")?.text).toBe("2");
  });

  it("refuses to create the root as a file", async () => {
    const r = await run({ command: "create", path: MEMORY_ROOT, file_text: "x" });
    expect(r.isError).toBe(true);
  });

  it("enforces the file-count ceiling but still allows overwrites", async () => {
    for (let i = 0; i < MAX_FILES; i++) {
      ctx.files.set(`/memories/f${i}.md`, { path: `/memories/f${i}.md`, text: "x", updatedAt: 1 });
    }
    const newFile = await run({ command: "create", path: "/memories/extra.md", file_text: "x" });
    expect(newFile.isError).toBe(true);
    const overwrite = await run({ command: "create", path: "/memories/f0.md", file_text: "y" });
    expect(overwrite.isError).toBeUndefined();
  });

  it("enforces the byte ceiling", async () => {
    const r = await runMemoryCommand(
      { command: "create", path: "/memories/big.md", file_text: "a".repeat(MAX_FILE_BYTES + 1) },
      ctx.store,
    );
    expect(r.isError).toBe(true);
    expect(ctx.files.size).toBe(0);
  });

  it("str_replace edits a unique match", async () => {
    await run({ command: "create", path: "/memories/a.md", file_text: "likes tea" });
    const r = await run({
      command: "str_replace",
      path: "/memories/a.md",
      old_str: "tea",
      new_str: "coffee",
    });
    expect(r.isError).toBeUndefined();
    expect(ctx.files.get("/memories/a.md")?.text).toBe("likes coffee");
  });

  // A silent first-match replace is how an edit lands in the wrong place.
  it("str_replace refuses an ambiguous match and leaves the file alone", async () => {
    await run({ command: "create", path: "/memories/a.md", file_text: "x\nx\n" });
    const r = await run({
      command: "str_replace",
      path: "/memories/a.md",
      old_str: "x",
      new_str: "y",
    });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("2 times");
    expect(ctx.files.get("/memories/a.md")?.text).toBe("x\nx\n");
  });

  it("str_replace reports a missing match", async () => {
    await run({ command: "create", path: "/memories/a.md", file_text: "hello" });
    const r = await run({
      command: "str_replace",
      path: "/memories/a.md",
      old_str: "goodbye",
      new_str: "hi",
    });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("not found");
  });

  it("str_replace with an empty new_str deletes the text", async () => {
    await run({ command: "create", path: "/memories/a.md", file_text: "keep DROP keep" });
    await run({ command: "str_replace", path: "/memories/a.md", old_str: " DROP" });
    expect(ctx.files.get("/memories/a.md")?.text).toBe("keep keep");
  });

  it("str_replace on a missing file errors", async () => {
    const r = await run({
      command: "str_replace",
      path: "/memories/nope.md",
      old_str: "a",
      new_str: "b",
    });
    expect(r.isError).toBe(true);
  });

  it("insert at line 0 prepends", async () => {
    await run({ command: "create", path: "/memories/a.md", file_text: "second" });
    await run({ command: "insert", path: "/memories/a.md", insert_line: 0, insert_text: "first" });
    expect(ctx.files.get("/memories/a.md")?.text).toBe("first\nsecond");
  });

  it("insert after a line places text between", async () => {
    await run({ command: "create", path: "/memories/a.md", file_text: "one\nthree" });
    await run({ command: "insert", path: "/memories/a.md", insert_line: 1, insert_text: "two" });
    expect(ctx.files.get("/memories/a.md")?.text).toBe("one\ntwo\nthree");
  });

  it("insert at the exact end appends", async () => {
    await run({ command: "create", path: "/memories/a.md", file_text: "one\ntwo" });
    const r = await run({
      command: "insert",
      path: "/memories/a.md",
      insert_line: 2,
      insert_text: "three",
    });
    expect(r.isError).toBeUndefined();
    expect(ctx.files.get("/memories/a.md")?.text).toBe("one\ntwo\nthree");
  });

  it("insert past the end errors instead of padding", async () => {
    await run({ command: "create", path: "/memories/a.md", file_text: "one" });
    const r = await run({
      command: "insert",
      path: "/memories/a.md",
      insert_line: 9,
      insert_text: "x",
    });
    expect(r.isError).toBe(true);
    expect(ctx.files.get("/memories/a.md")?.text).toBe("one");
  });

  it("insert splits multi-line text into lines", async () => {
    await run({ command: "create", path: "/memories/a.md", file_text: "end" });
    const r = await run({
      command: "insert",
      path: "/memories/a.md",
      insert_line: 0,
      insert_text: "a\nb",
    });
    expect(r.content).toContain("2 line(s)");
    expect(ctx.files.get("/memories/a.md")?.text).toBe("a\nb\nend");
  });

  it("delete removes the file", async () => {
    await run({ command: "create", path: "/memories/a.md", file_text: "x" });
    const r = await run({ command: "delete", path: "/memories/a.md" });
    expect(r.isError).toBeUndefined();
    expect(ctx.files.has("/memories/a.md")).toBe(false);
  });

  it("delete refuses the root", async () => {
    await run({ command: "create", path: "/memories/a.md", file_text: "x" });
    const r = await run({ command: "delete", path: MEMORY_ROOT });
    expect(r.isError).toBe(true);
    expect(ctx.files.size).toBe(1);
  });

  it("delete of a missing file errors", async () => {
    expect((await run({ command: "delete", path: "/memories/nope.md" })).isError).toBe(true);
  });

  it("rename moves content and drops the old path", async () => {
    await run({ command: "create", path: "/memories/a.md", file_text: "keep me" });
    const r = await run({
      command: "rename",
      old_path: "/memories/a.md",
      new_path: "/memories/b.md",
    });
    expect(r.isError).toBeUndefined();
    expect(ctx.files.has("/memories/a.md")).toBe(false);
    expect(ctx.files.get("/memories/b.md")?.text).toBe("keep me");
  });

  it("rename refuses to clobber an existing file", async () => {
    await run({ command: "create", path: "/memories/a.md", file_text: "a" });
    await run({ command: "create", path: "/memories/b.md", file_text: "b" });
    const r = await run({
      command: "rename",
      old_path: "/memories/a.md",
      new_path: "/memories/b.md",
    });
    expect(r.isError).toBe(true);
    expect(ctx.files.get("/memories/b.md")?.text).toBe("b");
  });

  it("rename validates BOTH paths", async () => {
    await run({ command: "create", path: "/memories/a.md", file_text: "a" });
    const r = await run({
      command: "rename",
      old_path: "/memories/a.md",
      new_path: "/memories/../escaped.md",
    });
    expect(r.isError).toBe(true);
    expect(ctx.files.has("/memories/a.md")).toBe(true);
  });

  it("rename to the same path errors", async () => {
    await run({ command: "create", path: "/memories/a.md", file_text: "a" });
    const r = await run({
      command: "rename",
      old_path: "/memories/a.md",
      new_path: "/memories/./a.md",
    });
    expect(r.isError).toBe(true);
  });
});

describe("memoryDirectoryBlock", () => {
  it("is empty when there are no files, so the prompt gains nothing", () => {
    expect(memoryDirectoryBlock([])).toBe("");
  });

  // Progressive disclosure: the prompt advertises paths, never contents.
  it("lists paths and sizes but no file contents", () => {
    const block = memoryDirectoryBlock([
      { path: "/memories/prefs.md", text: "SECRET CONTENT", updatedAt: 1 },
    ]);
    expect(block).toContain("/memories/prefs.md");
    expect(block).not.toContain("SECRET CONTENT");
  });

  it("sorts paths so the block is stable across renders", () => {
    const block = memoryDirectoryBlock([
      { path: "/memories/z.md", text: "z", updatedAt: 1 },
      { path: "/memories/a.md", text: "a", updatedAt: 1 },
    ]);
    expect(block.indexOf("a.md")).toBeLessThan(block.indexOf("z.md"));
  });
});
