import { describe, it, expect } from "vitest";
import { citedNumbers, groundingWarning, reconcileCitations } from "./citations";
import {
  canonicalUrl,
  dedupeSources,
  decodeHtml,
  listProviders,
  parseDuckDuckGoHtml,
  providerById,
  SEARCH_PROVIDERS,
} from "./providers";
import type { WebSource } from "@/lib/chat/types";

function src(n: number, host = "example.com"): WebSource {
  return { title: `Source ${n}`, url: `https://${host}/${n}`, snippet: `s${n}` };
}

describe("citedNumbers", () => {
  it("finds distinct numbers in order of first appearance", () => {
    expect(citedNumbers("a [2] b [1] c [2]")).toEqual([2, 1]);
  });

  it("handles adjacent citation runs", () => {
    expect(citedNumbers("claim [1][3][2]")).toEqual([1, 3, 2]);
  });

  it("ignores bracketed text that is not a citation", () => {
    expect(citedNumbers("see [note] and [a1] and []")).toEqual([]);
  });

  it("returns nothing for an uncited answer", () => {
    expect(citedNumbers("no citations here")).toEqual([]);
  });
});

describe("reconcileCitations", () => {
  const available = [src(1), src(2), src(3), src(4)];

  it("keeps valid citations and returns only the cited sources", () => {
    const r = reconcileCitations("A [1] and B [3].", available);
    expect(r.sources.map((s) => s.url)).toEqual([
      "https://example.com/1",
      "https://example.com/3",
    ]);
    expect(r.invalid).toEqual([]);
  });

  // After dropping uncited sources the original numbers no longer index the
  // displayed list, so leaving them would point every marker at the wrong entry.
  it("renumbers so markers match the displayed list", () => {
    const r = reconcileCitations("A [3] and B [1].", available);
    expect(r.text).toBe("A [1] and B [2].");
    expect(r.sources[0].url).toBe("https://example.com/3");
    expect(r.sources[1].url).toBe("https://example.com/1");
  });

  it("keeps repeated citations pointing at the same source", () => {
    const r = reconcileCitations("A [2]. B [2]. C [1].", available);
    expect(r.text).toBe("A [1]. B [1]. C [2].");
    expect(r.sources).toHaveLength(2);
  });

  // A marker pointing at a source that was never retrieved looks authoritative
  // and points at nothing.
  it("removes an out-of-range citation and reports it", () => {
    const r = reconcileCitations("Claim [9].", available);
    expect(r.text).toBe("Claim.");
    expect(r.invalid).toEqual([9]);
    expect(r.sources).toEqual([]);
  });

  it("removes a zero citation", () => {
    expect(reconcileCitations("Claim [0].", available).invalid).toEqual([0]);
  });

  // Rewriting it to a valid number would invent a citation the model never made.
  it("never rewrites an invalid marker into a valid one", () => {
    const r = reconcileCitations("Only [9].", available);
    expect(r.text).not.toContain("[1]");
  });

  it("handles a mix of valid and invalid in one answer", () => {
    const r = reconcileCitations("A [2], B [99], C [4].", available);
    expect(r.text).toBe("A [1], B, C [2].");
    expect(r.invalid).toEqual([99]);
    expect(r.sources).toHaveLength(2);
  });

  it("flags an entirely uncited answer", () => {
    const r = reconcileCitations("No citations at all.", available);
    expect(r.uncited).toBe(true);
    expect(r.sources).toEqual([]);
  });

  it("copes with an empty source list", () => {
    const r = reconcileCitations("Claim [1].", []);
    expect(r.invalid).toEqual([1]);
    expect(r.uncited).toBe(true);
  });

  // Only whitespace and punctuation spacing — never wording.
  it("tidies the gap a removed marker leaves, without changing words", () => {
    const r = reconcileCitations("The sky is blue [9] .", available);
    expect(r.text).toBe("The sky is blue.");
  });

  it("leaves prose otherwise untouched", () => {
    const prose = "One [1].\n\nTwo paragraphs, with **markdown** and `code`.";
    expect(reconcileCitations(prose, available).text).toBe(prose);
  });
});

describe("groundingWarning", () => {
  it("says nothing when no search happened", () => {
    const r = reconcileCitations("plain answer", []);
    expect(groundingWarning(r, false)).toBeNull();
  });

  it("warns when a searched answer cites nothing", () => {
    const r = reconcileCitations("plain answer", [src(1)]);
    expect(groundingWarning(r, true)).toContain("unverified");
  });

  it("reports removed citations", () => {
    const r = reconcileCitations("A [1], B [9].", [src(1)]);
    expect(groundingWarning(r, true)).toContain("Removed 1 citation");
  });

  it("says nothing for a well-cited answer", () => {
    const r = reconcileCitations("A [1].", [src(1)]);
    expect(groundingWarning(r, true)).toBeNull();
  });
});

// ── providers ───────────────────────────────────────────────────────────────

describe("providerById", () => {
  it("returns the named provider", () => {
    expect(providerById("brave").id).toBe("brave");
  });

  it("falls back to the keyless default for anything unknown", () => {
    expect(providerById("nonsense").id).toBe("duckduckgo");
    expect(providerById(undefined).id).toBe("duckduckgo");
  });

  it("lists the keyless provider first", () => {
    expect(listProviders()[0].needsKey).toBe(false);
  });

  it("only the default works without a key", () => {
    const keyless = Object.values(SEARCH_PROVIDERS).filter((p) => !p.needsKey);
    expect(keyless.map((p) => p.id)).toEqual(["duckduckgo"]);
  });
});

describe("provider requests", () => {
  it("puts the Brave key in its subscription header, never the URL", () => {
    const r = SEARCH_PROVIDERS.brave.request("cats", 5, "SECRET");
    expect(r.headers["X-Subscription-Token"]).toBe("SECRET");
    expect(r.url).not.toContain("SECRET");
  });

  it("puts the Tavily key in the Authorization header, never the body", () => {
    const r = SEARCH_PROVIDERS.tavily.request("cats", 5, "SECRET");
    expect(r.headers.Authorization).toBe("Bearer SECRET");
    expect(r.body).not.toContain("SECRET");
  });

  it("puts the Exa key in its header, never the body", () => {
    const r = SEARCH_PROVIDERS.exa.request("cats", 5, "SECRET");
    expect(r.headers["x-api-key"]).toBe("SECRET");
    expect(r.body).not.toContain("SECRET");
  });

  it("encodes the query rather than interpolating it raw", () => {
    expect(SEARCH_PROVIDERS.brave.request("a b&c", 5, "k").url).toContain("a%20b%26c");
  });

  it("clamps the result count", () => {
    expect(SEARCH_PROVIDERS.brave.request("q", 999, "k").url).toContain("count=10");
    expect(SEARCH_PROVIDERS.brave.request("q", 0, "k").url).toContain("count=5");
  });

  it("marks DuckDuckGo as an HTML response", () => {
    expect(SEARCH_PROVIDERS.duckduckgo.request("q", 5).html).toBe(true);
    expect(SEARCH_PROVIDERS.brave.request("q", 5, "k").html).toBeUndefined();
  });
});

describe("provider parsing", () => {
  it("reads Brave results", () => {
    const out = SEARCH_PROVIDERS.brave.parse(
      { web: { results: [{ title: "T", url: "https://a.test/", description: "D" }] } },
      5,
    );
    expect(out).toEqual([{ title: "T", url: "https://a.test/", snippet: "D" }]);
  });

  it("reads Tavily results", () => {
    const out = SEARCH_PROVIDERS.tavily.parse(
      { results: [{ title: "T", url: "https://a.test/", content: "C" }] },
      5,
    );
    expect(out[0].snippet).toBe("C");
  });

  it("reads Exa results, including nested text", () => {
    const out = SEARCH_PROVIDERS.exa.parse(
      { results: [{ title: "T", url: "https://a.test/", text: { text: "body" } }] },
      5,
    );
    expect(out[0].snippet).toBe("body");
  });

  // A citation without a URL cannot be checked, which defeats citing it.
  it("drops results with no usable URL", () => {
    const out = SEARCH_PROVIDERS.brave.parse(
      {
        web: {
          results: [
            { title: "no url", description: "d" },
            { title: "relative", url: "/x", description: "d" },
            { title: "ok", url: "https://a.test/", description: "d" },
          ],
        },
      },
      5,
    );
    expect(out).toHaveLength(1);
  });

  it.each(["duckduckgo", "brave", "tavily", "exa"] as const)(
    "%s returns [] for a malformed body rather than throwing",
    (id) => {
      for (const body of [null, undefined, 42, "oops", {}, { results: "nope" }]) {
        expect(SEARCH_PROVIDERS[id].parse(body, 5)).toEqual([]);
      }
    },
  );
});

describe("parseDuckDuckGoHtml", () => {
  const html = `
    <a class="result__a" href="/l/?uddg=https%3A%2F%2Freal.test%2Fpage">Real &amp; Title</a>
    <a class="result__snippet">A <b>snippet</b> here</a>
    <a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a>
    <a class="result__snippet">ad text</a>
    <a class="result__a" href="https://second.test/">Second</a>
    <a class="result__snippet">second snippet</a>`;

  it("unwraps DuckDuckGo's redirect and decodes entities", () => {
    const out = parseDuckDuckGoHtml(html, 5);
    expect(out[0].url).toBe("https://real.test/page");
    expect(out[0].title).toBe("Real & Title");
    expect(out[0].snippet).toBe("A snippet here");
  });

  it("skips DuckDuckGo's own tracking redirector", () => {
    expect(parseDuckDuckGoHtml(html, 5).some((s) => s.url.includes("y.js"))).toBe(false);
  });

  it("respects the limit", () => {
    expect(parseDuckDuckGoHtml(html, 1)).toHaveLength(1);
  });

  it("returns [] when the markup changes rather than throwing", () => {
    expect(parseDuckDuckGoHtml("<html><body>nothing</body></html>", 5)).toEqual([]);
  });
});

describe("decodeHtml", () => {
  it("strips tags and collapses whitespace", () => {
    expect(decodeHtml("<b>bold</b>   text\n\nhere")).toBe("bold text here");
  });

  it("decodes the entities these endpoints emit", () => {
    expect(decodeHtml("a &amp; b &quot;c&quot; &#39;d&#39; &lt;e&gt;")).toBe(`a & b "c" 'd' <e>`);
  });
});

describe("canonicalUrl / dedupeSources", () => {
  it("ignores fragment, trailing slash, www and case in the host", () => {
    expect(canonicalUrl("https://WWW.Example.com/a/#frag")).toBe(canonicalUrl("https://example.com/a"));
  });

  it("strips tracking parameters that make one page look like five", () => {
    expect(canonicalUrl("https://a.test/p?utm_source=x&id=7")).toBe("https://a.test/p?id=7");
  });

  it("keeps meaningful query parameters", () => {
    expect(canonicalUrl("https://a.test/p?id=7")).toContain("id=7");
  });

  // Otherwise the model reads one source as several corroborating ones.
  it("de-duplicates the same page reached different ways", () => {
    const out = dedupeSources([
      { title: "A", url: "https://example.com/x", snippet: "" },
      { title: "A again", url: "https://www.example.com/x/?utm_source=news#top", snippet: "" },
      { title: "B", url: "https://example.com/y", snippet: "" },
    ]);
    expect(out).toHaveLength(2);
  });

  it("keeps the first occurrence", () => {
    const out = dedupeSources([
      { title: "first", url: "https://example.com/x", snippet: "" },
      { title: "second", url: "https://example.com/x", snippet: "" },
    ]);
    expect(out[0].title).toBe("first");
  });

  it("drops entries with no usable URL", () => {
    expect(dedupeSources([{ title: "t", url: "", snippet: "" }])).toEqual([]);
  });

  it("leaves an unparseable URL alone rather than throwing", () => {
    expect(canonicalUrl("not a url")).toBe("not a url");
  });
});
