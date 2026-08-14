/**
 * Images coming *out* of a model.
 *
 * Until now `modalities` in the catalog only ever meant vision **input**: a
 * model that could look at a picture. Nothing in Atlas could receive one. This
 * module is the parser for the other direction.
 *
 * It is written defensively because the shape is not standardized. The OpenAI
 * chat-completions schema has no image field, so every provider that emits one
 * has invented a place to put it, and OpenRouter passes those through. The
 * shapes handled below are the ones observed in the wild — **that list is an
 * inference, not a documented contract**, so the parser accepts several and
 * refuses anything it does not recognize rather than guessing.
 *
 * Pure and DOM-free: this is where the validation lives, so the validation is
 * testable.
 */

export interface GeneratedImage {
  /** A `data:` URL, or an `https:` URL the provider hosts. */
  url: string;
  /** MIME type when the URL declares one, else "". */
  mime: string;
}

/**
 * Per-image cap. A base64 data URL is ~4/3 the size of the bytes it carries, so
 * this is roughly a 6 MB image — larger than any model returns, and small enough
 * that a malformed stream cannot exhaust memory or the IndexedDB quota.
 */
export const MAX_IMAGE_URL_LENGTH = 8 * 1024 * 1024;

/** Per-turn cap, so a looping provider cannot flood the transcript. */
export const MAX_IMAGES_PER_TURN = 8;

const DATA_IMAGE = /^data:image\/(png|jpe?g|webp|gif|avif|bmp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i;

/**
 * Accept a URL only if it is an image we are willing to render.
 *
 * The scheme allowlist is the security boundary. This string is written by a
 * remote service and goes straight into an `<img src>` and into IndexedDB, so
 * `javascript:`, `data:text/html`, `file:` and `blob:` are all refused — as is
 * plaintext `http:`, which would downgrade the page. `data:image/svg+xml` is
 * allowed because an `<img>` element does not execute script in an SVG document;
 * it must never be inlined into the DOM instead.
 */
export function normalizeImageUrl(raw: unknown, mimeHint?: unknown): GeneratedImage | null {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (!url || url.length > MAX_IMAGE_URL_LENGTH) return null;

  if (/^data:/i.test(url)) {
    if (!DATA_IMAGE.test(url)) return null;
    const mime = /^data:([^;,]+)/i.exec(url)?.[1] ?? "";
    return { url, mime: mime.toLowerCase() };
  }

  if (/^https:\/\//i.test(url)) {
    return { url, mime: typeof mimeHint === "string" ? mimeHint.toLowerCase() : "" };
  }

  return null;
}

/** Base64 payload plus a MIME type, the shape the image APIs use. */
function fromBase64(b64: unknown, mime: unknown): GeneratedImage | null {
  if (typeof b64 !== "string" || !b64) return null;
  const type = typeof mime === "string" && mime.startsWith("image/") ? mime : "image/png";
  return normalizeImageUrl(`data:${type};base64,${b64.trim()}`);
}

/** One image entry, in any of the shapes providers use for it. */
function readOne(entry: unknown): GeneratedImage | null {
  if (typeof entry === "string") return normalizeImageUrl(entry);
  if (typeof entry !== "object" || entry === null) return null;
  const e = entry as Record<string, unknown>;

  // { image_url: { url, mime_type? } } — the OpenRouter / OpenAI content-part shape.
  const imageUrl = e.image_url;
  if (typeof imageUrl === "string") {
    const hit = normalizeImageUrl(imageUrl, e.mime_type ?? e.media_type);
    if (hit) return hit;
  }
  if (typeof imageUrl === "object" && imageUrl !== null) {
    const iu = imageUrl as Record<string, unknown>;
    const hit = normalizeImageUrl(iu.url, iu.mime_type ?? iu.media_type ?? e.mime_type);
    if (hit) return hit;
  }

  // { url } / { image } — flat variants.
  const flat = normalizeImageUrl(e.url ?? e.image, e.mime_type ?? e.media_type);
  if (flat) return flat;

  // { b64_json } / { data } / { base64 } — raw payload plus a type.
  return fromBase64(
    e.b64_json ?? e.base64 ?? e.data,
    e.mime_type ?? e.media_type ?? e.mimeType,
  );
}

/**
 * Every image in one streaming delta (or one non-streamed message).
 *
 * Two places are searched, because providers use both:
 *  - `images: [...]`, a sibling of `content` — what OpenRouter's image models do.
 *  - `content: [...]`, when content is an array of typed parts rather than a
 *    string, with the image parts carrying an image type.
 *
 * Duplicates within one delta are dropped: a provider that repeats the same
 * image across `content` and `images` should not paint it twice.
 */
export function readImages(delta: unknown): GeneratedImage[] {
  if (typeof delta !== "object" || delta === null) return [];
  const d = delta as Record<string, unknown>;
  const out: GeneratedImage[] = [];
  const seen = new Set<string>();

  const push = (img: GeneratedImage | null) => {
    if (!img || seen.has(img.url)) return;
    seen.add(img.url);
    out.push(img);
  };

  if (Array.isArray(d.images)) for (const entry of d.images) push(readOne(entry));

  if (Array.isArray(d.content)) {
    for (const part of d.content) {
      if (typeof part !== "object" || part === null) continue;
      const type = (part as Record<string, unknown>).type;
      if (typeof type === "string" && !/image/i.test(type)) continue;
      push(readOne(part));
    }
  }

  return out;
}
