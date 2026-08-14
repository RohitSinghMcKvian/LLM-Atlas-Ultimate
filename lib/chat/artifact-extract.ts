import type { Artifact, ArtifactType } from "./artifact-sandbox";
import { documentTitle } from "./document";

/**
 * Finding the renderable artifact inside an assistant message.
 *
 * This used to live inside `components/chat/artifact-panel.tsx` as a single
 * regex, `/```(\w+)?\n([\s\S]*?)```/g`, and that regex is why Atlas could not
 * show a landing page. It requires a *closing* fence, so a reply truncated by
 * the provider's output limit — which is exactly what a 600-line page hits —
 * matched nothing at all. No match meant no artifact, no artifact meant the
 * Artifact button never rendered, and the user saw a wall of raw HTML with no
 * way to preview it.
 *
 * So the scanner here is deliberately forgiving about the ways a real model
 * ends a message:
 *
 *  - **An unterminated final fence still counts.** That single change is what
 *    makes both live streaming preview and truncated output render.
 *  - **CRLF works.** The old `(\w+)?\n` never matched `html\r\n`.
 *  - **Fences longer than three backticks work**, which is how a model wraps
 *    content that itself contains a fence.
 *  - **Every block is returned**, not just the first — a reply can contain a
 *    page and a snippet, and the page is not always first.
 *
 * Pure and DOM-free so it can be tested from the node-only suite, unlike the
 * client component it came from.
 */

/** One fenced block, with the source range it occupied. */
export interface RawBlock {
  lang: string;
  code: string;
  /** Offset of the opening fence in the original string. */
  start: number;
  /** Offset just past the closing fence, or the end of input if unterminated. */
  end: number;
  /** False when the message ended before the closing fence arrived. */
  closed: boolean;
  /**
   * The file this block is, when the fence named one:
   * ` ```html path="index.html" `. Relative, validated, and absent unless the
   * model actually said so — see `parseFenceInfo`.
   */
  path?: string;
  /** An explicit `title="…"`, which overrides the derived one. */
  titleAttr?: string;
}

/** An artifact plus where it came from, so the block can be stripped or replaced. */
export interface ArtifactMatch extends Artifact {
  start: number;
  end: number;
}

/** Every artifact in a message, with source ranges. */
export function extractArtifactMatches(content: string): ArtifactMatch[] {
  return extractArtifacts(content);
}

// The third group is CommonMark's "info string" remainder: everything after the
// language word. It used to be required to be empty, which meant a fence
// carrying any metadata at all was not recognised as a fence.
const OPEN_FENCE = /^ {0,3}(`{3,})[ \t]*([A-Za-z0-9_+#.-]*)[ \t]*([^\r\n]*?)[ \t]*\r?$/;
const CLOSE_FENCE = /^ {0,3}(`{3,})[ \t]*\r?$/;

/** `path="src/App.jsx"`, `path=index.html`, and the same for `title`. */
const ATTR = /\b(path|title)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g;

/**
 * A path a fence is allowed to name.
 *
 * Strict on purpose. The info string is a free-text field that already carries
 * other conventions in the wild — Shiki writes ` ```js {1,3-4} `, some tools
 * write ` ```ts twoslash ` — and a loose parser would turn one of those into a
 * file. Anything that is not obviously a relative path is ignored, which leaves
 * the block behaving exactly as it does today.
 *
 * Traversal is rejected here as well as by `resolveConfinedPath` later. This is
 * a filter, not the boundary; the boundary still runs.
 *
 * Exported because the `artifact` tool now names paths too (§P14), and the two
 * entry points must agree on what a path is: a file the model can create by
 * writing a fence but not by calling the tool — or the reverse — is a bug
 * waiting for someone to hit it.
 */
export function validFencePath(raw: string): string | undefined {
  const p = raw.trim();
  if (!p || p.length > 200) return undefined;
  if (p.startsWith("/") || p.includes("\\") || p.includes(":")) return undefined;
  if (!/^[A-Za-z0-9._\-/]+$/.test(p)) return undefined;
  const segs = p.split("/");
  if (segs.some((s) => s === "" || s === "." || s === "..")) return undefined;
  // A path with no extension is far more likely to be a stray word than a file.
  if (!/\.[A-Za-z0-9]+$/.test(p)) return undefined;
  return p;
}

/** Pull `path` and `title` out of a fence's info string. Unknown tokens ignored. */
export function parseFenceInfo(info: string): { path?: string; titleAttr?: string } {
  if (!info) return {};
  const out: { path?: string; titleAttr?: string } = {};
  for (const m of info.matchAll(ATTR)) {
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    if (m[1] === "path") {
      const p = validFencePath(value);
      if (p) out.path = p;
    } else if (value.trim()) {
      out.titleAttr = value.trim().slice(0, 120);
    }
  }
  return out;
}

/**
 * Split a message into its fenced code blocks.
 *
 * Line-based rather than one big regex: the closing fence has to be matched
 * against the opening one's length, and an unterminated block has to be
 * reported rather than skipped. Neither is expressible in the old pattern.
 */
export function scanFences(content: string): RawBlock[] {
  const lines = content.split("\n");
  const offsets: number[] = [];
  let at = 0;
  for (const line of lines) {
    offsets.push(at);
    at += line.length + 1; // +1 for the "\n" that split consumed
  }

  const out: RawBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = OPEN_FENCE.exec(lines[i]);
    if (!open) {
      i++;
      continue;
    }
    const marker = open[1];
    const lang = open[2].toLowerCase();
    const info = parseFenceInfo(open[3] ?? "");
    const body: string[] = [];
    let j = i + 1;
    let closed = false;
    while (j < lines.length) {
      const close = CLOSE_FENCE.exec(lines[j]);
      if (close && close[1].length >= marker.length) {
        closed = true;
        break;
      }
      body.push(lines[j]);
      j++;
    }
    out.push({
      lang,
      code: body.join("\n").trim(),
      start: offsets[i],
      end: closed ? offsets[j] + lines[j].length : content.length,
      closed,
      ...info,
    });
    // An unterminated block runs to the end of the message by definition, so
    // there is nothing after it to scan.
    i = closed ? j + 1 : lines.length;
  }
  return out;
}

function make(b: RawBlock, type: ArtifactType, lang: string, title: string): ArtifactMatch {
  return {
    type,
    lang,
    code: b.code,
    // An explicit `title=` wins over the derived one; a `path=` is a better
    // default title than "HTML preview" because it is what the file is called.
    title: b.titleAttr || b.path || title,
    complete: b.closed,
    start: b.start,
    end: b.end,
    path: b.path,
  };
}

// Prose artifacts are opted into by fence language. Deliberately explicit: an
// ordinary ```markdown block is still just a markdown block, and promoting every
// one of them to a paginated document would take a three-line example out of the
// transcript and put it behind a panel.
const SLIDE_LANGS = ["slides", "slide", "deck", "presentation"];
const DOC_LANGS = ["document", "doc", "report", "sheet", "research"];

/** The type a block renders as, if it is one of the visual/interactive kinds. */
function classify(b: RawBlock): ArtifactMatch | null {
  const { lang, code } = b;
  if (lang === "html" || /^<!DOCTYPE/i.test(code) || /<html[\s>]/i.test(code))
    return make(b, "html", "html", "HTML preview");
  if (lang === "svg" || code.startsWith("<svg")) return make(b, "svg", "svg", "SVG");
  if (lang === "mermaid") return make(b, "mermaid", "mermaid", "Diagram");
  if (["jsx", "tsx", "react"].includes(lang)) return make(b, "react", lang, "React component");
  if (SLIDE_LANGS.includes(lang))
    return make(b, "slides", "markdown", documentTitle(code, "Slide deck"));
  if (DOC_LANGS.includes(lang))
    return make(b, "document", "markdown", documentTitle(code, "Document"));
  return null;
}

/**
 * What a file's extension says it is, for a file created with no fence to
 * classify (§P14).
 *
 * `classify` reads the fence's language word and, failing that, the source
 * itself. The `artifact` tool's `create` has neither — the model names a path
 * and hands over code — so the extension is the only signal, and it is a good
 * one: a build's files are named by convention, not arbitrarily.
 *
 * Kept deliberately parallel to `classify`, and anything unrecognized lands on
 * `code`, which is what a `path=`-tagged fence of an unknown language already
 * produces.
 */
export function kindAndLangForPath(path: string): { kind: ArtifactType; lang: string } {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
  switch (ext) {
    case "html":
    case "htm":
      return { kind: "html", lang: "html" };
    case "svg":
      return { kind: "svg", lang: "svg" };
    case "mmd":
    case "mermaid":
      return { kind: "mermaid", lang: "mermaid" };
    case "jsx":
      return { kind: "react", lang: "jsx" };
    case "tsx":
      return { kind: "react", lang: "tsx" };
    case "md":
    case "markdown":
      return { kind: "document", lang: "markdown" };
    default:
      return { kind: "code", lang: ext || "text" };
  }
}

/**
 * Every block in the message that renders as a visual or interactive artifact.
 *
 * A block the model named with `path=` counts even when its language is not one
 * of the renderable kinds: `styles.css` and `app.js` are files of the build, and
 * refusing them because CSS is not previewable on its own would mean a
 * multi-file page could only ever be written as one file.
 */
export function extractArtifacts(content: string): ArtifactMatch[] {
  const out: ArtifactMatch[] = [];
  for (const b of scanFences(content)) {
    if (!b.code) continue; // an opening fence with nothing after it yet
    const art = classify(b) ?? (b.path ? make(b, "code", b.lang || "text", b.path) : null);
    if (art) out.push(art);
  }
  return out;
}

// The panel scans a whole message per render, and again over the thread on every
// streaming flush (~48ms). It is a pure function of a string, and while a
// response streams only the newest message differs, so nearly every call repeats
// one already answered. Bounded so a long session cannot grow it without limit;
// insertion order makes the oldest key the first one Map iteration yields.
const matchCache = new Map<string, ArtifactMatch | null>();
const CACHE_MAX = 200;

/** The best artifact in a message, with its source range. */
export function extractArtifactMatch(content: string): ArtifactMatch | null {
  if (matchCache.has(content)) return matchCache.get(content)!;
  const result = compute(content);
  if (matchCache.size >= CACHE_MAX) {
    const oldest = matchCache.keys().next().value;
    if (oldest !== undefined) matchCache.delete(oldest);
  }
  matchCache.set(content, result);
  return result;
}

function compute(content: string): ArtifactMatch | null {
  const blocks = scanFences(content).filter((b) => b.code);
  // Preference order, unchanged from the original: visual and interactive first,
  // then a substantial code listing, then a standalone document.
  for (const b of blocks) {
    const art = classify(b);
    if (art) return art;
  }
  for (const b of blocks) {
    if (b.code.split("\n").length >= 12)
      return make(b, "code", b.lang || "text", `${b.lang || "code"} snippet`);
  }
  for (const b of blocks) {
    if ((b.lang === "markdown" || b.lang === "md") && b.code.length > 200)
      return make(b, "markdown", "markdown", "Document");
  }
  return null;
}

/** The best artifact in a message. */
export function extractArtifact(content: string): Artifact | null {
  const m = extractArtifactMatch(content);
  if (!m) return null;
  const { start: _s, end: _e, ...art } = m;
  return art;
}

/**
 * The message body with its artifact blocks removed.
 *
 * The transcript shows a card instead of the code, so the several hundred lines
 * that produced it should not also scroll past above it. The surrounding prose
 * is kept — a model usually explains what it built, and that explanation is the
 * part worth reading inline.
 *
 * Only *artifact* blocks are removed. A twelve-line snippet the model included
 * to illustrate a point is not an artifact and stays in the transcript, which is
 * why this uses `extractArtifacts` (classified or `path=`-tagged) rather than
 * `extractArtifactMatch`, whose fallback tiers deliberately promote any long
 * code block so that *something* is previewable.
 */
export function stripArtifactBlock(content: string): string {
  const matches = extractArtifacts(content);
  if (matches.length === 0) {
    // Nothing was classified, so fall back to the single best block — that is
    // the pre-multi-file behaviour, and it is what makes a bare ```html page
    // with no attributes still leave the transcript clean.
    const m = extractArtifactMatch(content);
    if (!m) return content;
    return joinAround(content, [m]);
  }
  return joinAround(content, matches);
}

/** Remove several ranges, back to front so earlier offsets stay valid. */
function joinAround(content: string, ranges: { start: number; end: number }[]): string {
  let out = content;
  for (const r of [...ranges].sort((a, b) => b.start - a.start)) {
    const before = out.slice(0, r.start).replace(/\s+$/, "");
    const after = out.slice(r.end).replace(/^\s+/, "");
    out = before && after ? `${before}\n\n${after}` : before || after;
  }
  return out.trim();
}
