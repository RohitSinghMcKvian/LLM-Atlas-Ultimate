/**
 * Prose artifacts: reports, research sheets and slide decks, and the printable
 * document each of them turns into.
 *
 * Until now every artifact was a program. Asking Atlas for a research sheet or a
 * deck produced either a wall of markdown in the transcript or an HTML page
 * pretending to be a document — and neither could be handed to anyone, because
 * there was no way to get a PDF out. This module supplies the two pieces that
 * were missing: how a deck is divided into slides, and what a paginated,
 * print-ready document looks like.
 *
 * Pure and DOM-free. The browser half — creating a frame and calling `print()`
 * — lives in `lib/chat/print.ts`; everything decidable without a DOM is decided
 * here so it can be tested from the node-only suite.
 */

/** One slide of a deck. */
export interface Slide {
  /** The slide's first heading, or "" when it has none. */
  title: string;
  /** The slide's Markdown, with the separator removed. */
  body: string;
}

/** A thematic break on its own line — the conventional slide separator. */
const SLIDE_BREAK = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*\r?$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*\r?$/;

/**
 * Drop a YAML front-matter block.
 *
 * Models open a deck with `---\ntitle: …\n---` often enough that leaving it in
 * would make the first slide a metadata dump — and, worse, the separator regex
 * would treat its two delimiters as slide breaks.
 */
export function stripFrontMatter(md: string): string {
  const lines = md.split("\n");
  const delim = /^-{3,}[ \t]*\r?$/;
  if (!delim.test(lines[0] ?? "")) return md;
  // The line straight after the opening delimiter has to look like a YAML key.
  // Without that check a deck whose first slide is empty — `---` then a blank
  // line then real content — would have its second slide eaten as metadata.
  if (!/^[A-Za-z_][\w.-]*[ \t]*:/.test(lines[1] ?? "")) return md;
  for (let i = 2; i < lines.length; i++) {
    if (delim.test(lines[i])) return lines.slice(i + 1).join("\n").replace(/^\s+/, "");
  }
  return md;
}

/**
 * Split deck Markdown into slides.
 *
 * Line-based and fence-aware: a `---` inside a code block is content, not a
 * separator, and a deck that shows a config file would otherwise shatter into
 * fragments. A deck with no separators at all is one slide, which is the honest
 * reading — not an error.
 */
export function splitSlides(md: string): Slide[] {
  const lines = stripFrontMatter(md).split("\n");
  const groups: string[][] = [[]];
  let fence: string | null = null;

  for (const line of lines) {
    const f = FENCE.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      groups[groups.length - 1].push(line);
      continue;
    }
    if (!fence && SLIDE_BREAK.test(line)) {
      groups.push([]);
      continue;
    }
    groups[groups.length - 1].push(line);
  }

  return groups
    .map((g) => g.join("\n").trim())
    .filter((body) => body.length > 0)
    .map((body) => ({ title: firstHeading(body), body }));
}

/** The first ATX heading in a block of Markdown, or "". */
export function firstHeading(md: string): string {
  for (const line of md.split("\n")) {
    const m = HEADING.exec(line);
    if (m) return m[1].trim();
  }
  return "";
}

/**
 * A title for a prose artifact.
 *
 * The document's own `# Heading` if it has one — a report that calls itself
 * something should be called that everywhere, in the card, the panel header and
 * the printed page. Falls back to the kind's generic name rather than to a
 * truncated first sentence, which reads as a mistake.
 */
export function documentTitle(md: string, fallback: string): string {
  const h = firstHeading(md);
  if (!h) return fallback;
  return h.length > 80 ? `${h.slice(0, 79)}…` : h;
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export type PrintMode = "document" | "slides";

/**
 * Paper geometry.
 *
 * A4 rather than Letter: it is the majority standard, and a Letter printer
 * scales A4 down without clipping while the reverse crops. Slides are 16:9 at
 * roughly A4 landscape width, so a deck prints one slide per sheet at the same
 * aspect it was designed in.
 */
const PAGE_CSS: Record<PrintMode, string> = {
  document: "@page { size: A4; margin: 18mm 16mm 20mm; }",
  slides: "@page { size: 297mm 167mm; margin: 0; }",
};

/**
 * The stylesheet for the printed document.
 *
 * Written against semantic elements rather than utility classes on purpose: the
 * body markup comes from the app's Markdown renderer, and the print document is
 * a separate frame with no access to the app's Tailwind build. Colours are
 * ink-on-paper regardless of the app's theme — printing a dark UI wastes toner
 * and reads badly, and every browser's "background graphics" default would drop
 * the background anyway and leave white text on white paper.
 */
function baseCss(mode: PrintMode): string {
  return `${PAGE_CSS[mode]}
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #fff;
  color: #16181d;
  font: 11pt/1.6 ui-serif, Georgia, "Times New Roman", serif;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
h1, h2, h3, h4, h5, h6 {
  font-family: ui-sans-serif, system-ui, "Segoe UI", Helvetica, Arial, sans-serif;
  line-height: 1.25;
  margin: 1.2em 0 0.5em;
  page-break-after: avoid;
}
h1 { font-size: 20pt; margin-top: 0; }
h2 { font-size: 15pt; }
h3 { font-size: 12.5pt; }
p, ul, ol, blockquote, table, pre { margin: 0 0 0.8em; }
ul, ol { padding-left: 1.4em; }
li { margin: 0.2em 0; }
a { color: #0b4f9e; text-decoration: none; word-break: break-word; }
blockquote {
  margin-left: 0;
  padding: 0.2em 0 0.2em 1em;
  border-left: 3px solid #c9ced6;
  color: #3f454f;
}
code, pre {
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", Menlo, monospace;
  font-size: 9.5pt;
}
code { background: #f2f4f7; padding: 0.1em 0.3em; border-radius: 3px; }
pre {
  background: #f7f8fa;
  border: 1px solid #e3e6ec;
  border-radius: 4px;
  padding: 0.7em 0.9em;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  page-break-inside: avoid;
}
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; font-size: 10pt; page-break-inside: avoid; }
th, td { border: 1px solid #d8dce3; padding: 0.4em 0.6em; text-align: left; vertical-align: top; }
th { background: #f2f4f7; font-weight: 600; }
img, svg { max-width: 100%; height: auto; }
hr { border: 0; border-top: 1px solid #d8dce3; margin: 1.4em 0; }
figure { margin: 0 0 0.8em; }`;
}

const DOCUMENT_CSS = `
.doc { padding: 0; }
`;

const SLIDES_CSS = `
.slide {
  width: 297mm;
  height: 167mm;
  padding: 16mm 18mm;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  overflow: hidden;
  page-break-after: always;
  break-after: page;
}
.slide:last-child { page-break-after: auto; break-after: auto; }
.slide h1 { font-size: 30pt; }
.slide h2 { font-size: 22pt; margin-top: 0; }
.slide h3 { font-size: 16pt; }
.slide p, .slide li { font-size: 13pt; line-height: 1.5; }
.slide ul, .slide ol { padding-left: 1.2em; }
`;

/**
 * The Content-Security-Policy for a printed document.
 *
 * The body is Markdown a model wrote, rendered by the app's own renderer, so it
 * is already free of raw HTML — but it can still contain `![](https://…)`, and
 * a remote image in a document Atlas assembles is an outbound request the user
 * never asked for. §1.4 says zero phone-home, and a tracking pixel is exactly
 * the thing it rules out, so remote loads are refused here the same way they are
 * in an artifact frame. Scripts are refused outright: nothing in a printed page
 * needs to run.
 */
export const PRINT_CSP =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";

/**
 * A complete, standalone document ready to be printed.
 *
 * `bodyHtml` is markup the app's Markdown renderer produced, taken from the live
 * DOM. That is what makes this work without a second Markdown implementation and
 * without a PDF library: the browser already laid the document out, and its own
 * print pipeline is the PDF writer.
 */
export function printDocumentHtml(opts: {
  bodyHtml: string;
  title: string;
  mode: PrintMode;
}): string {
  const css = baseCss(opts.mode) + (opts.mode === "slides" ? SLIDES_CSS : DOCUMENT_CSS);
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${PRINT_CSP}">
<title>${escapeHtml(opts.title)}</title>
<style>${css}</style>
</head><body>${opts.bodyHtml}</body></html>`;
}

/** A slug safe to use as a downloaded file name, without an extension. */
export function fileSlug(title: string, fallback = "artifact"): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || fallback;
}
