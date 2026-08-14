import { describe, expect, it } from "vitest";
import {
  documentTitle,
  escapeHtml,
  fileSlug,
  firstHeading,
  PRINT_CSP,
  printDocumentHtml,
  splitSlides,
  stripFrontMatter,
} from "./document";

describe("splitSlides", () => {
  it("splits on a thematic break", () => {
    const slides = splitSlides("# One\n\nfirst\n\n---\n\n# Two\n\nsecond");
    expect(slides.map((s) => s.title)).toEqual(["One", "Two"]);
    expect(slides[0].body).toBe("# One\n\nfirst");
    expect(slides[1].body).toBe("# Two\n\nsecond");
  });

  it("treats a deck with no separator as one slide", () => {
    expect(splitSlides("# Only\n\nbody")).toHaveLength(1);
  });

  it("ignores a separator inside a fenced block", () => {
    // A deck showing a YAML or config sample would otherwise shatter.
    const md = "# Config\n\n```yaml\na: 1\n---\nb: 2\n```\n\n---\n\n# Next";
    const slides = splitSlides(md);
    expect(slides).toHaveLength(2);
    expect(slides[0].body).toContain("b: 2");
  });

  it("handles tilde fences and longer backtick runs", () => {
    const md = "# A\n\n~~~\n---\n~~~\n\n---\n\n# B";
    expect(splitSlides(md)).toHaveLength(2);
    const md2 = "# A\n\n````\n```\n---\n````\n\n---\n\n# B";
    expect(splitSlides(md2)).toHaveLength(2);
  });

  it("accepts asterisk and underscore breaks", () => {
    expect(splitSlides("a\n***\nb")).toHaveLength(2);
    expect(splitSlides("a\n___\nb")).toHaveLength(2);
  });

  it("drops empty groups rather than emitting blank slides", () => {
    expect(splitSlides("---\n\n# One\n\n---\n\n---\n\n# Two\n\n---")).toHaveLength(2);
  });

  it("reports an empty title when a slide has no heading", () => {
    expect(splitSlides("just text")[0].title).toBe("");
  });

  it("returns nothing for empty input", () => {
    expect(splitSlides("")).toEqual([]);
    expect(splitSlides("   \n\n  ")).toEqual([]);
  });
});

describe("stripFrontMatter", () => {
  it("removes a leading YAML block", () => {
    expect(stripFrontMatter("---\ntitle: X\n---\n# Body")).toBe("# Body");
  });

  it("leaves a document that merely starts with a rule", () => {
    // No closing delimiter: this is a thematic break, not front matter.
    expect(stripFrontMatter("---\n# Body")).toBe("---\n# Body");
    // Nor is a leading separator followed by a blank line — that is an empty
    // first slide, and eating it would swallow the second one.
    expect(stripFrontMatter("---\n\n# One\n\n---\n\n# Two")).toBe("---\n\n# One\n\n---\n\n# Two");
  });

  it("leaves ordinary text alone", () => {
    expect(stripFrontMatter("# Body")).toBe("# Body");
  });
});

describe("firstHeading / documentTitle", () => {
  it("finds the first ATX heading at any level", () => {
    expect(firstHeading("intro\n\n## Findings\n\ntext")).toBe("Findings");
  });

  it("strips a closing hash run", () => {
    expect(firstHeading("### Method ###")).toBe("Method");
  });

  it("ignores a hash without a space", () => {
    expect(firstHeading("#nothashtag")).toBe("");
  });

  it("falls back rather than inventing a title", () => {
    expect(documentTitle("no headings here", "Document")).toBe("Document");
  });

  it("truncates an overlong heading", () => {
    const long = `# ${"x".repeat(200)}`;
    expect(documentTitle(long, "Document")).toHaveLength(80);
    expect(documentTitle(long, "Document").endsWith("…")).toBe(true);
  });
});

describe("printDocumentHtml", () => {
  const body = "<h1>Report</h1><p>Body</p>";

  it("emits a standalone document with the body embedded", () => {
    const html = printDocumentHtml({ bodyHtml: body, title: "Report", mode: "document" });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain(body);
    expect(html).toContain("<title>Report</title>");
  });

  it("carries a CSP that blocks scripts and every remote load", () => {
    const html = printDocumentHtml({ bodyHtml: body, title: "R", mode: "document" });
    expect(html).toContain(PRINT_CSP);
    // §1.4: a remote <img> in a document Atlas assembles is an outbound request
    // the user never asked for.
    expect(PRINT_CSP).toContain("default-src 'none'");
    expect(PRINT_CSP).toContain("img-src data: blob:");
    expect(PRINT_CSP).toContain("connect-src 'none'");
    expect(PRINT_CSP).not.toMatch(/script-src/);
  });

  it("uses portrait A4 for a document and landscape for slides", () => {
    expect(printDocumentHtml({ bodyHtml: body, title: "R", mode: "document" })).toContain(
      "size: A4",
    );
    const deck = printDocumentHtml({ bodyHtml: body, title: "R", mode: "slides" });
    expect(deck).toContain("size: 297mm 167mm");
    expect(deck).toContain("page-break-after: always");
  });

  it("escapes the title so it cannot break out of the tag", () => {
    const html = printDocumentHtml({
      bodyHtml: body,
      title: '</title><script>alert(1)</script>',
      mode: "document",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("escapeHtml", () => {
  it("escapes the five markup characters", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});

describe("fileSlug", () => {
  it("slugifies a title", () => {
    expect(fileSlug("Q3 Research Sheet!")).toBe("q3-research-sheet");
  });

  it("falls back when nothing survives", () => {
    expect(fileSlug("!!!", "artifact")).toBe("artifact");
  });

  it("caps the length", () => {
    expect(fileSlug("a ".repeat(80)).length).toBeLessThanOrEqual(60);
  });
});
