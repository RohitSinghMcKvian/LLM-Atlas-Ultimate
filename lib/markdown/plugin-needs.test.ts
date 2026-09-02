import { describe, it, expect } from "vitest";
import { needsHighlight, needsMath } from "./plugin-needs";

describe("needsHighlight", () => {
  it("finds fenced blocks", () => {
    expect(needsHighlight("intro\n```ts\nconst a = 1;\n```")).toBe(true);
    expect(needsHighlight("```\nplain\n```")).toBe(true);
    expect(needsHighlight("~~~py\nx = 1\n~~~")).toBe(true);
  });

  it("finds a fence on the very first line", () => {
    expect(needsHighlight("```ts\nconst a = 1;\n```")).toBe(true);
  });

  it("finds an indented fence, as a list item would produce", () => {
    expect(needsHighlight("- step\n  ```sh\n  npm run dev\n  ```")).toBe(true);
  });

  it("finds inline code", () => {
    expect(needsHighlight("call `getModelById()` first")).toBe(true);
  });

  it("stays out of the way of ordinary prose", () => {
    expect(needsHighlight("A plain sentence about models.")).toBe(false);
    expect(needsHighlight("")).toBe(false);
  });

  it("does not treat a lone backtick as code", () => {
    expect(needsHighlight("a ` b")).toBe(false);
  });
});

describe("needsMath", () => {
  it("finds block math", () => {
    expect(needsMath("$$E = mc^2$$")).toBe(true);
  });

  it("finds LaTeX bracket delimiters", () => {
    expect(needsMath("inline \\(x^2\\) here")).toBe(true);
    expect(needsMath("display \\[x^2\\] here")).toBe(true);
  });

  /**
   * The bug this pair of assertions exists to catch. Written as `"\("` rather
   * than `"\\("`, the delimiter collapses to a bare `(` — and then every
   * message containing a parenthesis, which is nearly all of them, downloads
   * 258 KB of KaTeX. Prose with brackets must stay false.
   */
  it("does not treat ordinary brackets as math", () => {
    expect(needsMath("a function call (like this one) in prose")).toBe(false);
    expect(needsMath("a list [one, two] in prose")).toBe(false);
  });

  /**
   * The regression this whole predicate exists to avoid. Two prices in one
   * paragraph is the single most common shape of text in this product, and
   * `singleDollarTextMath: false` means the parser does not read it as math —
   * so neither may the loader, or every pricing answer downloads KaTeX.
   */
  it("does not mistake a pair of prices for a formula", () => {
    expect(needsMath("Input is $0.16/M and output is $0.35/M.")).toBe(false);
    expect(needsMath("$3.00 vs $15.00 per million tokens")).toBe(false);
  });

  it("stays out of the way of ordinary prose", () => {
    expect(needsMath("A plain sentence.")).toBe(false);
    expect(needsMath("")).toBe(false);
  });
});
