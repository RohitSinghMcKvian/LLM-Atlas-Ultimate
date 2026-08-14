import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { firstImageFrom, htmlToText, readingMinutes } from "./html";
import { itemText, parseFeed, parseFeedDate } from "./parse";

const FIXTURES = path.join(__dirname, "__fixtures__");
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");

// A fixed "now" so date rejection thresholds are deterministic.
const NOW = Date.parse("2025-07-16T12:00:00Z");

describe("parseFeedDate", () => {
  it("parses RFC-822 (RSS) and ISO-8601 (Atom)", () => {
    expect(parseFeedDate("Tue, 15 Jul 2025 10:30:00 GMT", NOW)).toBe("2025-07-15T10:30:00.000Z");
    expect(parseFeedDate("2025-07-15T11:15:00Z", NOW)).toBe("2025-07-15T11:15:00.000Z");
  });

  it("returns undefined for unparseable input", () => {
    expect(parseFeedDate("Not a date", NOW)).toBeUndefined();
    expect(parseFeedDate("", NOW)).toBeUndefined();
    expect(parseFeedDate(undefined, NOW)).toBeUndefined();
  });

  it("rejects placeholder and far-future dates", () => {
    // A feed with a skewed clock would otherwise pin itself to the top of a
    // recency sort permanently.
    expect(parseFeedDate("2099-01-01T00:00:00Z", NOW)).toBeUndefined();
    expect(parseFeedDate("1970-01-01T00:00:00Z", NOW)).toBeUndefined();
  });

  it("allows a few hours of clock skew", () => {
    expect(parseFeedDate("2025-07-16T15:00:00Z", NOW)).toBe("2025-07-16T15:00:00.000Z");
  });
});

describe("parseFeed — RSS 2.0", () => {
  const feed = parseFeed(fixture("rss2.xml"), { now: NOW });

  it("reads the channel title and every item", () => {
    expect(feed.title).toBe("Example Lab Blog");
    expect(feed.items.length).toBe(4);
    expect(feed.truncated).toBe(false);
  });

  it("reads title, link, date and categories", () => {
    const item = feed.items[0];
    expect(item.title).toBe("Example Lab introduces Nova 3, its most capable model");
    // The `&amp;` in the query string is decoded; stripping utm_* happens later.
    expect(item.link).toBe("https://example-lab.com/blog/nova-3?utm_source=rss&utm_medium=feed");
    expect(item.publishedAt).toBe("2025-07-15T10:30:00.000Z");
    expect(item.categories).toEqual(["Models", "Research"]);
  });

  it("extracts the byline from the RSS email-with-parentheses convention", () => {
    expect(feed.items[0].author).toBe("Ada Lovelace");
  });

  it("prefers media:content over an inline body image", () => {
    expect(feed.items[0].image).toEqual({
      url: "https://cdn.example-lab.com/nova-3-card.jpg",
      width: 1600,
      height: 900,
      type: "image/jpeg",
    });
  });

  it("falls back to <enclosure> when there is no media element", () => {
    expect(feed.items[1].image?.url).toBe("https://cdn.example-lab.com/pricing.png");
    expect(feed.items[1].image?.type).toBe("image/png");
  });

  it("drops declared tracking pixels and 16px thumbnails entirely", () => {
    // Both the media:thumbnail and the inline <img> declare themselves tiny.
    expect(feed.items[2].image).toBeUndefined();
  });

  it("leaves publishedAt undefined when the feed gave no date", () => {
    // The sync fills this from `firstSeenAt` — `parse` does not invent one.
    expect(feed.items[3].publishedAt).toBeUndefined();
  });

  it("keeps CDATA markup for later flattening, not raw in the summary", () => {
    const text = itemText(feed.items[0]);
    expect(text).toContain("$3 per million input tokens");
    expect(text).not.toContain("<strong>");
    expect(text).not.toContain("tracking()");
  });
});

describe("parseFeed — Atom", () => {
  const feed = parseFeed(fixture("atom.xml"), { now: NOW });

  it("reads entries and the feed title", () => {
    expect(feed.title).toBe("Example Register — AI");
    expect(feed.items.length).toBe(2);
  });

  it("picks rel=alternate over rel=replies and rel=self", () => {
    // Picking the wrong <link> lands the reader on a comments page.
    expect(feed.items[0].link).toBe("https://example-register.com/ai/inquiry");
  });

  it("prefers <published> over <updated>", () => {
    expect(feed.items[0].publishedAt).toBe("2025-07-15T11:15:00.000Z");
  });

  it("falls back to <updated> when there is no <published>", () => {
    expect(feed.items[1].publishedAt).toBe("2025-07-14T16:00:00.000Z");
  });

  it("reads the nested Atom author name, not the email", () => {
    expect(feed.items[0].author).toBe("Grace Hopper");
  });

  it("reads categories from the term attribute", () => {
    expect(feed.items[0].categories).toEqual(["policy", "regulation"]);
  });

  it("keeps inline markup in a title in document order", () => {
    expect(feed.items[1].title).toBe("Open weights release lands for Vega 8B");
  });

  it("handles doubly-escaped HTML in type=\"html\" content", () => {
    const text = itemText(feed.items[0]);
    expect(text).toContain("training corpora were assembled & licensed");
    expect(text).not.toContain("<p>");
  });

  it("accepts a <link> with no rel attribute", () => {
    expect(feed.items[1].link).toBe("https://example-register.com/ai/vega-8b");
  });
});

describe("parseFeed — RDF / RSS 1.0", () => {
  const feed = parseFeed(fixture("rdf.xml"), { now: NOW });

  it("finds items that are siblings of <channel>, not children", () => {
    expect(feed.title).toBe("arXiv example cs.AI");
    expect(feed.items.length).toBe(2);
  });

  it("reads dc:date and dc:creator", () => {
    expect(feed.items[0].publishedAt).toBe("2025-07-15T00:00:00.000Z");
    expect(feed.items[0].author).toBe("Alan Turing, Katherine Johnson");
  });

  it("falls back to rdf:about when there is no <link>", () => {
    expect(feed.items[1].link).toBe("https://arxiv.example.org/abs/2507.05678");
  });

  it("reads dc:subject as a category", () => {
    expect(feed.items[0].categories).toEqual(["cs.AI"]);
  });
});

describe("parseFeed — malformed input", () => {
  const feed = parseFeed(fixture("broken.xml"), { now: NOW });

  it("recovers items from a feed with unclosed elements and bare ampersands", () => {
    expect(feed.items.length).toBeGreaterThanOrEqual(2);
    expect(feed.items[0].link).toBe("https://sloppy.example.com/post?id=1&ref=rss&utm_source=x");
    expect(feed.items[1].title).toBe("Second item, first was never closed");
  });

  it("leaves the date undefined rather than inventing one", () => {
    expect(feed.items[0].publishedAt).toBeUndefined();
    expect(feed.items[1].publishedAt).toBe("2025-07-16T07:00:00.000Z");
  });

  // The failure mode that otherwise looks like health: a source that returns an
  // error page with HTTP 200 contributes nothing while reporting success.
  it("returns zero items for an HTML error page served as 200", () => {
    const html = `<!DOCTYPE html><html><head><title>503 Service Unavailable</title></head>
      <body><h1>Temporarily unavailable</h1><p>Try again later.</p></body></html>`;
    expect(parseFeed(html, { now: NOW }).items).toEqual([]);
  });

  it("returns zero items for empty, blank, or non-XML input", () => {
    expect(parseFeed("", { now: NOW }).items).toEqual([]);
    expect(parseFeed("   ", { now: NOW }).items).toEqual([]);
    expect(parseFeed("not xml", { now: NOW }).items).toEqual([]);
  });

  it("returns zero items for a well-formed feed with no entries", () => {
    const empty = `<?xml version="1.0"?><rss version="2.0"><channel><title>Quiet</title></channel></rss>`;
    const parsed = parseFeed(empty, { now: NOW });
    expect(parsed.title).toBe("Quiet");
    expect(parsed.items).toEqual([]);
  });

  it("drops items that have neither a title nor a link", () => {
    const feedXml = `<rss><channel><item><description>orphan</description></item>
      <item><title>Real</title><link>https://ex.com/a</link></item></channel></rss>`;
    const parsed = parseFeed(feedXml, { now: NOW });
    expect(parsed.items.map((i) => i.title)).toEqual(["Real"]);
  });

  it("caps the number of items it will return", () => {
    const many = `<rss><channel>${'<item><title>x</title><link>https://ex.com/a</link></item>'.repeat(400)}</channel></rss>`;
    expect(parseFeed(many, { now: NOW, maxItems: 50 }).items.length).toBe(50);
  });
});

describe("htmlToText", () => {
  it("drops script and style bodies, not just their tags", () => {
    const html = `<p>Real text</p><script>alert('x')</script><style>.a{color:red}</style>`;
    const text = htmlToText(html);
    expect(text).toBe("Real text");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("color:red");
  });

  it("turns block boundaries into line breaks rather than running words together", () => {
    expect(htmlToText("<p>One</p><p>Two</p>")).toBe("One\nTwo");
    expect(htmlToText("A<br>B")).toBe("A\nB");
  });

  it("decodes the HTML entities publishers actually use", () => {
    expect(htmlToText("A&nbsp;B &mdash; C&hellip;")).toBe("A B — C…");
  });

  it("leaves unknown entities as literal text", () => {
    expect(htmlToText("&notarealentity;")).toBe("&notarealentity;");
  });

  it("collapses runs of whitespace", () => {
    expect(htmlToText("  a   \n\n\n  b  ")).toBe("a\nb");
  });

  it("returns empty string for nullish input", () => {
    expect(htmlToText(undefined)).toBe("");
    expect(htmlToText(null)).toBe("");
    expect(htmlToText("")).toBe("");
  });
});

describe("firstImageFrom", () => {
  it("finds the first sufficiently large image", () => {
    const html = `<img src="https://cdn.ex.com/pixel.gif" width="1" height="1">
      <img src="https://cdn.ex.com/hero.jpg" width="1200" height="630">`;
    expect(firstImageFrom(html)).toEqual({
      url: "https://cdn.ex.com/hero.jpg",
      width: 1200,
      height: 630,
    });
  });

  it("accepts an image with no declared dimensions", () => {
    expect(firstImageFrom(`<img src="https://cdn.ex.com/a.jpg">`)?.url).toBe(
      "https://cdn.ex.com/a.jpg",
    );
  });

  it("skips data URIs", () => {
    expect(firstImageFrom(`<img src="data:image/gif;base64,R0lGOD">`)).toBeUndefined();
  });

  it("reads dimensions from the same tag, not a neighbouring one", () => {
    const html = `<img src="https://cdn.ex.com/a.jpg"><div width="1" height="1"></div>`;
    expect(firstImageFrom(html)?.url).toBe("https://cdn.ex.com/a.jpg");
  });

  it("decodes entities in the src", () => {
    expect(firstImageFrom(`<img src="https://cdn.ex.com/a.jpg?w=1&amp;h=2">`)?.url).toBe(
      "https://cdn.ex.com/a.jpg?w=1&h=2",
    );
  });

  it("returns undefined when there is no image", () => {
    expect(firstImageFrom("<p>text</p>")).toBeUndefined();
    expect(firstImageFrom(undefined)).toBeUndefined();
  });
});

describe("readingMinutes", () => {
  it("is undefined for short excerpts", () => {
    expect(readingMinutes("a short blurb")).toBeUndefined();
  });

  it("rounds to whole minutes with a floor of one", () => {
    expect(readingMinutes("word ".repeat(100))).toBe(1);
    expect(readingMinutes("word ".repeat(660))).toBe(3);
  });
});

describe("parseFeed recognition", () => {
  // Zero items has two causes with opposite meanings, and only the parser can
  // tell them apart. `adapters/rss.ts` reports the first as `skipped` and the
  // second as `failed`; conflating them put a permanent "3 of 32 sources
  // failed" banner over the feed every weekend, because arXiv declares
  // `<skipDays>Saturday, Sunday</skipDays>` and serves an empty channel.
  it("recognises a valid RSS channel that published nothing", () => {
    const weekend = `<?xml version='1.0' encoding='UTF-8'?>
<rss version="2.0"><channel>
  <title>cs.AI updates on arXiv.org</title>
  <skipDays><day>Saturday</day><day>Sunday</day></skipDays>
</channel></rss>`;

    const parsed = parseFeed(weekend);
    expect(parsed.items).toEqual([]);
    expect(parsed.recognized).toBe(true);
  });

  it("recognises an empty Atom feed", () => {
    const parsed = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><title>Quiet</title></feed>`);
    expect(parsed.items).toEqual([]);
    expect(parsed.recognized).toBe(true);
  });

  it("does NOT recognise an HTML error page served with HTTP 200", () => {
    const parsed = parseFeed(`<html><body><h1>404 Not Found</h1></body></html>`);
    expect(parsed.items).toEqual([]);
    expect(parsed.recognized).toBe(false);
  });

  it("does not recognise empty or non-XML input", () => {
    expect(parseFeed("").recognized).toBe(false);
    expect(parseFeed("not xml at all").recognized).toBe(false);
  });

  it("recognises a wrapped feed on the strength of its items", () => {
    const wrapped = `<wrapper><channel><item><title>A</title><link>https://ex.com/a</link></item></channel></wrapper>`;
    const parsed = parseFeed(wrapped);
    expect(parsed.items.length).toBe(1);
    expect(parsed.recognized).toBe(true);
  });
});
