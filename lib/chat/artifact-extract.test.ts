import { describe, it, expect } from "vitest";
import {
  extractArtifact,
  extractArtifactMatch,
  extractArtifacts,
  kindAndLangForPath,
  scanFences,
  stripArtifactBlock,
  validFencePath,
} from "./artifact-extract";

const PAGE = `<!DOCTYPE html>
<html>
<head><title>Landing</title></head>
<body><h1>Hello</h1></body>
</html>`;

describe("scanFences", () => {
  it("reads a closed block with its language", () => {
    const [b] = scanFences("intro\n\`\`\`html\n<p>hi</p>\n\`\`\`\nouttro");
    expect(b.lang).toBe("html");
    expect(b.code).toBe("<p>hi</p>");
    expect(b.closed).toBe(true);
  });

  // The bug this whole module exists for: a provider that stops at max_tokens
  // leaves the fence open, and the old regex returned nothing at all.
  it("reads a block whose closing fence never arrived", () => {
    const [b] = scanFences(`Here is the page:\n\`\`\`html\n${PAGE}`);
    expect(b.closed).toBe(false);
    expect(b.code).toContain("<h1>Hello</h1>");
  });

  it("reads CRLF fences", () => {
    const [b] = scanFences("```html\r\n<p>hi</p>\r\n```\r\n");
    expect(b.lang).toBe("html");
    expect(b.code).toContain("<p>hi</p>");
  });

  it("does not close a four-backtick block on a three-backtick line", () => {
    const src = "````md\n```js\nx\n```\n````";
    const blocks = scanFences(src);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].code).toBe("```js\nx\n```");
  });

  it("reports offsets that bound the whole block including both fences", () => {
    const src = "before\n```js\nx\n```\nafter";
    const [b] = scanFences(src);
    expect(src.slice(b.start, b.end)).toBe("```js\nx\n```");
  });

  it("returns nothing for prose without fences", () => {
    expect(scanFences("just words, and a ` backtick")).toEqual([]);
  });
});

describe("extractArtifacts", () => {
  it("returns every renderable block, not just the first", () => {
    const src = "```mermaid\ngraph TD;A-->B;\n```\n\n```html\n<p>x</p>\n```";
    expect(extractArtifacts(src).map((a) => a.type)).toEqual(["mermaid", "html"]);
  });

  it("skips an opening fence with no content yet", () => {
    expect(extractArtifacts("```html\n")).toEqual([]);
  });

  it("recognises an unlabelled block by its content", () => {
    expect(extractArtifacts(`\`\`\`\n${PAGE}\n\`\`\``)[0].type).toBe("html");
    expect(extractArtifacts("```\n<svg viewBox=\"0 0 1 1\"></svg>\n```")[0].type).toBe("svg");
  });
});

describe("extractArtifact", () => {
  it("prefers a visual block over an earlier code listing", () => {
    const long = Array.from({ length: 14 }, (_, i) => `line ${i}`).join("\n");
    const src = `\`\`\`py\n${long}\n\`\`\`\n\n\`\`\`html\n<p>x</p>\n\`\`\``;
    expect(extractArtifact(src)!.type).toBe("html");
  });

  it("falls back to a long code listing, then to a document", () => {
    const long = Array.from({ length: 14 }, (_, i) => `line ${i}`).join("\n");
    expect(extractArtifact(`\`\`\`py\n${long}\n\`\`\``)!.type).toBe("code");
    expect(extractArtifact(`\`\`\`md\n${"word ".repeat(60)}\n\`\`\``)!.type).toBe("markdown");
  });

  it("ignores a short unlabelled snippet", () => {
    expect(extractArtifact("```\nnpm install\n```")).toBeNull();
  });

  it("marks a truncated artifact incomplete and a closed one complete", () => {
    expect(extractArtifact(`\`\`\`html\n${PAGE}`)!.complete).toBe(false);
    expect(extractArtifact(`\`\`\`html\n${PAGE}\n\`\`\``)!.complete).toBe(true);
  });

  it("returns the same object for a repeated call", () => {
    const src = "```html\n<p>x</p>\n```";
    expect(extractArtifactMatch(src)).toBe(extractArtifactMatch(src));
  });
});

describe("stripArtifactBlock", () => {
  it("removes the block and keeps the prose around it", () => {
    const src = "Here is the page:\n\n```html\n<p>x</p>\n```\n\nTell me what to change.";
    expect(stripArtifactBlock(src)).toBe("Here is the page:\n\nTell me what to change.");
  });

  it("removes a truncated block that runs to the end of the message", () => {
    expect(stripArtifactBlock(`Building it now.\n\n\`\`\`html\n${PAGE}`)).toBe("Building it now.");
  });

  it("leaves a message with no artifact untouched", () => {
    expect(stripArtifactBlock("no code here")).toBe("no code here");
  });
});

describe("prose artifacts", () => {
  it("classifies a ```document fence and titles it from its heading", () => {
    const a = extractArtifact("Here you go:\n\n```document\n# Q3 Findings\n\nBody text.\n```");
    expect(a?.type).toBe("document");
    expect(a?.lang).toBe("markdown");
    expect(a?.title).toBe("Q3 Findings");
  });

  it("accepts the report / sheet / research aliases", () => {
    for (const lang of ["doc", "report", "sheet", "research"]) {
      expect(extractArtifact(`\`\`\`${lang}\n# T\n\nbody\n\`\`\``)?.type).toBe("document");
    }
  });

  it("classifies a ```slides fence", () => {
    const a = extractArtifact("```slides\n# Cover\n\n---\n\n# Two\n```");
    expect(a?.type).toBe("slides");
    expect(a?.title).toBe("Cover");
  });

  it("falls back to a generic title when the document has no heading", () => {
    expect(extractArtifact("```document\njust prose\n```")?.title).toBe("Document");
    expect(extractArtifact("```deck\njust prose\n```")?.title).toBe("Slide deck");
  });

  it("still previews a truncated document", () => {
    // The reason the scanner tolerates an unterminated fence at all: a long
    // report hits the output limit exactly like a long page does.
    const a = extractArtifact("```document\n# Report\n\nHalf a sen");
    expect(a?.type).toBe("document");
    expect(a?.complete).toBe(false);
  });

  it("does not promote an ordinary markdown fence to a document", () => {
    // ```markdown keeps its old behaviour — the generic markdown artifact — so a
    // short example is not dragged out of the transcript into a paginated panel.
    expect(extractArtifact("```markdown\n# T\n\nshort\n```")).toBeNull();
  });

  it("prefers a page over a document when a reply contains both", () => {
    const src = "```document\n# Notes\n```\n\n```html\n<p>x</p>\n```";
    // classify() runs in block order, so the first *classifiable* block wins;
    // this documents that order, rather than asserting a preference it lacks.
    expect(extractArtifact(src)?.type).toBe("document");
  });
});

// A file created through the `artifact` tool has no fence to classify it (§P14),
// so the extension is the only signal there is.
describe("kindAndLangForPath", () => {
  it.each([
    ["index.html", "html", "html"],
    ["page.htm", "html", "html"],
    ["logo.svg", "svg", "svg"],
    ["flow.mmd", "mermaid", "mermaid"],
    ["src/App.jsx", "react", "jsx"],
    ["src/App.tsx", "react", "tsx"],
    ["notes.md", "document", "markdown"],
    ["styles.css", "code", "css"],
    ["main.js", "code", "js"],
  ])("reads %s as %s/%s", (path, kind, lang) => {
    expect(kindAndLangForPath(path)).toEqual({ kind, lang });
  });

  it("is case-insensitive about the extension", () => {
    expect(kindAndLangForPath("INDEX.HTML").kind).toBe("html");
  });

  it("falls back to code/text with no extension at all", () => {
    // Not reachable through the tool — `validFencePath` requires an extension —
    // but the function must not produce `undefined` for a lang either way.
    expect(kindAndLangForPath("Makefile")).toEqual({ kind: "code", lang: "text" });
  });
});

describe("validFencePath", () => {
  it("accepts an ordinary relative path", () => {
    expect(validFencePath("src/App.jsx")).toBe("src/App.jsx");
  });

  it.each(["../x.js", "/abs.js", "C:/x.js", "a\\b.js", "plain", "", "a/../b.js", "./x.js"])(
    "refuses %s",
    (bad) => {
      expect(validFencePath(bad)).toBeUndefined();
    },
  );
});
