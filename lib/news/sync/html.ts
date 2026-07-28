import { decodeEntities } from "./xml";

// Turning feed HTML into plain text, and pulling the first usable image out of it.
//
// Feed `<description>` and `<content:encoded>` are almost always HTML — either
// inside CDATA or entity-escaped. Neither is safe to render and neither is
// readable as-is, so everything that reaches a `NewsArticle.summary` passes
// through `htmlToText` first.
//
// This is a text extractor, not a sanitiser. Nothing here is ever inserted as
// markup: React escapes the string on the way out, and the only HTML the app
// renders from a feed is none at all.

/**
 * The named entities publishers actually use beyond XML's five.
 *
 * A full HTML entity table is ~2000 entries and none of the rest show up in
 * headlines. Anything missing survives as literal text, which is a visible but
 * harmless defect — unlike a lookup mechanism, which is how XXE happens.
 */
const HTML_ENTITIES: Record<string, string> = {
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  trade: "™",
  copy: "©",
  reg: "®",
  deg: "°",
  bull: "•",
  middot: "·",
  laquo: "«",
  raquo: "»",
  times: "×",
  euro: "€",
  pound: "£",
  yen: "¥",
  frac12: "½",
  prime: "′",
  Prime: "″",
};

const HTML_ENTITY_RE = /&([a-zA-Z][a-zA-Z0-9]{1,10});/g;

function decodeHtmlEntities(input: string): string {
  if (!input.includes("&")) return input;
  return decodeEntities(input).replace(HTML_ENTITY_RE, (match, name: string) => {
    return HTML_ENTITIES[name] ?? match;
  });
}

// `<script>` and `<style>` need their *contents* dropped, not just their tags —
// stripping tags alone would splice a stylesheet into the summary.
const DROP_BLOCKS_RE = /<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
// Elements that imply a line break when flattened, so paragraphs do not run together.
const BREAK_RE = /<\/?(p|div|br|li|tr|h[1-6]|blockquote|section|article)\b[^>]*>/gi;
const TAG_RE = /<[^>]*>/g;

/**
 * Flatten feed HTML to readable plain text.
 *
 * Order matters: drop script/style bodies, convert block boundaries to newlines,
 * remove what is left of the markup, then decode entities. Decoding last means a
 * `&lt;script&gt;` in the source becomes the literal text `<script>` rather than
 * a tag that the tag-stripper would then have removed — the summary should show
 * what the publisher wrote, and this string is never rendered as markup anyway.
 */
export function htmlToText(input: string | undefined | null): string {
  if (!input) return "";

  const flattened = input
    .replace(DROP_BLOCKS_RE, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(BREAK_RE, "\n")
    .replace(TAG_RE, "");

  return decodeHtmlEntities(flattened)
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** True when the string looks like markup rather than plain prose. */
export function looksLikeHtml(input: string): boolean {
  return /<[a-z!/][^>]*>/i.test(input);
}

const IMG_SRC_RE = /<img\b[^>]*?\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const DIMENSION_RE = /\b(width|height)\s*=\s*("(\d+)"|'(\d+)'|(\d+))/gi;

export interface ExtractedImage {
  url: string;
  width?: number;
  height?: number;
}

/**
 * The first plausible `<img>` in a chunk of feed HTML.
 *
 * Last resort in the image precedence chain — `media:content`, `media:thumbnail`
 * and `<enclosure>` all carry declared dimensions and a MIME type, and are tried
 * first in `parse.ts`. Body images are frequently tracking pixels, spacers, or
 * subscribe badges, so anything that declares itself smaller than 200px on
 * either axis is skipped rather than returned.
 */
export function firstImageFrom(html: string | undefined | null): ExtractedImage | undefined {
  if (!html) return undefined;

  IMG_SRC_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = IMG_SRC_RE.exec(html))) {
    const url = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "").trim();
    if (!url || url.startsWith("data:")) continue;

    // Read the declared size off the same tag, not the whole document.
    const tagEnd = html.indexOf(">", match.index);
    const tag = html.slice(match.index, tagEnd < 0 ? match.index + 400 : tagEnd);

    let width: number | undefined;
    let height: number | undefined;
    DIMENSION_RE.lastIndex = 0;
    let dim: RegExpExecArray | null;
    while ((dim = DIMENSION_RE.exec(tag))) {
      const value = Number(dim[3] ?? dim[4] ?? dim[5]);
      if (!Number.isFinite(value)) continue;
      if (dim[1].toLowerCase() === "width") width = value;
      else height = value;
    }

    if ((width !== undefined && width < 200) || (height !== undefined && height < 200)) continue;

    return { url, width, height };
  }

  return undefined;
}

/**
 * Rough reading time in whole minutes, floored at 1.
 *
 * Deliberately computed from the feed's own excerpt, never from fetching the
 * article — Atlas does not scrape publisher pages. So this describes the excerpt
 * when a feed ships a summary, and the full post when it ships `content:encoded`.
 */
export function readingMinutes(text: string): number | undefined {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words < 60) return undefined;
  return Math.max(1, Math.round(words / 220));
}
