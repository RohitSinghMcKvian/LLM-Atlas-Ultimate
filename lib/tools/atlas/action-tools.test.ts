import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { installSnapshot, resetSnapshot } from "@/lib/catalog/snapshot";
import { makeSnapshot } from "@/lib/catalog/__fixtures__/snapshots";
import { MINI_MODELS } from "@/lib/graph/__fixtures__/mini-catalog";
import { hrefForOpen, runOpenTool, type OpenToolInput } from "./open-tool";
import { runPromptTool, slugify, type PromptPort, type PromptSummary } from "./prompt-tool";

/**
 * The two Atlas tools that act.
 *
 * The read tools can only be wrong; these can be wrong *and* move somebody, so
 * the cases below are about the two ways that goes badly. A link built from an
 * id the catalog does not have lands the person on a page apologising for the
 * agent, and a link built from a parameter no route reads lands them on a
 * default view while the agent reports success. Both are checked here rather
 * than discovered in a browser.
 */

const open = (patch: Partial<OpenToolInput>): OpenToolInput => ({
  module: "compare",
  reason: "because",
  ...patch,
});

describe("hrefForOpen", () => {
  beforeAll(() => installSnapshot(makeSnapshot(MINI_MODELS, { version: "mini-open-tool" })));
  afterAll(() => resetSnapshot());

  it("puts several models on one `models` key, which is what /compare splits", () => {
    const r = hrefForOpen(open({ module: "compare", model_ids: ["summit-pro", "meridian-70b"] }));
    expect(r).toEqual({
      href: "/compare?models=summit-pro%2Cmeridian-70b",
      moduleName: "Atlas Compare",
    });
  });

  it("uses the singular `model` key for the routes that read one", () => {
    expect(hrefForOpen(open({ module: "cost", model_ids: ["summit-pro"] }))).toMatchObject({
      href: "/cost?model=summit-pro",
    });
    expect(hrefForOpen(open({ module: "chat", model_ids: ["summit-pro"] }))).toMatchObject({
      href: "/chat?model=summit-pro",
    });
  });

  it("takes the first id for a single-model route rather than refusing a list", () => {
    // "compare these two on cost" is a reasonable thing to say, and the cost
    // page on the first is a better answer than an error.
    expect(
      hrefForOpen(open({ module: "cost", model_ids: ["summit-pro", "meridian-8b"] })),
    ).toMatchObject({ href: "/cost?model=summit-pro" });
  });

  it("refuses an id the catalog does not have, and names it", () => {
    const r = hrefForOpen(open({ model_ids: ["summit-pro", "gpt-9"] }));
    expect(r).toHaveProperty("error");
    // Named, not counted: the model can correct a name and cannot correct "1 id".
    expect((r as { error: string }).error).toContain("gpt-9");
  });

  it("carries the news keys the page actually parses", () => {
    const r = hrefForOpen(
      open({ module: "news", search_query: "gemini", topic: "releases", article_id: "abc" }),
    );
    expect((r as { href: string }).href).toBe("/news?q=gemini&t=releases&a=abc");
  });

  it("drops state a module has no parameter for, and still goes there", () => {
    // Silently dropping is right: the destination is still correct, and an
    // error would refuse a navigation that works.
    expect(hrefForOpen(open({ module: "vault", model_ids: ["summit-pro"] }))).toMatchObject({
      href: "/vault",
    });
  });

  it("leaves a bare route bare rather than appending an empty query", () => {
    expect(hrefForOpen(open({ module: "compare" }))).toMatchObject({ href: "/compare" });
  });
});

describe("runOpenTool", () => {
  beforeAll(() => installSnapshot(makeSnapshot(MINI_MODELS, { version: "mini-open-run" })));
  afterAll(() => resetSnapshot());

  it("navigates through the port and says the person is already there", () => {
    const navigate = vi.fn();
    const r = runOpenTool(open({ module: "leaderboard", access: "free" }), navigate);
    expect(navigate).toHaveBeenCalledWith("/leaderboard?access=free");
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("/leaderboard?access=free");
  });

  it("answers with the destination when the surface cannot navigate", () => {
    // Not an error: the page is real and reachable, this surface just cannot
    // move anyone. An MCP client gets a useful answer instead of a failure.
    const r = runOpenTool(open({ module: "cost" }));
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("/cost");
  });

  it("never navigates when resolution failed", () => {
    const navigate = vi.fn();
    const r = runOpenTool(open({ model_ids: ["nope"] }), navigate);
    expect(navigate).not.toHaveBeenCalled();
    expect(r.isError).toBe(true);
  });
});

// --- prompt library ---------------------------------------------------------

function fakeLibrary(seed: PromptSummary[] = []) {
  const items = [...seed];
  const port: PromptPort = {
    list: () => items,
    save: ({ id, title, body, tags }) => {
      const at = items.findIndex((p) => p.id === id);
      if (at === -1) {
        items.push({ id, title, tags, body, version: 1 });
        return { created: true, version: 1 };
      }
      const version = items[at].version + 1;
      items[at] = { ...items[at], body, version };
      return { created: false, version };
    },
  };
  return { port, items };
}

describe("runPromptTool", () => {
  it("says so plainly when the surface has no library", () => {
    const r = runPromptTool({ command: "list" });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("not available");
  });

  it("lists ids, titles and versions", () => {
    const { port } = fakeLibrary([
      { id: "summarize", title: "Neutral summary", tags: ["rag"], body: "x", version: 3 },
    ]);
    const r = runPromptTool({ command: "list" }, port);
    expect(r.content).toContain("summarize");
    expect(r.content).toContain("v3");
    expect(r.content).toContain("rag");
  });

  it("reports an empty library as empty, not as an error", () => {
    const { port } = fakeLibrary();
    const r = runPromptTool({ command: "list" }, port);
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("empty");
  });

  it("names the ids that do exist when one does not", () => {
    // A model handed the list corrects itself this round; one handed only the
    // failure guesses again next round.
    const { port } = fakeLibrary([
      { id: "summarize", title: "S", tags: [], body: "x", version: 1 },
    ]);
    const r = runPromptTool({ command: "read", prompt_id: "summarise" }, port);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("summarize");
  });

  it("creates a prompt, then versions it instead of overwriting", () => {
    const { port, items } = fakeLibrary();
    const first = runPromptTool({ command: "save", title: "Neutral Summary!", body: "one" }, port);
    expect(first.content).toContain("new prompt");
    expect(items[0].id).toBe("neutral-summary");

    const second = runPromptTool(
      { command: "save", prompt_id: "neutral-summary", body: "two" },
      port,
    );
    expect(second.content).toContain("v2");
    expect(second.content).toContain("still there");
    expect(items).toHaveLength(1);
  });

  it("keeps the existing title and tags when a version arrives without them", () => {
    const { port, items } = fakeLibrary([
      { id: "p", title: "Kept", tags: ["a"], body: "old", version: 1 },
    ]);
    runPromptTool({ command: "save", prompt_id: "p", body: "new" }, port);
    expect(items[0].title).toBe("Kept");
    expect(items[0].tags).toEqual(["a"]);
  });

  it("refuses a save with nothing to save", () => {
    const { port } = fakeLibrary();
    expect(runPromptTool({ command: "save", title: "T" }, port).isError).toBe(true);
    expect(runPromptTool({ command: "save", body: "  " }, port).isError).toBe(true);
    // No id and no title: nothing to derive a slug from.
    expect(runPromptTool({ command: "save", body: "b" }, port).isError).toBe(true);
  });
});

describe("slugify", () => {
  it("makes an id the schema's own pattern accepts", () => {
    const pattern = /^[a-z0-9][a-z0-9-]*$/;
    expect(slugify("Neutral Summary!")).toBe("neutral-summary");
    expect(pattern.test(slugify("  Extract to JSON  "))).toBe(true);
    expect(slugify("")).toBe("");
  });
});
