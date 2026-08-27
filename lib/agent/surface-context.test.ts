import { describe, expect, it } from "vitest";
import { MAX_SUMMARY_CHARS, describeSurface, moduleForPath } from "./surface-context";

describe("moduleForPath", () => {
  it("resolves a module route", () => {
    expect(moduleForPath("/leaderboard")?.id).toBe("leaderboard");
    expect(moduleForPath("/cost")?.id).toBe("cost");
  });

  it("matches the longest prefix, so a nested route still resolves", () => {
    expect(moduleForPath("/chat/anything/deeper")?.id).toBe("chat");
  });

  it("returns nothing for a route that is not a module", () => {
    expect(moduleForPath("/nowhere")).toBeUndefined();
    expect(moduleForPath("/")).toBeUndefined();
  });
});

describe("describeSurface", () => {
  it("says what the module is showing", () => {
    const line = describeSurface({
      moduleId: "leaderboard",
      summary: "Filtered to open-weights models under $1/M",
      focus: ["llama-4", "qwen3"],
    });
    expect(line).toContain("Leaderboard");
    expect(line).toContain("open-weights");
    expect(line).toContain("Focus: llama-4, qwen3");
  });

  it("falls back to the route when a module has not opted in", () => {
    // Still worth having: knowing they are on the Cost page changes what a good
    // answer looks like, even with no detail behind it.
    expect(describeSurface(null, "/cost")).toContain("Atlas Cost");
  });

  it("is empty when there is nothing to say", () => {
    expect(describeSurface(null)).toBe("");
    expect(describeSurface(null, "/nowhere")).toBe("");
  });

  it("caps the summary, so it cannot crowd out the retrieved facts", () => {
    const line = describeSurface({ moduleId: "cost", summary: "x".repeat(1000) });
    expect(line.length).toBeLessThan(MAX_SUMMARY_CHARS + 60);
  });

  it("caps the focus list too", () => {
    const line = describeSurface({
      moduleId: "cost",
      summary: "s",
      focus: Array.from({ length: 40 }, (_, i) => `m${i}`),
    });
    expect(line.split(", ").length).toBeLessThanOrEqual(8);
  });

  it("degrades to the raw id for a module that does not exist", () => {
    expect(describeSurface({ moduleId: "ghost", summary: "s" })).toContain("ghost");
  });
});
