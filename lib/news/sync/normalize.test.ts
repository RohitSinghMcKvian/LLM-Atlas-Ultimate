import { describe, expect, it } from "vitest";
import {
  articleId,
  canonicalizeUrl,
  clusterId,
  hostMatchesDomains,
  registrableDomain,
} from "./normalize";

describe("registrableDomain", () => {
  it("reduces a host to its registrable domain", () => {
    expect(registrableDomain("www.techcrunch.com")).toBe("techcrunch.com");
    expect(registrableDomain("openai.com")).toBe("openai.com");
    expect(registrableDomain("developers.googleblog.com")).toBe("googleblog.com");
  });

  it("handles multi-part public suffixes", () => {
    expect(registrableDomain("www.bbc.co.uk")).toBe("bbc.co.uk");
    expect(registrableDomain("news.example.com.au")).toBe("example.com.au");
    expect(registrableDomain("blog.example.co.jp")).toBe("example.co.jp");
  });

  it("treats blog platforms as the registrable unit", () => {
    // Two Substacks agreeing is one platform, not two independent publishers —
    // which is the conservative direction for a corroboration count.
    expect(registrableDomain("importai.substack.com")).toBe("substack.com");
    expect(registrableDomain("someone.github.io")).toBe("github.io");
  });

  it("handles single-label and trailing-dot hosts without throwing", () => {
    expect(registrableDomain("localhost")).toBe("localhost");
    expect(registrableDomain("openai.com.")).toBe("openai.com");
  });

  it("is case-insensitive", () => {
    expect(registrableDomain("WWW.OpenAI.COM")).toBe("openai.com");
  });
});

describe("hostMatchesDomains", () => {
  it("matches a host and its subdomains", () => {
    expect(hostMatchesDomains("openai.com", ["openai.com"])).toBe(true);
    expect(hostMatchesDomains("cdn.openai.com", ["openai.com"])).toBe(true);
  });

  it("does not match a suffix that is not a subdomain boundary", () => {
    // The bug this guards: `notopenai.com` must never satisfy `openai.com`.
    expect(hostMatchesDomains("notopenai.com", ["openai.com"])).toBe(false);
    expect(hostMatchesDomains("openai.com.evil.test", ["openai.com"])).toBe(false);
  });
});

describe("canonicalizeUrl", () => {
  it("strips tracking parameters", () => {
    const result = canonicalizeUrl(
      "https://example.com/post?utm_source=rss&utm_medium=feed&id=7&fbclid=abc&ref=hn",
    );
    expect(result?.url).toBe("https://example.com/post?id=7");
  });

  it("removes the query string entirely when only tracking remained", () => {
    expect(canonicalizeUrl("https://example.com/post?utm_source=rss")?.url).toBe(
      "https://example.com/post",
    );
  });

  it("lowercases the host and drops the fragment", () => {
    const result = canonicalizeUrl("https://WWW.Example.COM/Post#section-2");
    expect(result?.url).toBe("https://www.example.com/Post");
    expect(result?.host).toBe("www.example.com");
    expect(result?.domain).toBe("example.com");
  });

  it("preserves path case, because paths are case-sensitive", () => {
    expect(canonicalizeUrl("https://example.com/Blog/My-Post")?.url).toContain("/Blog/My-Post");
  });

  it("resolves relative links against the feed homepage", () => {
    const result = canonicalizeUrl("/blog/nova-3", "https://example-lab.com/blog/");
    expect(result?.url).toBe("https://example-lab.com/blog/nova-3");
  });

  it("rejects a relative link with no base", () => {
    expect(canonicalizeUrl("/blog/nova-3")).toBeUndefined();
  });

  it("rejects dangerous and non-web schemes", () => {
    // A javascript: URL reaching a card's href would be a stored XSS.
    expect(canonicalizeUrl("javascript:alert(1)")).toBeUndefined();
    expect(canonicalizeUrl("  JavaScript:alert(1)")).toBeUndefined();
    expect(canonicalizeUrl("data:text/html,<script>")).toBeUndefined();
    expect(canonicalizeUrl("file:///etc/passwd")).toBeUndefined();
    expect(canonicalizeUrl("ftp://example.com/x")).toBeUndefined();
  });

  it("rejects credentials embedded in the URL", () => {
    expect(canonicalizeUrl("https://user:pass@example.com/a")).toBeUndefined();
  });

  it("rejects hosts with no dot", () => {
    expect(canonicalizeUrl("https://localhost/a")).toBeUndefined();
    expect(canonicalizeUrl("")).toBeUndefined();
    expect(canonicalizeUrl("   ")).toBeUndefined();
  });

  it("returns undefined for unparseable input instead of throwing", () => {
    expect(canonicalizeUrl("http://")).toBeUndefined();
    expect(canonicalizeUrl("https://[not a host]/x")).toBeUndefined();
  });
});

describe("article identity", () => {
  it("is stable across syncs for the same URL", () => {
    const a = canonicalizeUrl("https://example.com/post?id=7")!;
    const b = canonicalizeUrl("https://example.com/post?id=7")!;
    expect(articleId(a.key)).toBe(articleId(b.key));
  });

  it("is unchanged by tracking parameters, www, scheme or a trailing slash", () => {
    // This is what makes a user's saved and read state survive the hourly rebuild
    // and a story being picked up by a second feed.
    const canonical = canonicalizeUrl("https://example.com/post")!;
    const variants = [
      "https://www.example.com/post/",
      "http://example.com/post",
      "https://example.com/post?utm_source=rss",
      "https://example.com/post#top",
      "https://example.com/post/amp",
    ];
    for (const variant of variants) {
      expect(articleId(canonicalizeUrl(variant)!.key), variant).toBe(articleId(canonical.key));
    }
  });

  it("sorts remaining query parameters so order does not change the id", () => {
    const one = canonicalizeUrl("https://example.com/p?b=2&a=1")!;
    const two = canonicalizeUrl("https://example.com/p?a=1&b=2")!;
    expect(articleId(one.key)).toBe(articleId(two.key));
  });

  it("differs for different articles", () => {
    const a = canonicalizeUrl("https://example.com/post-a")!;
    const b = canonicalizeUrl("https://example.com/post-b")!;
    expect(articleId(a.key)).not.toBe(articleId(b.key));
  });

  it("keeps the display URL usable even though the key is aggressive", () => {
    // The key drops `www.`; the link must not, because some hosts do not serve
    // the bare domain and the reader has to be able to follow it.
    const result = canonicalizeUrl("https://www.example.com/post/")!;
    expect(result.url).toBe("https://www.example.com/post/");
    expect(result.key).toBe("example.com/post");
  });

  it("derives a stable cluster id from its lead", () => {
    expect(clusterId("abc")).toBe(clusterId("abc"));
    expect(clusterId("abc")).not.toBe(clusterId("abd"));
    expect(clusterId("abc").startsWith("c")).toBe(true);
  });
});
