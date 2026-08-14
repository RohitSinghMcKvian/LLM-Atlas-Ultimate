import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_URL_LENGTH,
  normalizeImageUrl,
  readImages,
  type GeneratedImage,
} from "./images";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

describe("normalizeImageUrl", () => {
  it("accepts a base64 image data URL and reads its MIME type", () => {
    expect(normalizeImageUrl(PNG)).toEqual<GeneratedImage>({ url: PNG, mime: "image/png" });
    expect(normalizeImageUrl("data:image/JPEG;base64,AAAA")?.mime).toBe("image/jpeg");
    expect(normalizeImageUrl("data:image/webp;base64,AAAA")?.mime).toBe("image/webp");
  });

  it("accepts an https URL", () => {
    expect(normalizeImageUrl("https://cdn.example/i.png")).toEqual({
      url: "https://cdn.example/i.png",
      mime: "",
    });
  });

  it("refuses every scheme that is not an image or https", () => {
    // The security boundary: this string goes straight into an <img src> and
    // into IndexedDB.
    expect(normalizeImageUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeImageUrl("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
    expect(normalizeImageUrl("data:image/png,<svg onload=alert(1)>")).toBeNull();
    expect(normalizeImageUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeImageUrl("blob:https://x/y")).toBeNull();
    // Plaintext http would downgrade the page.
    expect(normalizeImageUrl("http://cdn.example/i.png")).toBeNull();
  });

  it("refuses non-strings and empties", () => {
    expect(normalizeImageUrl(null)).toBeNull();
    expect(normalizeImageUrl(42)).toBeNull();
    expect(normalizeImageUrl("   ")).toBeNull();
  });

  it("refuses an oversized payload", () => {
    expect(normalizeImageUrl(`data:image/png;base64,${"A".repeat(MAX_IMAGE_URL_LENGTH)}`)).toBeNull();
  });
});

describe("readImages", () => {
  it("reads the images[] sibling of content", () => {
    const d = { images: [{ type: "image_url", image_url: { url: PNG } }] };
    expect(readImages(d)).toEqual([{ url: PNG, mime: "image/png" }]);
  });

  it("reads flat and string entries", () => {
    expect(readImages({ images: [PNG] })).toHaveLength(1);
    expect(readImages({ images: [{ url: PNG }] })).toHaveLength(1);
    expect(readImages({ images: [{ image_url: PNG }] })).toHaveLength(1);
  });

  it("reads a raw base64 payload with a declared type", () => {
    const got = readImages({ images: [{ b64_json: "AAAA", mime_type: "image/webp" }] });
    expect(got[0].url).toBe("data:image/webp;base64,AAAA");
    expect(got[0].mime).toBe("image/webp");
  });

  it("defaults a typeless base64 payload to png", () => {
    expect(readImages({ images: [{ b64_json: "AAAA" }] })[0].mime).toBe("image/png");
  });

  it("reads image parts out of an array content field", () => {
    const d = {
      content: [
        { type: "text", text: "here" },
        { type: "image_url", image_url: { url: PNG } },
      ],
    };
    expect(readImages(d)).toEqual([{ url: PNG, mime: "image/png" }]);
  });

  it("ignores a plain string content field", () => {
    expect(readImages({ content: "just text" })).toEqual([]);
  });

  it("de-duplicates within one delta", () => {
    // Some providers repeat the finished image across content and images.
    const d = { images: [PNG], content: [{ type: "image_url", image_url: { url: PNG } }] };
    expect(readImages(d)).toHaveLength(1);
  });

  it("drops entries it cannot validate rather than guessing", () => {
    const d = { images: [{ image_url: { url: "javascript:x" } }, null, 7, {}, PNG] };
    expect(readImages(d)).toHaveLength(1);
  });

  it("returns nothing for a text-only delta", () => {
    expect(readImages({ content: "hi", role: "assistant" })).toEqual([]);
    expect(readImages(null)).toEqual([]);
    expect(readImages("nope")).toEqual([]);
  });
});
