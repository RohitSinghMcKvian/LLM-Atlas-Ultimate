import { describe, expect, it } from "vitest";
import {
  generativeArt,
  isAllowedImageUrl,
  isSafeImageUrl,
  isUsableImageResponse,
  isUsableStoryImage,
  newsImageSrc,
  NEWS_IMAGE_ENDPOINT,
} from "./image";

const allowlist = {
  urls: new Set(["https://cdn.example-lab.com/hero.jpg"]),
  hosts: ["cdn.example-lab.com", "images.press.test"],
};

describe("isSafeImageUrl", () => {
  it("accepts an ordinary https CDN URL", () => {
    expect(isSafeImageUrl("https://cdn.example-lab.com/a.jpg")).toBe(true);
    expect(isSafeImageUrl("https://cdn.example-lab.com:443/a.jpg")).toBe(true);
  });

  it("rejects non-https schemes", () => {
    for (const url of [
      "http://cdn.example-lab.com/a.jpg",
      "data:image/gif;base64,R0lGOD",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "ftp://cdn.example-lab.com/a.jpg",
    ]) {
      expect(isSafeImageUrl(url), url).toBe(false);
    }
  });

  it("rejects credentials in the URL", () => {
    // They would be forwarded upstream by the proxy.
    expect(isSafeImageUrl("https://user:pass@cdn.example-lab.com/a.jpg")).toBe(false);
  });

  it("rejects a non-default port", () => {
    // A strong signal of an internal service rather than a public CDN.
    expect(isSafeImageUrl("https://cdn.example-lab.com:8080/a.jpg")).toBe(false);
    expect(isSafeImageUrl("https://cdn.example-lab.com:22/a.jpg")).toBe(false);
  });

  it("rejects loopback and internal names", () => {
    for (const host of [
      "localhost",
      "printer.local",
      "vault.internal",
      "metadata.google.internal",
      "router.home.arpa",
    ]) {
      expect(isSafeImageUrl(`https://${host}/a.jpg`), host).toBe(false);
    }
  });

  it("rejects IP literals, including the cloud metadata address", () => {
    for (const host of [
      "169.254.169.254", // AWS/GCP/Azure instance metadata
      "127.0.0.1",
      "10.0.0.5",
      "172.16.4.1",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "8.8.8.8", // public, but still a bare literal — no publisher serves images this way
      "[::1]",
      "[fd00::1]",
    ]) {
      expect(isSafeImageUrl(`https://${host}/a.jpg`), host).toBe(false);
    }
  });

  it("rejects a decimal-encoded IP", () => {
    expect(isSafeImageUrl("https://2852039166/a.jpg")).toBe(false);
  });

  it("rejects hosts with no dot, empty input, and absurdly long input", () => {
    expect(isSafeImageUrl("https://intranet/a.jpg")).toBe(false);
    expect(isSafeImageUrl("")).toBe(false);
    expect(isSafeImageUrl(`https://cdn.example-lab.com/${"a".repeat(3000)}.jpg`)).toBe(false);
  });

  it("rejects unparseable input rather than throwing", () => {
    expect(isSafeImageUrl("https://[not a host]/a.jpg")).toBe(false);
    expect(isSafeImageUrl("not a url")).toBe(false);
  });
});

describe("isAllowedImageUrl", () => {
  it("accepts a URL the current corpus references", () => {
    expect(isAllowedImageUrl("https://cdn.example-lab.com/hero.jpg", allowlist)).toBe(true);
  });

  it("accepts another path on a host the corpus references", () => {
    // A snapshot can rotate between the HTML render and the image request; a
    // card that has already painted should not lose its image to that race.
    expect(isAllowedImageUrl("https://cdn.example-lab.com/other.jpg", allowlist)).toBe(true);
  });

  it("accepts a subdomain of an allowed host", () => {
    expect(isAllowedImageUrl("https://eu.cdn.example-lab.com/a.jpg", allowlist)).toBe(true);
  });

  it("rejects a host the corpus does not reference", () => {
    // The gate that actually matters: without it, the route is an open proxy.
    expect(isAllowedImageUrl("https://evil.test/a.jpg", allowlist)).toBe(false);
  });

  it("rejects a host that merely ends with an allowed name", () => {
    expect(isAllowedImageUrl("https://notcdn.example-lab.com.evil.test/a.jpg", allowlist)).toBe(
      false,
    );
    expect(isAllowedImageUrl("https://evilcdn.example-lab.com.attacker.test/a.jpg", allowlist)).toBe(
      false,
    );
  });

  it("still applies the structural gates to an allowed host", () => {
    expect(isAllowedImageUrl("http://cdn.example-lab.com/a.jpg", allowlist)).toBe(false);
    expect(isAllowedImageUrl("https://cdn.example-lab.com:9000/a.jpg", allowlist)).toBe(false);
  });

  it("rejects everything when the corpus references no images", () => {
    expect(isAllowedImageUrl("https://cdn.example-lab.com/a.jpg", { hosts: [] })).toBe(false);
  });
});

describe("newsImageSrc", () => {
  it("builds a same-origin URL with the target encoded", () => {
    const src = newsImageSrc("https://cdn.example-lab.com/a.jpg?w=1&h=2");
    expect(src.startsWith(`${NEWS_IMAGE_ENDPOINT}?u=`)).toBe(true);
    // The `&` must be encoded or it would truncate the target URL.
    expect(src).not.toContain("&h=2");
    expect(new URL(src, "https://atlas.test").searchParams.get("u")).toBe(
      "https://cdn.example-lab.com/a.jpg?w=1&h=2",
    );
  });
});

describe("generativeArt", () => {
  it("is deterministic for a seed", () => {
    expect(generativeArt("article-1")).toEqual(generativeArt("article-1"));
  });

  it("differs between seeds", () => {
    const a = generativeArt("article-1");
    const b = generativeArt("article-2");
    expect(a).not.toEqual(b);
  });

  it("produces values inside their documented ranges", () => {
    for (let i = 0; i < 200; i++) {
      const art = generativeArt(`seed-${i}`);
      expect(art.hue).toBeGreaterThanOrEqual(0);
      expect(art.hue).toBeLessThan(360);
      expect(art.hue2).toBeGreaterThanOrEqual(0);
      expect(art.hue2).toBeLessThan(360);
      expect(art.angle).toBeGreaterThanOrEqual(0);
      expect(art.angle).toBeLessThanOrEqual(360);
      expect(["rings", "grid", "waves", "shards"]).toContain(art.motif);

      expect(art.blobs.length).toBe(2);
      for (const blob of art.blobs) {
        expect(blob.x).toBeGreaterThan(0);
        expect(blob.x).toBeLessThan(1);
        expect(blob.y).toBeGreaterThan(0);
        expect(blob.y).toBeLessThan(1);
        expect(blob.r).toBeGreaterThan(0);
        expect(blob.r).toBeLessThan(1);
      }
    }
  });

  it("uses more than one motif across a realistic feed", () => {
    const motifs = new Set(
      Array.from({ length: 60 }, (_, i) => generativeArt(`article-${i}`).motif),
    );
    expect(motifs.size).toBeGreaterThan(1);
  });

  it("handles an empty seed without throwing", () => {
    expect(() => generativeArt("")).not.toThrow();
  });
});

// --- Quality gate -----------------------------------------------------------
//
// `isSafeImageUrl` asks whether a URL is safe to fetch. This asks the separate
// question of whether what comes back is a picture of the story or a piece of
// site furniture — the distinction between a feed of photographs and a feed that
// looks broken.

describe("isUsableStoryImage", () => {
  it("accepts an ordinary editorial image", () => {
    expect(isUsableStoryImage("https://cdn.press.test/2025/07/hero.jpg")).toBe(true);
  });

  it("accepts an image with no dimension information at all", () => {
    // The common case. Requiring dimensions would empty the feed, so they are
    // only ever used to reject, never required to accept.
    expect(isUsableStoryImage("https://cdn.press.test/photo.png", {})).toBe(true);
  });

  it("inherits every rejection from the safety gate", () => {
    expect(isUsableStoryImage("http://cdn.press.test/hero.jpg")).toBe(false);
    expect(isUsableStoryImage("https://127.0.0.1/hero.jpg")).toBe(false);
    expect(isUsableStoryImage("not a url")).toBe(false);
  });

  describe("furniture", () => {
    it.each([
      ["a tracking pixel", "https://cdn.press.test/img/pixel.gif"],
      ["a spacer", "https://cdn.press.test/assets/spacer.png"],
      ["a 1x1", "https://cdn.press.test/1x1.gif"],
      ["a publisher logo", "https://cdn.press.test/static/logo-dark.png"],
      ["a favicon", "https://cdn.press.test/favicon.png"],
      ["an avatar", "https://cdn.press.test/users/avatar.jpg"],
      ["a share icon", "https://cdn.press.test/share-twitter.png"],
      ["a sprite sheet", "https://cdn.press.test/sprite.png"],
      ["a placeholder", "https://cdn.press.test/placeholder.jpg"],
    ])("rejects %s", (_label, url) => {
      expect(isUsableStoryImage(url)).toBe(false);
    });

    it("matches furniture patterns in the path only, never the host", () => {
      // `images.logos-cdn.test` is a perfectly good CDN; rejecting on the host
      // would throw away every image a whole publisher serves.
      expect(isUsableStoryImage("https://images.logos-cdn.test/2025/hero.jpg")).toBe(true);
    });
  });

  it("rejects analytics beacon hosts", () => {
    expect(isUsableStoryImage("https://pixel.wp.com/g.gif?blog=1")).toBe(false);
    expect(isUsableStoryImage("https://feeds.feedburner.com/~ff/aifeed?a=b")).toBe(false);
  });

  it("rejects SVG and ICO, which are icons rather than photographs", () => {
    expect(isUsableStoryImage("https://cdn.press.test/art.svg")).toBe(false);
    expect(isUsableStoryImage("https://cdn.press.test/art.ico")).toBe(false);
  });

  it("rejects anything declared smaller than an icon on either axis", () => {
    expect(isUsableStoryImage("https://cdn.press.test/a.jpg", { width: 64, height: 800 })).toBe(false);
    expect(isUsableStoryImage("https://cdn.press.test/a.jpg", { width: 800, height: 64 })).toBe(false);
    expect(isUsableStoryImage("https://cdn.press.test/a.jpg", { width: 800, height: 600 })).toBe(true);
  });

  it("reads CDN dimension hints out of the query string", () => {
    // The same path is often served full-size elsewhere; this is the thumbnail
    // variant, and upscaling it into a card is what makes a hero look blurry.
    expect(isUsableStoryImage("https://cdn.press.test/hero.jpg?w=48&h=48")).toBe(false);
    expect(isUsableStoryImage("https://cdn.press.test/hero.jpg?w=1200&h=630")).toBe(true);
  });

  it("prefers the declared attributes over the query hints", () => {
    expect(
      isUsableStoryImage("https://cdn.press.test/hero.jpg?w=48", { width: 1200, height: 630 }),
    ).toBe(true);
  });

  it("rejects mastheads and sidebar rails by aspect ratio", () => {
    expect(isUsableStoryImage("https://cdn.press.test/a.jpg", { width: 1000, height: 200 })).toBe(false);
    expect(isUsableStoryImage("https://cdn.press.test/a.jpg", { width: 200, height: 1000 })).toBe(false);
    // 16:9 and 1:1 both survive.
    expect(isUsableStoryImage("https://cdn.press.test/a.jpg", { width: 1600, height: 900 })).toBe(true);
    expect(isUsableStoryImage("https://cdn.press.test/a.jpg", { width: 600, height: 600 })).toBe(true);
  });
});

describe("isUsableImageResponse", () => {
  it("accepts a normal image response", () => {
    expect(isUsableImageResponse("image/jpeg", "148213")).toBe(true);
  });

  it("rejects a soft 404 that answers with HTML", () => {
    // The failure this exists for: a URL ending .jpg that returns an error page
    // with status 200. Nothing earlier in the pipeline can see this.
    expect(isUsableImageResponse("text/html; charset=utf-8", "5120")).toBe(false);
  });

  it("rejects SVG and icon content types", () => {
    expect(isUsableImageResponse("image/svg+xml", "9000")).toBe(false);
    expect(isUsableImageResponse("image/vnd.microsoft.icon", "9000")).toBe(false);
  });

  it("rejects a body too small to be a photograph", () => {
    expect(isUsableImageResponse("image/gif", "43")).toBe(false);
  });

  it("accepts when the length is absent or unparseable", () => {
    // Omitted on any streamed response; absence is not evidence of a pixel.
    expect(isUsableImageResponse("image/webp", null)).toBe(true);
    expect(isUsableImageResponse("image/webp", "chunked")).toBe(true);
  });

  it("rejects a missing content type", () => {
    expect(isUsableImageResponse(null, "148213")).toBe(false);
  });
});
