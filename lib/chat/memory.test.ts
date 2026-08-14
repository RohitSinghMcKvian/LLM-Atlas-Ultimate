import { describe, it, expect } from "vitest";
import {
  MEMORY_CATEGORIES,
  categoryOf,
  classifyMemory,
  composeMemorySummary,
  extractMemory,
  recallMemories,
  type MemoryItem,
} from "./memory";

function item(content: string, over: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: content.slice(0, 8),
    content,
    source: "manual",
    createdAt: Date.now(),
    ...over,
  };
}

describe("extractMemory", () => {
  it("captures an explicit remember instruction", () => {
    expect(extractMemory("Remember that I prefer metric units")).toBe(
      "I prefer metric units",
    );
    expect(extractMemory("note: the deploy target is Oracle")).toBe(
      "the deploy target is Oracle",
    );
  });

  it("stays conservative — an ordinary message is not a memory", () => {
    expect(extractMemory("Can you remember what a monad is?")).toBeNull();
    expect(extractMemory("What is the weather")).toBeNull();
  });

  it("rejects a fact that is too short or too long", () => {
    expect(extractMemory("remember x")).toBeNull();
    expect(extractMemory(`remember ${"a".repeat(600)}`)).toBeNull();
  });
});

describe("recallMemories", () => {
  it("surfaces the overlapping fact", () => {
    const items = [
      item("prefers metric units"),
      item("the deployment target is Oracle Cloud"),
      item("allergic to shellfish"),
    ];
    const hits = recallMemories(items, "what units should the deployment report use", 2);
    expect(hits.map((h) => h.content)).toContain("prefers metric units");
  });

  it("returns nothing when nothing overlaps", () => {
    expect(recallMemories([item("prefers tea")], "quantum chromodynamics")).toEqual([]);
  });

  it("returns nothing for an empty store", () => {
    expect(recallMemories([], "anything")).toEqual([]);
  });
});

describe("classifyMemory", () => {
  it.each([
    ["prefers metric units", "preference"],
    ["always use concise answers", "preference"],
    ["never use emoji in replies", "preference"],
    ["I am a data engineer at a bank", "identity"],
    ["my name is Sam", "identity"],
    ["the Atlas project deploys to Oracle Cloud", "project"],
    ["migrating the repo to TypeScript", "project"],
    ["the office cat is called Biscuit", "fact"],
  ])("classifies %j as %s", (content, expected) => {
    expect(classifyMemory(content)).toBe(expected);
  });

  it("is case-insensitive", () => {
    expect(classifyMemory("PREFERS METRIC UNITS")).toBe("preference");
  });

  it("only ever returns a declared category", () => {
    const ids = MEMORY_CATEGORIES.map((c) => c.id);
    for (const s of ["anything at all", "I prefer x", "my project", "I am someone"]) {
      expect(ids).toContain(classifyMemory(s));
    }
  });
});

describe("categoryOf", () => {
  // Items stored before P4 have no category field and must keep loading.
  it("defaults a pre-P4 item to fact", () => {
    expect(categoryOf(item("legacy fact"))).toBe("fact");
  });

  it("returns the stored category when present", () => {
    expect(categoryOf(item("x", { category: "preference" }))).toBe("preference");
  });
});

describe("composeMemorySummary", () => {
  it("is empty when nothing is remembered", () => {
    expect(composeMemorySummary([])).toBe("");
  });

  it("groups by category under readable labels", () => {
    const out = composeMemorySummary([
      item("prefers metric units", { category: "preference" }),
      item("is a data engineer", { category: "identity" }),
      item("shipping Atlas in July", { category: "project" }),
    ]);
    expect(out).toContain("Preferences:");
    expect(out).toContain("About you:");
    expect(out).toContain("Projects:");
    expect(out).toContain("- prefers metric units");
  });

  it("orders identity before preferences before projects", () => {
    const out = composeMemorySummary([
      item("shipping Atlas", { category: "project" }),
      item("prefers metric", { category: "preference" }),
      item("is an engineer", { category: "identity" }),
    ]);
    expect(out.indexOf("About you:")).toBeLessThan(out.indexOf("Preferences:"));
    expect(out.indexOf("Preferences:")).toBeLessThan(out.indexOf("Projects:"));
  });

  it("omits categories with no items", () => {
    const out = composeMemorySummary([item("prefers metric", { category: "preference" })]);
    expect(out).not.toContain("Projects:");
  });

  it("folds uncategorised items into Other", () => {
    expect(composeMemorySummary([item("legacy")])).toContain("Other:");
  });
});
