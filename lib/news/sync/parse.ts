import { firstImageFrom, htmlToText, looksLikeHtml } from "./html";
import { attr, child, children, elements, parseXml, textOf, type XmlNode } from "./xml";

// One reader for RSS 2.0, Atom 1.0 and RDF/RSS 1.0.
//
// The registry mixes all three — arXiv and a few academic blogs still publish
// RDF, most vendor blogs publish RSS 2.0, and The Register and several static
// site generators publish Atom. Rather than three adapters, the differences are
// small enough to absorb here: the flavours disagree about element names and
// where the link lives, and agree about everything else.
//
// Nothing in this file touches the network or the catalog. It takes a string and
// returns items — which is what makes it testable against fixtures with no
// mocking at all.

export interface RawFeedImage {
  url: string;
  width?: number;
  height?: number;
  /** MIME type when the feed declared one. */
  type?: string;
}

export interface RawFeedItem {
  title: string;
  /** As written in the feed — may be relative, and is resolved later in `normalize.ts`. */
  link: string;
  /** The feed's own excerpt, still HTML. */
  summaryHtml: string;
  /** Full post body when the feed ships one (`content:encoded` / Atom `content`). */
  contentHtml: string;
  /** ISO instant, or undefined when the feed gave no parseable date. */
  publishedAt?: string;
  author?: string;
  categories: string[];
  image?: RawFeedImage;
  /** The feed's own identifier. Only used to break ties; the article id comes from the URL. */
  guid?: string;
}

export interface ParsedFeed {
  title: string;
  items: RawFeedItem[];
  /** A limit in the XML reader was hit, so items may be missing. */
  truncated: boolean;
  /**
   * The document was a well-formed feed — an `<rss>`, `<feed>` or `<rdf>` root.
   *
   * This is what separates "this source published nothing today" from "this URL
   * now serves an HTML error page with HTTP 200". Both yield zero items, and
   * only the second is a failure worth naming in the UI. arXiv, for one,
   * declares `<skipDays>Saturday, Sunday</skipDays>` and serves a valid,
   * item-less channel all weekend.
   */
  recognized: boolean;
}

// --- Dates ------------------------------------------------------------------

/**
 * Parse a feed date to an ISO instant.
 *
 * `Date.parse` handles both RFC-822 (RSS) and ISO-8601 (Atom) in Node, so the
 * work here is rejecting what it accepts too eagerly: an unparseable string
 * yields NaN, and a feed with a clock skewed years into the future would
 * otherwise pin itself to the top of a recency-sorted feed forever.
 */
export function parseFeedDate(raw: string | undefined, now = Date.now()): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return undefined;

  // More than a day ahead is a wrong clock or a scheduled post, not news.
  if (ms > now + 86_400_000) return undefined;
  // Before the web existed is a placeholder date (`1970-01-01`, `0000-00-00`).
  if (ms < Date.UTC(1995, 0, 1)) return undefined;

  return new Date(ms).toISOString();
}

// --- Links ------------------------------------------------------------------

/**
 * The item's canonical link.
 *
 * Atom is the awkward one: an entry carries several `<link>` elements
 * distinguished by `rel`, and picking the wrong one lands on a comments feed or
 * an enclosure. Preference is `rel="alternate"` with an HTML type, then any
 * `alternate`, then a `<link>` with no `rel` at all (which Atom defines as
 * meaning `alternate`), and only then whatever is left.
 */
function itemLink(item: XmlNode): string {
  const links = children(item, "link");

  const scored = links
    .map((node) => {
      const href = attr(node, "href") || textOf(node);
      if (!href) return null;
      const rel = attr(node, "rel").toLowerCase();
      const type = attr(node, "type").toLowerCase();

      if (rel && rel !== "alternate" && rel !== "self") return { href, score: 1 };
      let score = 2;
      if (!rel || rel === "alternate") score = 4;
      if (rel === "self") score = 2;
      if (type.includes("html")) score += 1;
      return { href, score };
    })
    .filter((x): x is { href: string; score: number } => x !== null)
    .sort((a, b) => b.score - a.score);

  if (scored.length) return scored[0].href.trim();

  // RDF items put the URL in `rdf:about` on the item element itself.
  const about = attr(item, "about");
  if (about) return about.trim();

  // Last resort: a permalink guid. RSS says `isPermaLink` defaults to true.
  const guid = child(item, "guid", "id");
  const guidText = textOf(guid);
  if (guidText && /^https?:\/\//i.test(guidText) && attr(guid, "ispermalink") !== "false") {
    return guidText;
  }

  return "";
}

// --- Images -----------------------------------------------------------------

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|avif|gif)(\?|#|$)/i;

function isImageUrl(url: string, type: string, medium: string): boolean {
  if (medium === "image") return true;
  if (type.startsWith("image/")) return true;
  if (!type && !medium) return IMAGE_EXT_RE.test(url);
  return false;
}

function toDimension(raw: string): number | undefined {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function candidateFrom(node: XmlNode | undefined): RawFeedImage | undefined {
  if (!node) return undefined;
  const url = (attr(node, "url") || attr(node, "href") || textOf(node)).trim();
  if (!url) return undefined;

  const type = attr(node, "type").toLowerCase();
  const medium = attr(node, "medium").toLowerCase();
  if (!isImageUrl(url, type, medium)) return undefined;

  const width = toDimension(attr(node, "width"));
  const height = toDimension(attr(node, "height"));
  // Tracking pixels and spacer GIFs declare themselves. Drop them here rather
  // than shipping a 1×1 into the corpus and discovering it at render time.
  if ((width !== undefined && width < 200) || (height !== undefined && height < 200)) {
    return undefined;
  }

  return { url, width, height, type: type || undefined };
}

/**
 * Image precedence, best-declared first.
 *
 * Media RSS elements win because they carry dimensions and a MIME type, which is
 * what lets a tracking pixel be rejected before it ever reaches the proxy. A
 * body `<img>` is the last resort precisely because it declares the least.
 */
function itemImage(item: XmlNode, contentHtml: string, summaryHtml: string): RawFeedImage | undefined {
  const group = child(item, "group");

  const ordered: (XmlNode | undefined)[] = [
    ...children(item, "content"),
    ...(group ? children(group, "content") : []),
    ...children(item, "thumbnail"),
    ...(group ? children(group, "thumbnail") : []),
    ...children(item, "enclosure"),
    child(item, "image"),
  ];

  for (const node of ordered) {
    const found = candidateFrom(node);
    if (found) return found;
  }

  // Some feeds only expose the hero image in an `<itunes:image href>`-style
  // element or a bare `<url>` under `<image>`.
  const imageEl = child(item, "image");
  const nestedUrl = textOf(child(imageEl, "url"));
  if (nestedUrl && IMAGE_EXT_RE.test(nestedUrl)) return { url: nestedUrl.trim() };

  const inline = firstImageFrom(contentHtml) ?? firstImageFrom(summaryHtml);
  return inline ? { url: inline.url, width: inline.width, height: inline.height } : undefined;
}

// --- Item extraction --------------------------------------------------------

function itemAuthor(item: XmlNode): string | undefined {
  // Atom nests the name; RSS 2.0 puts an email-ish string in `<author>`; Dublin
  // Core and several generators use `<dc:creator>`.
  const atom = child(item, "author");
  const nested = textOf(child(atom, "name"));
  if (nested) return nested;

  const raw = textOf(child(item, "creator")) || textOf(atom);
  if (!raw) return undefined;

  // `ada@example.com (Ada Lovelace)` — RSS's odd convention.
  const parenthesised = raw.match(/\(([^)]+)\)\s*$/);
  const name = (parenthesised?.[1] ?? raw).trim();
  // A bare email address is not a byline worth showing.
  if (!name || (/^\S+@\S+$/.test(name) && !parenthesised)) return undefined;
  return name.slice(0, 120);
}

function itemCategories(item: XmlNode): string[] {
  const out = new Set<string>();
  for (const node of children(item, "category")) {
    // RSS puts it in the text, Atom in a `term` attribute.
    const value = (attr(node, "term") || textOf(node)).trim();
    if (value && value.length <= 60) out.add(value);
  }
  for (const node of children(item, "subject")) {
    const value = textOf(node).trim();
    if (value && value.length <= 60) out.add(value);
  }
  return [...out].slice(0, 12);
}

function toItem(node: XmlNode, now: number): RawFeedItem | null {
  const title = textOf(child(node, "title"));
  const link = itemLink(node);

  // An item with neither a headline nor a destination is not recoverable — it
  // could not be displayed and could not be verified.
  if (!title && !link) return null;

  // `content:encoded` (RSS) and `<content>` (Atom) hold the full body;
  // `description` / `summary` hold the excerpt. Some feeds ship only one.
  const encoded = children(node, "encoded")[0];
  const atomContent = children(node, "content").find((c) => !attr(c, "url") && !attr(c, "medium"));
  const contentHtml = textOf(encoded) || textOf(atomContent);
  const summaryHtml = textOf(child(node, "description", "summary", "subtitle"));

  const publishedAt =
    parseFeedDate(textOf(child(node, "published")), now) ??
    parseFeedDate(textOf(child(node, "pubdate")), now) ??
    parseFeedDate(textOf(child(node, "date")), now) ??
    parseFeedDate(textOf(child(node, "updated")), now) ??
    parseFeedDate(textOf(child(node, "modified")), now);

  return {
    title: htmlToText(title) || title,
    link,
    summaryHtml,
    contentHtml,
    publishedAt,
    author: itemAuthor(node),
    categories: itemCategories(node),
    image: itemImage(node, contentHtml, summaryHtml),
    guid: textOf(child(node, "guid", "id")) || undefined,
  };
}

// --- Entry point ------------------------------------------------------------

const EMPTY: ParsedFeed = { title: "", items: [], truncated: false, recognized: false };

/**
 * Parse a feed document into items.
 *
 * Never throws. A source that returns an HTML error page with HTTP 200 — which
 * happens more often than a clean 5xx — parses to zero items, and the caller in
 * `adapters/rss.ts` treats that as a failure rather than as a healthy feed that
 * happened to publish nothing.
 */
export function parseFeed(xml: string, options: { now?: number; maxItems?: number } = {}): ParsedFeed {
  const { now = Date.now(), maxItems = 120 } = options;
  if (!xml || !xml.trim()) return EMPTY;

  // `item` and `entry` are the two elements whose repetition *is* the feed, and
  // they never legitimately nest. Declaring that recovers the whole document
  // from a missing `</item>` instead of losing every item after the first.
  const { root, truncated } = parseXml(xml, { autoCloseSiblings: ["item", "entry"] });
  if (!root) return { ...EMPTY, truncated };

  let feedTitle = "";
  let itemNodes: XmlNode[] = [];
  const recognized =
    root.local === "feed" || root.local === "rss" || root.local === "rdf";

  if (root.local === "feed") {
    // Atom 1.0
    feedTitle = textOf(child(root, "title"));
    itemNodes = children(root, "entry");
  } else if (root.local === "rss") {
    const channel = child(root, "channel");
    feedTitle = textOf(child(channel, "title"));
    itemNodes = children(channel, "item");
  } else if (root.local === "rdf") {
    // RSS 1.0 — items are siblings of `<channel>`, not children of it.
    feedTitle = textOf(child(child(root, "channel"), "title"));
    itemNodes = children(root, "item");
    if (!itemNodes.length) itemNodes = children(child(root, "channel"), "item");
  } else {
    // Unrecognised root. Rather than give up, look for item-shaped elements
    // anywhere — a few feeds wrap RSS in an outer element, and the cost of
    // trying is one tree walk.
    feedTitle = textOf(child(root, "title"));
    itemNodes = [...children(root, "item"), ...children(root, "entry")];
    if (!itemNodes.length) {
      for (const node of elements(root)) {
        itemNodes = [...children(node, "item"), ...children(node, "entry")];
        if (itemNodes.length) break;
      }
    }
  }

  const items: RawFeedItem[] = [];
  for (const node of itemNodes.slice(0, maxItems)) {
    const item = toItem(node, now);
    if (item) items.push(item);
  }

  // An unrecognised root that nonetheless yielded items (an RSS document wrapped
  // in an outer element) is a feed by the only test that matters.
  return { title: htmlToText(feedTitle), items, truncated, recognized: recognized || items.length > 0 };
}

/** Best available prose for an item — the excerpt, falling back to the body. */
export function itemText(item: RawFeedItem): string {
  const summary = htmlToText(item.summaryHtml);
  if (summary.length >= 80) return summary;
  const content = htmlToText(item.contentHtml);
  if (content.length > summary.length) return content;
  return summary;
}

/** True when the item shipped markup we had to flatten. Useful in tests. */
export function hadMarkup(item: RawFeedItem): boolean {
  return looksLikeHtml(item.summaryHtml) || looksLikeHtml(item.contentHtml);
}
