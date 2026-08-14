import { describe, it, expect } from "vitest";
import { anchorSelection, MAX_GROW_STEPS, selectionEditPrompt } from "./artifact-select";
import { applyArtifactPatch } from "./artifact-patch";

const PAGE = [
  "<html>",
  "  <body>",
  '    <button class="btn">One</button>',
  '    <button class="btn">Two</button>',
  "    <p>Unique paragraph</p>",
  "  </body>",
  "</html>",
].join("\n");

/** Offsets of `needle`'s nth occurrence, for readable fixtures. */
function at(source: string, needle: string, nth = 1): [number, number] {
  let i = -1;
  for (let n = 0; n < nth; n++) i = source.indexOf(needle, i + 1);
  return [i, i + needle.length];
}

describe("anchorSelection", () => {
  it("keeps an already-unique selection exactly as highlighted", () => {
    const [from, to] = at(PAGE, "Unique paragraph");
    const a = anchorSelection(PAGE, from, to);
    expect(a.ok).toBe(true);
    expect(a.snippet).toBe("Unique paragraph");
  });

  // The case that makes highlight-to-edit usable at all: `class="btn"` appears
  // twice, so the raw selection would be refused as ambiguous by the patch tool.
  it("grows an ambiguous selection to the enclosing line", () => {
    const [from, to] = at(PAGE, 'class="btn"', 1);
    const a = anchorSelection(PAGE, from, to);
    expect(a.ok).toBe(true);
    expect(a.snippet).toContain("One");
    expect(a.snippet).not.toContain("Two");
  });

  it("anchors the second occurrence to its own line, not the first", () => {
    const [from, to] = at(PAGE, 'class="btn"', 2);
    const a = anchorSelection(PAGE, from, to);
    expect(a.snippet).toContain("Two");
    expect(a.snippet).not.toContain("One");
  });

  // The output has to satisfy `applyArtifactPatch`'s contract, which is the
  // whole reason this module exists.
  it("produces a snippet the patch tool accepts", () => {
    const [from, to] = at(PAGE, 'class="btn"', 1);
    const a = anchorSelection(PAGE, from, to);
    const patched = applyArtifactPatch(PAGE, a.snippet, "    <button>Changed</button>");
    expect(patched.ok).toBe(true);
    expect(patched.code).toContain("Changed");
    expect(patched.code).toContain("Two");
  });

  it("grows past a duplicated line until the block is unique", () => {
    const source = ["a", "dup", "b", "dup", "c"].join("\n");
    const [from, to] = at(source, "dup", 1);
    const a = anchorSelection(source, from, to);
    expect(a.ok).toBe(true);
    expect(applyArtifactPatch(source, a.snippet, "x").ok).toBe(true);
  });

  it("rejects an empty or whitespace-only selection", () => {
    expect(anchorSelection(PAGE, 5, 5).reason).toBe("empty");
    const [from] = at(PAGE, "\n  <body>");
    expect(anchorSelection(PAGE, from, from + 1).reason).toBe("empty");
  });

  it("normalises a backwards selection", () => {
    const [from, to] = at(PAGE, "Unique paragraph");
    expect(anchorSelection(PAGE, to, from).snippet).toBe("Unique paragraph");
  });

  it("clamps offsets past the ends of the document", () => {
    const a = anchorSelection(PAGE, -10, PAGE.length + 50);
    expect(a.start).toBe(0);
    expect(a.end).toBe(PAGE.length);
  });

  // A document that is genuinely all the same line cannot be anchored, and
  // saying so beats sending the model half the file and hoping.
  it("gives up rather than growing forever on a uniform document", () => {
    const source = Array.from({ length: MAX_GROW_STEPS * 4 }, () => "same").join("\n");
    const a = anchorSelection(source, 0, 4);
    expect(a.ok).toBe(false);
    expect(a.reason).toBe("not-unique");
    expect(a.occurrences).toBeGreaterThan(1);
  });

  it("anchors a selection spanning several lines", () => {
    const [from] = at(PAGE, '<button class="btn">One');
    const [, to] = at(PAGE, '<button class="btn">Two</button>');
    const a = anchorSelection(PAGE, from, to);
    expect(a.ok).toBe(true);
    expect(a.snippet).toContain("One");
    expect(a.snippet).toContain("Two");
  });

  it("handles a document with no newlines at all", () => {
    const a = anchorSelection("just one line here", 5, 8);
    expect(a.ok).toBe(true);
  });
});

describe("selectionEditPrompt", () => {
  it("quotes the snippet in full and names the file", () => {
    const p = selectionEditPrompt("index.html", "<h1>Hi</h1>", "make it bigger");
    expect(p).toContain("index.html");
    expect(p).toContain("<h1>Hi</h1>");
    expect(p).toContain("make it bigger");
    expect(p).toContain("old_str");
  });

  it("works without a path", () => {
    expect(selectionEditPrompt(undefined, "x", "y")).not.toContain("undefined");
  });
});
