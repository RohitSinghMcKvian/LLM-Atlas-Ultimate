import { describe, expect, it } from "vitest";
import {
  BARREN_YIELD_RATE,
  extractHeadImages,
  MAX_IMAGE_ATTEMPTS,
  MIN_YIELD_SAMPLE,
  pickHeadImage,
  yieldRank,
} from "./og";

// The OpenGraph pass is the difference between a feed of photographs and a feed
// of gradients, and every input it sees is a stranger's HTML. These tests are
// against the shapes publishers actually emit — attribute order reversed, single
// quotes, protocol-relative URLs, JSON-LD in three different spellings — because
// the failure mode of a head parser is silence, not an exception.

const BASE = "https://example.com/posts/a-model-ships";

function head(inner: string): string {
  return `<!doctype html><html><head>${inner}</head><body><img src="https://example.com/body-image.jpg"></body></html>`;
}

describe("extractHeadImages", () => {
  it("reads og:image with its declared dimensions and alt", () => {
    const images = extractHeadImages(
      head(`
        <meta property="og:image" content="https://cdn.example.com/hero.jpg">
        <meta property="og:image:width" content="1200">
        <meta property="og:image:height" content="630">
        <meta property="og:image:alt" content="A datacentre">
      `),
      BASE,
    );

    expect(images[0]).toEqual({
      url: "https://cdn.example.com/hero.jpg",
      width: 1200,
      height: 630,
      alt: "A datacentre",
    });
  });

  it("accepts reversed attribute order and single quotes", () => {
    const images = extractHeadImages(
      head(`<meta content='https://cdn.example.com/hero.jpg' property='og:image'>`),
      BASE,
    );
    expect(images[0]?.url).toBe("https://cdn.example.com/hero.jpg");
  });

  it("accepts name= as well as property=", () => {
    // The specification says `property`; a large minority of CMSes emit `name`.
    const images = extractHeadImages(
      head(`<meta name="og:image" content="https://cdn.example.com/hero.jpg">`),
      BASE,
    );
    expect(images[0]?.url).toBe("https://cdn.example.com/hero.jpg");
  });

  it("resolves root-relative and protocol-relative URLs against the article", () => {
    const images = extractHeadImages(
      head(`
        <meta property="og:image" content="/img/hero.jpg">
        <meta property="twitter:image" content="//cdn.example.org/t.jpg">
      `),
      BASE,
    );

    expect(images.map((i) => i.url)).toEqual([
      "https://example.com/img/hero.jpg",
      "https://cdn.example.org/t.jpg",
    ]);
  });

  it("decodes entities in the content attribute", () => {
    const images = extractHeadImages(
      head(`<meta property="og:image" content="https://cdn.example.com/a.jpg?w=1&amp;h=2">`),
      BASE,
    );
    expect(images[0]?.url).toBe("https://cdn.example.com/a.jpg?w=1&h=2");
  });

  it("orders og before twitter before link[rel=image_src]", () => {
    const images = extractHeadImages(
      head(`
        <link rel="image_src" href="https://cdn.example.com/legacy.jpg">
        <meta property="twitter:image" content="https://cdn.example.com/twitter.jpg">
        <meta property="og:image" content="https://cdn.example.com/og.jpg">
      `),
      BASE,
    );

    // Document order is deliberately NOT preserved across kinds — precedence is
    // by how deliberate the declaration is.
    expect(images.map((i) => i.url)).toEqual([
      "https://cdn.example.com/og.jpg",
      "https://cdn.example.com/twitter.jpg",
      "https://cdn.example.com/legacy.jpg",
    ]);
  });

  it("never reaches into the body", () => {
    const images = extractHeadImages(head(""), BASE);
    expect(images).toEqual([]);
  });

  it("applies og:image:width to the preceding image, not a later one", () => {
    const images = extractHeadImages(
      head(`
        <meta property="og:image" content="https://cdn.example.com/one.jpg">
        <meta property="og:image:width" content="800">
        <meta property="og:image" content="https://cdn.example.com/two.jpg">
      `),
      BASE,
    );

    expect(images[0]).toMatchObject({ url: "https://cdn.example.com/one.jpg", width: 800 });
    expect(images[1]).toMatchObject({ url: "https://cdn.example.com/two.jpg" });
    expect(images[1].width).toBeUndefined();
  });

  describe("JSON-LD", () => {
    it("reads a bare string image", () => {
      const images = extractHeadImages(
        head(
          `<script type="application/ld+json">{"@type":"NewsArticle","image":"https://cdn.example.com/ld.jpg"}</script>`,
        ),
        BASE,
      );
      expect(images[0]?.url).toBe("https://cdn.example.com/ld.jpg");
    });

    it("reads an ImageObject with dimensions", () => {
      const images = extractHeadImages(
        head(
          `<script type="application/ld+json">{"image":{"@type":"ImageObject","url":"https://cdn.example.com/ld.jpg","width":1200,"height":675}}</script>`,
        ),
        BASE,
      );
      expect(images[0]).toMatchObject({ width: 1200, height: 675 });
    });

    it("reads an array and descends into @graph", () => {
      const images = extractHeadImages(
        head(
          `<script type="application/ld+json">{"@graph":[{"@type":"WebPage","image":["https://cdn.example.com/a.jpg","https://cdn.example.com/b.jpg"]}]}</script>`,
        ),
        BASE,
      );
      expect(images.map((i) => i.url)).toEqual([
        "https://cdn.example.com/a.jpg",
        "https://cdn.example.com/b.jpg",
      ]);
    });

    it("survives malformed JSON without throwing", () => {
      // Extremely common in the wild, and never worth failing a sync over.
      expect(() =>
        extractHeadImages(
          head(`<script type="application/ld+json">{ not json at all </script>`),
          BASE,
        ),
      ).not.toThrow();
    });
  });
});

describe("pickHeadImage", () => {
  it("takes the first candidate that survives the quality gate", () => {
    const picked = pickHeadImage([
      { url: "https://cdn.example.com/logo.png" },
      { url: "https://cdn.example.com/hero.jpg" },
    ]);
    expect(picked?.url).toBe("https://cdn.example.com/hero.jpg");
  });

  it("rejects a declared thumbnail in favour of a full-size later candidate", () => {
    const picked = pickHeadImage([
      { url: "https://cdn.example.com/a.jpg", width: 64, height: 64 },
      { url: "https://cdn.example.com/b.jpg", width: 1200, height: 630 },
    ]);
    expect(picked?.url).toBe("https://cdn.example.com/b.jpg");
  });

  it("returns undefined when every candidate is furniture", () => {
    expect(
      pickHeadImage([
        { url: "https://cdn.example.com/site-logo.svg" },
        { url: "https://feeds.feedburner.com/~ff/pixel.gif" },
      ]),
    ).toBeUndefined();
  });

  it("returns undefined for an empty candidate list", () => {
    expect(pickHeadImage([])).toBeUndefined();
  });
});

// --- Candidate selection ------------------------------------------------------
//
// Which articles a bounded pass chooses is the difference between coverage that
// climbs and coverage that plateaus. These pin the selection rules without
// touching the network — `discoverImages` is not exercised here, only the
// contract its ordering and skip rules are built on.

describe("MAX_IMAGE_ATTEMPTS", () => {
  it("gives an article two chances, not one and not forever", () => {
    // One is too few — a first failure is as often a timeout or a WAF as it is a
    // page with no og:image. Three is too many: the pages that fail twice will
    // keep failing, and the budget is better spent on untried candidates.
    expect(MAX_IMAGE_ATTEMPTS).toBe(2);
  });
});

// --- Per-source hit rate -----------------------------------------------------
//
// The ordering bug these pin down is invisible in any single sweep and invisible
// in every unit test that looks at one article: no individual article is ever
// asked twice, so a per-article memory cannot see that a whole *source* never
// pays out. Measured against a live corpus, arXiv's 120 daily preprints — whose
// `og:image` is the arXiv logo, correctly rejected — consumed the entire image
// budget every day, and TechCrunch, whose every article carries a good
// `og:image`, sat at 0 of 8.

describe("yieldRank", () => {
  it("treats an unmeasured source as neither proven nor barren", () => {
    // A newly added feed must not be demoted on the strength of a few unlucky
    // timeouts, or it could never accumulate the sample that proves it out.
    expect(yieldRank(undefined)).toBe(1);
    expect(yieldRank({ tried: MIN_YIELD_SAMPLE - 1, resolved: 0 })).toBe(1);
  });

  it("ranks a source that pays out ahead of one that never has", () => {
    const techcrunch = { tried: 40, resolved: 38 };
    const arxiv = { tried: 240, resolved: 0 };

    expect(yieldRank(techcrunch)).toBe(0);
    expect(yieldRank(arxiv)).toBe(2);
    expect(yieldRank(techcrunch)).toBeLessThan(yieldRank(arxiv));
  });

  it("puts a proven-barren source behind even an unmeasured one", () => {
    // The whole point: an untried candidate from an unknown source is a better
    // bet than a fresh one from a source with 240 recorded failures, even though
    // both articles are equally untried.
    expect(yieldRank(undefined)).toBeLessThan(yieldRank({ tried: 240, resolved: 0 }));
  });

  it("does not count a negligible hit rate as productive", () => {
    // One in fifty is not meaningfully better than none, and treating it as
    // productive lets a source keep a share of the budget it cannot earn back.
    expect(yieldRank({ tried: 100, resolved: 1 })).toBe(2);
    expect(yieldRank({ tried: 100, resolved: 20 })).toBe(0);
  });

  it("needs a real sample before it will demote anything", () => {
    expect(MIN_YIELD_SAMPLE).toBeGreaterThanOrEqual(20);
    expect(BARREN_YIELD_RATE).toBeGreaterThan(0);
  });
});
