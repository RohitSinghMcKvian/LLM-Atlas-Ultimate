import { describe, expect, it } from "vitest";
import {
  attr,
  child,
  children,
  decodeEntities,
  elements,
  findDescendant,
  parseXml,
  textOf,
} from "./xml";

describe("decodeEntities", () => {
  it("decodes the five predefined entities", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;")).toBe(
      `a & b <c> "d" 'e'`,
    );
  });

  it("decodes decimal and hex character references", () => {
    expect(decodeEntities("&#8212;")).toBe("—");
    expect(decodeEntities("&#x2014;")).toBe("—");
    expect(decodeEntities("&#x1F600;")).toBe("\u{1F600}");
  });

  it("leaves unknown named entities exactly as written", () => {
    // The moment an unknown reference is *looked up*, XXE becomes possible.
    expect(decodeEntities("&xxe;")).toBe("&xxe;");
    expect(decodeEntities("&nbsp;")).toBe("&nbsp;");
  });

  it("leaves a bare ampersand alone", () => {
    // Publishers emit unescaped query strings constantly. This must survive.
    const url = "https://example.com/a?x=1&y=2&utm_source=rss";
    expect(decodeEntities(url)).toBe(url);
  });

  it("rejects out-of-range and surrogate code points instead of throwing", () => {
    expect(decodeEntities("&#0;")).toBe("&#0;");
    expect(decodeEntities("&#xD800;")).toBe("&#xD800;");
    expect(decodeEntities("&#x110000;")).toBe("&#x110000;");
  });
});

describe("parseXml", () => {
  it("parses elements, attributes and nested text", () => {
    const { root, truncated } = parseXml(
      `<rss version="2.0"><channel><title>Atlas</title></channel></rss>`,
    );
    expect(truncated).toBe(false);
    expect(root?.local).toBe("rss");
    expect(attr(root, "version")).toBe("2.0");
    expect(textOf(child(child(root, "channel"), "title"))).toBe("Atlas");
  });

  it("keeps mixed content in document order", () => {
    const { root } = parseXml(`<title>Claude <em>Opus</em> ships today</title>`);
    expect(textOf(root)).toBe("Claude Opus ships today");
  });

  it("reads CDATA verbatim, without entity decoding", () => {
    const { root } = parseXml(
      `<description><![CDATA[<p>Tokens cost &lt;$1 &amp; falling</p>]]></description>`,
    );
    // Inside CDATA the `&lt;` is literal text, not an escaped `<`.
    expect(textOf(root)).toBe("<p>Tokens cost &lt;$1 &amp; falling</p>");
  });

  it("recovers from a bare ampersand inside an attribute and a link", () => {
    const { root } = parseXml(
      `<item><link>https://ex.com/a?x=1&y=2</link><enclosure url="https://cdn.ex.com/i.jpg?w=1&h=2"/></item>`,
    );
    expect(textOf(child(root, "link"))).toBe("https://ex.com/a?x=1&y=2");
    expect(attr(child(root, "enclosure"), "url")).toBe("https://cdn.ex.com/i.jpg?w=1&h=2");
  });

  it("handles self-closing tags and attributes containing '>'", () => {
    const { root } = parseXml(
      `<item><media:content url="https://ex.com/a.jpg" width="800" /><title>A &gt; B</title></item>`,
    );
    expect(attr(child(root, "content"), "width")).toBe("800");
    expect(textOf(child(root, "title"))).toBe("A > B");
  });

  it("strips namespace prefixes from element and attribute names", () => {
    const { root } = parseXml(`<entry><dc:creator xml:lang="en">Ada</dc:creator></entry>`);
    const creator = child(root, "creator");
    expect(creator?.name).toBe("dc:creator");
    expect(creator?.local).toBe("creator");
    expect(attr(creator, "lang")).toBe("en");
  });

  it("accepts unquoted attribute values", () => {
    const { root } = parseXml(`<item><enclosure url=https://ex.com/a.jpg type=image/jpeg /></item>`);
    expect(attr(child(root, "enclosure"), "url")).toBe("https://ex.com/a.jpg");
    expect(attr(child(root, "enclosure"), "type")).toBe("image/jpeg");
  });

  it("skips comments and processing instructions", () => {
    const { root } = parseXml(
      `<?xml version="1.0" encoding="UTF-8"?><!-- generated --><rss><channel><!-- x --><title>Ok</title></channel></rss>`,
    );
    expect(textOf(findDescendant(root, "title"))).toBe("Ok");
    expect(elements(child(root, "channel")).length).toBe(1);
  });

  it("tolerates a UTF-8 BOM before the declaration", () => {
    const { root } = parseXml(`﻿<?xml version="1.0"?><rss><channel/></rss>`);
    expect(root?.local).toBe("rss");
  });

  // The security test. A conforming parser that resolves the internal subset
  // would substitute the file contents here; this one never reads the subset at
  // all, so there is nothing to substitute.
  it("does NOT expand entities declared in a DOCTYPE (XXE)", () => {
    const xxe = `<?xml version="1.0"?>
<!DOCTYPE foo [
  <!ELEMENT foo ANY >
  <!ENTITY xxe SYSTEM "file:///etc/passwd" >
]>
<foo><title>&xxe;</title></foo>`;

    const { root } = parseXml(xxe);
    expect(root?.local).toBe("foo");
    const title = textOf(child(root, "title"));
    expect(title).toBe("&xxe;");
    expect(title).not.toContain("root:");
    expect(title).not.toContain("/etc/passwd");
  });

  it("does not expand a recursive entity declaration (billion laughs)", () => {
    const bomb = `<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;">
]>
<lolz>&lol3;</lolz>`;

    const { root } = parseXml(bomb);
    expect(textOf(root)).toBe("&lol3;");
  });

  it("skips a DOCTYPE whose internal subset contains '>'", () => {
    const { root } = parseXml(
      `<!DOCTYPE feed [ <!ENTITY gt2 "a > b"> ]><feed><title>Fine</title></feed>`,
    );
    expect(root?.local).toBe("feed");
    expect(textOf(child(root, "title"))).toBe("Fine");
  });

  it("returns a partial tree for malformed input instead of throwing", () => {
    const { root } = parseXml(`<rss><channel><title>Half a feed`);
    expect(root?.local).toBe("rss");
    expect(textOf(findDescendant(root, "title"))).toBe("Half a feed");
  });

  it("unwinds to the matching ancestor when an element is left unclosed", () => {
    // `<br>` is never closed. The `</item>` must still close the item rather
    // than being swallowed, so `<title>` after it stays a sibling of `<item>`.
    const { root } = parseXml(
      `<channel><item><description>a<br>b</description></item><title>After</title></channel>`,
    );
    expect(textOf(child(root, "title"))).toBe("After");
    expect(children(root, "item").length).toBe(1);
  });

  it("treats a repeated autoCloseSiblings element as a sibling, not a child", () => {
    // A feed that forgets `</item>` otherwise parses as ONE item with every
    // later item buried inside it — 40 stories silently become 1.
    const xml = `<channel><item><title>A</title><item><title>B</title></item></channel>`;
    const withRule = parseXml(xml, { autoCloseSiblings: ["item"] });
    expect(children(withRule.root, "item").length).toBe(2);

    const without = parseXml(xml);
    expect(children(without.root, "item").length).toBe(1);
  });

  it("ignores a stray closing tag with no matching ancestor", () => {
    const { root } = parseXml(`<channel></nope><title>Kept</title></channel>`);
    expect(textOf(child(root, "title"))).toBe("Kept");
  });

  it("keeps an unescaped '<' that starts nothing as text", () => {
    const { root } = parseXml(`<title>a < b</title>`);
    expect(textOf(root)).toBe("a < b");
  });

  it("flags truncation when the character cap is hit", () => {
    const long = `<rss><channel>${"<item><title>x</title></item>".repeat(200)}</channel></rss>`;
    const { root, truncated } = parseXml(long, { maxChars: 300 });
    expect(truncated).toBe(true);
    expect(root?.local).toBe("rss");
  });

  it("flags truncation when the node cap is hit", () => {
    const many = `<rss>${"<item/>".repeat(50)}</rss>`;
    const { root, truncated } = parseXml(many, { maxNodes: 10 });
    expect(truncated).toBe(true);
    expect(children(root, "item").length).toBeLessThanOrEqual(10);
  });

  it("stops descending at the depth cap without dropping siblings", () => {
    const deep = `${"<a>".repeat(80)}x${"</a>".repeat(80)}`;
    const { truncated } = parseXml(deep, { maxDepth: 8 });
    expect(truncated).toBe(true);
  });

  it("does not overflow the stack on pathologically deep input", () => {
    // The reason the parser is iterative. A recursive descent dies here, and a
    // crashed background sync is far harder to notice than a truncated feed.
    const deep = `${"<a>".repeat(50_000)}x${"</a>".repeat(50_000)}`;
    expect(() => parseXml(deep, { maxDepth: 100_000, maxNodes: 200_000 })).not.toThrow();
  });

  it("returns a null root for empty or text-only input", () => {
    expect(parseXml("").root).toBeNull();
    expect(parseXml("   \n  ").root).toBeNull();
    expect(parseXml("not xml at all").root).toBeNull();
  });

  it("keeps only the first root element", () => {
    const { root } = parseXml(`<a><title>One</title></a><b><title>Two</title></b>`);
    expect(root?.local).toBe("a");
    expect(textOf(child(root, "title"))).toBe("One");
  });
});
