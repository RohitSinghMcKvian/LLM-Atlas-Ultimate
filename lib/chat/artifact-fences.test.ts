import { describe, it, expect } from "vitest";
import {
  extractArtifacts,
  parseFenceInfo,
  scanFences,
  stripArtifactBlock,
} from "./artifact-extract";

/**
 * Fence info-string attributes.
 *
 * The info string is a free-text field that already carries other conventions —
 * Shiki's line highlighting, twoslash markers, tool-specific titles — so the
 * risk here is not failing to parse a path but inventing one. Most of these
 * cases are about what must NOT become a file.
 */

describe("parseFenceInfo", () => {
  it("reads a quoted path", () => {
    expect(parseFenceInfo('path="index.html"')).toEqual({ path: "index.html" });
    expect(parseFenceInfo("path='src/App.jsx'")).toEqual({ path: "src/App.jsx" });
  });

  it("reads an unquoted path, which is how models usually write it", () => {
    expect(parseFenceInfo("path=styles.css")).toEqual({ path: "styles.css" });
  });

  it("reads a title alongside", () => {
    expect(parseFenceInfo('path="a.html" title="Landing page"')).toEqual({
      path: "a.html",
      titleAttr: "Landing page",
    });
  });

  it("ignores an empty info string", () => {
    expect(parseFenceInfo("")).toEqual({});
  });

  // The conventions already in the wild must pass through untouched.
  it.each([
    "{1,3-4}",
    "twoslash",
    "showLineNumbers",
    "{1,3-4} showLineNumbers",
    "copy",
  ])("ignores the unrelated info string %j", (info) => {
    expect(parseFenceInfo(info)).toEqual({});
  });

  // Traversal is rejected here as well as at the filesystem boundary.
  it.each([
    'path="/etc/passwd"',
    'path="../escape.html"',
    'path="a/../b.html"',
    'path="C:\\\\win.html"',
    'path="http://x/y.html"',
    'path="has space.html"',
    'path="noextension"',
    'path=""',
  ])("refuses %j", (info) => {
    expect(parseFenceInfo(info).path).toBeUndefined();
  });

  it("refuses an absurdly long path", () => {
    expect(parseFenceInfo(`path="${"a".repeat(250)}.html"`).path).toBeUndefined();
  });
});

describe("scanFences with attributes", () => {
  it("still opens a fence that carries metadata", () => {
    const [b] = scanFences('```html path="index.html"\n<p>hi</p>\n```');
    expect(b.lang).toBe("html");
    expect(b.path).toBe("index.html");
    expect(b.code).toBe("<p>hi</p>");
    expect(b.closed).toBe(true);
  });

  // Regression: the old pattern required the info string to be empty, so any
  // fence with metadata was not recognised as a fence at all.
  it("opens a fence whose info string is not a path", () => {
    const [b] = scanFences("```js {1,3-4}\nconst a = 1;\n```");
    expect(b.lang).toBe("js");
    expect(b.path).toBeUndefined();
    expect(b.code).toBe("const a = 1;");
  });

  it("leaves a plain fence exactly as before", () => {
    const [b] = scanFences("```html\n<p>hi</p>\n```");
    expect(b.lang).toBe("html");
    expect(b.path).toBeUndefined();
  });
});

describe("extractArtifacts with paths", () => {
  it("returns every named file, including ones that do not render alone", () => {
    const msg = [
      "Here it is.",
      '```html path="index.html"',
      "<h1>Hi</h1>",
      "```",
      '```css path="styles.css"',
      "body { margin: 0 }",
      "```",
      '```js path="app.js"',
      "console.log(1)",
      "```",
    ].join("\n");
    const arts = extractArtifacts(msg);
    expect(arts.map((a) => a.path)).toEqual(["index.html", "styles.css", "app.js"]);
    // CSS and JS are not renderable kinds, but they are files of the build.
    expect(arts[1].type).toBe("code");
    expect(arts[2].type).toBe("code");
    expect(arts[0].type).toBe("html");
  });

  it("uses the path as the title when no title was given", () => {
    const [a] = extractArtifacts('```html path="pricing.html"\n<h1>x</h1>\n```');
    expect(a.title).toBe("pricing.html");
  });

  it("lets an explicit title win over the path", () => {
    const [a] = extractArtifacts('```html path="a.html" title="Pricing"\n<h1>x</h1>\n```');
    expect(a.title).toBe("Pricing");
  });

  it("does not promote an unnamed, unclassifiable block to a file", () => {
    expect(extractArtifacts("```css\nbody{}\n```")).toEqual([]);
  });
});

describe("stripArtifactBlock across several files", () => {
  it("removes every named block and keeps the prose", () => {
    const msg = [
      "Built the page.",
      '```html path="index.html"',
      "<h1>Hi</h1>",
      "```",
      "And the styles.",
      '```css path="styles.css"',
      "body { margin: 0 }",
      "```",
      "Done.",
    ].join("\n");
    const out = stripArtifactBlock(msg);
    expect(out).toContain("Built the page.");
    expect(out).toContain("And the styles.");
    expect(out).toContain("Done.");
    expect(out).not.toContain("<h1>Hi</h1>");
    expect(out).not.toContain("margin: 0");
  });

  // R8: a short snippet used to explain something is not a deliverable, and
  // hiding it behind a panel would take the explanation out of the explanation.
  it("leaves an inline snippet alone when a real artifact is present", () => {
    const msg = [
      '```html path="index.html"',
      "<h1>Hi</h1>",
      "```",
      "You call it like this:",
      "```bash",
      "npm run dev",
      "```",
    ].join("\n");
    const out = stripArtifactBlock(msg);
    expect(out).not.toContain("<h1>Hi</h1>");
    expect(out).toContain("npm run dev");
  });

  it("keeps the single-artifact behaviour when nothing is named", () => {
    const msg = "Here:\n```html\n<h1>Hi</h1>\n```\nEnjoy.";
    const out = stripArtifactBlock(msg);
    expect(out).toBe("Here:\n\nEnjoy.");
  });
});
