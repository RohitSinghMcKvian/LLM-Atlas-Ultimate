import { fnv1a } from "@/lib/catalog/sync/normalize";

// The image allowlist and the generated fallback art.
//
// Pure functions, no I/O — the proxy route applies them, the client renders the
// fallback, and the tests exercise both without a server.

/** Where every news image is rendered from. Same-origin, so no CSP or `remotePatterns` changes. */
export const NEWS_IMAGE_ENDPOINT = "/api/v1/news/image";

export function newsImageSrc(url: string): string {
  return `${NEWS_IMAGE_ENDPOINT}?u=${encodeURIComponent(url)}`;
}

/**
 * Hostnames that must never be fetched server-side.
 *
 * The proxy takes a URL from a query parameter and fetches it with the server's
 * own network position, which is the textbook SSRF shape. The snapshot allowlist
 * in `isAllowedImageUrl` is the real gate; this is the second layer, because a
 * single mistake in the first should not be enough to reach a metadata endpoint.
 */
const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "instance-data",
]);

const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost", ".home.arpa"];

/** An IPv4 literal in any of the forms a URL parser will accept. */
function isIpv4Literal(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^\d+$/.test(host);
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  return false;
}

/**
 * Structural checks that do not depend on the snapshot.
 *
 * Exported so the route can apply the cheap rejections before touching the
 * corpus, and so they can be tested independently of a snapshot fixture.
 */
export function isSafeImageUrl(raw: string): boolean {
  if (!raw || raw.length > 2_000) return false;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  // https only. An http image would be a mixed-content warning on the page and
  // an unauthenticated fetch from the server.
  if (url.protocol !== "https:") return false;
  // Credentials in the URL would be forwarded upstream by the proxy.
  if (url.username || url.password) return false;
  // A non-default port is a strong signal of an internal service.
  if (url.port && url.port !== "443") return false;

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || !host.includes(".")) return false;
  if (BLOCKED_HOSTS.has(host)) return false;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  // An IPv6 literal arrives bracketed.
  if (host.startsWith("[")) return false;
  if (isIpv4Literal(host)) return false;
  if (isPrivateIpv4(host)) return false;

  return true;
}

export interface ImageAllowlist {
  /** Exact upstream URLs referenced by the current corpus. */
  urls?: ReadonlySet<string>;
  /** Hosts those images live on. */
  hosts: readonly string[];
}

/**
 * The full gate.
 *
 * Pinned to the snapshot, which is the property that matters: both the URL set
 * and the host list are written by the sync from images that already passed
 * their feed's domain check, so no attacker-supplied value can widen them. The
 * host fallback exists because a snapshot can rotate between the HTML render and
 * the browser's image request, and a card that has already painted should not
 * lose its image to a race.
 */
export function isAllowedImageUrl(raw: string, allowlist: ImageAllowlist): boolean {
  if (!isSafeImageUrl(raw)) return false;
  if (allowlist.urls?.has(raw)) return true;

  const host = new URL(raw).hostname.toLowerCase();
  return allowlist.hosts.some((allowed) => {
    const h = allowed.toLowerCase();
    return host === h || host.endsWith(`.${h}`);
  });
}

// --- Generated fallback art -------------------------------------------------
//
// Roughly a third of feed items ship no usable image, and a grid with holes in
// it looks broken rather than sparse. Rather than a generic placeholder repeated
// forty times, each article gets its own deterministic figure derived from its
// id — so the same story always looks the same, and a scrolled feed reads as
// varied rather than as a rendering failure.

export interface GenerativeArt {
  /** Base hue in degrees. */
  hue: number;
  /** Second hue for the gradient, always a readable distance from the first. */
  hue2: number;
  /** Gradient angle in degrees. */
  angle: number;
  /** 0..1 positions for the two focal blobs. */
  blobs: { x: number; y: number; r: number }[];
  /** Which of the small set of overlay motifs to draw. */
  motif: "rings" | "grid" | "waves" | "shards";
  seed: string;
}

const MOTIFS: GenerativeArt["motif"][] = ["rings", "grid", "waves", "shards"];

/**
 * Deterministic art parameters for a seed.
 *
 * Hues are constrained to the product's own cyan→violet→amber arc rather than
 * the full wheel: a feed of forty randomly-hued cards looks like a bug, and
 * these sit next to real photography.
 */
export function generativeArt(seed: string): GenerativeArt {
  const base = seed || "atlas";
  // `fnv1a` is 32-bit, so one call yields only four bytes — enough for the hue
  // and not much else. Four salted rounds give sixteen independent bytes, which
  // is what the blob positions and the motif need. Reading past the end of a
  // single hash silently returned zero, which made every card pick motif 0.
  const hash = `${fnv1a(base)}${fnv1a(`${base}#1`)}${fnv1a(`${base}#2`)}${fnv1a(`${base}#3`)}`;

  // Independent values from separate bytes, so two adjacent ids do not produce
  // near-identical figures.
  const at = (index: number) => parseInt(hash.slice(index * 2, index * 2 + 2) || "0", 16) / 255;

  const arc = at(0);
  // 185°..300° covers cyan through violet; the amber accent appears as the
  // second hue on a minority of cards.
  const hue = 185 + arc * 115;
  const warm = at(1) > 0.78;
  const hue2 = warm ? 35 + at(2) * 15 : hue + 30 + at(2) * 40;

  return {
    hue: Math.round(hue),
    hue2: Math.round(hue2 % 360),
    angle: Math.round(at(3) * 360),
    blobs: [
      { x: 0.15 + at(4) * 0.3, y: 0.2 + at(5) * 0.3, r: 0.3 + at(6) * 0.25 },
      { x: 0.55 + at(7) * 0.3, y: 0.5 + at(8) * 0.35, r: 0.25 + at(9) * 0.3 },
    ],
    motif: MOTIFS[Math.floor(at(10) * MOTIFS.length) % MOTIFS.length],
    seed: hash,
  };
}

// --- Image quality gate -----------------------------------------------------
//
// WHY A SECOND GATE AT ALL
//
// `isSafeImageUrl` answers "is this safe to fetch". This answers a different and
// equally load-bearing question: "is this a picture of the story, or is it
// furniture". Feeds are full of the latter — FeedBurner tracking pixels, 1×1
// spacers, subscribe buttons, the publisher's own logo repeated on all forty
// items, share-icon sprites. Every one of them passes the safety check, renders
// without error, and makes the grid look broken.
//
// This is the difference between "we found an image" and "we found the image",
// and it runs before an image is ever written to a `NewsArticle`.

/**
 * Path fragments that mark an image as site furniture rather than editorial art.
 *
 * Matched against the lowercased pathname only — never the host, or
 * `images.logos-cdn.example` would reject a perfectly good CDN. `logo` earns its
 * place here despite occasionally rejecting a legitimate hero: a publisher logo
 * is the single most common `og:image` fallback, and forty cards showing the
 * same mark is precisely the failure this gate exists to prevent.
 */
const FURNITURE_PATTERNS = [
  "pixel",
  "spacer",
  "blank",
  "transparent",
  "placeholder",
  "default-",
  "-default",
  "avatar",
  "gravatar",
  "logo",
  "favicon",
  "feed-icon",
  "rss-icon",
  "sprite",
  "share-",
  "social-",
  "button",
  "badge",
  "banner-ad",
  "advert",
  "watermark",
  "1x1",
  "px.gif",
  "dot.gif",
  "clear.gif",
];

/** Hosts that serve analytics beacons dressed as images. */
const BEACON_HOSTS = [
  "pixel.wp.com",
  "stats.wordpress.com",
  "feeds.feedburner.com",
  "feedburner.com",
  "doubleclick.net",
  "googletagmanager.com",
  "google-analytics.com",
  "scorecardresearch.com",
  "quantserve.com",
  "b.scorecardresearch.com",
];

/**
 * Extensions that are never editorial photography.
 *
 * `.svg` is excluded deliberately even though it renders: in feed data it is
 * almost always a logo or an icon, and it is the one image format that can carry
 * script — so the proxy is better off never serving one at all.
 */
const REJECTED_EXTENSIONS = [".svg", ".ico", ".bmp", ".tif", ".tiff"];

/** Below this on either axis, an image is an icon rather than a hero. */
export const MIN_IMAGE_EDGE = 200;

/**
 * Widest and narrowest usable aspect ratios.
 *
 * A 1000×50 strip is a masthead and a 200×900 column is a sidebar rail; neither
 * survives being cropped into a 16:9 card without becoming abstract texture.
 */
const MAX_ASPECT = 3.5;
const MIN_ASPECT = 1 / 3.5;

export interface ImageDimensions {
  width?: number;
  height?: number;
}

/**
 * Dimension hints a CDN put in the query string.
 *
 * Publishers routinely serve `.../hero.jpg?w=64&h=64` for a thumbnail and the
 * same path at full size elsewhere, so the declared `width`/`height` attributes
 * are not the only evidence available. Reading these catches the thumbnail
 * variant that would otherwise upscale into a blurry card.
 */
function queryDimensions(url: URL): ImageDimensions {
  const read = (...keys: string[]): number | undefined => {
    for (const key of keys) {
      const value = Number(url.searchParams.get(key));
      if (Number.isFinite(value) && value > 0) return value;
    }
    return undefined;
  };
  return { width: read("w", "width", "mw"), height: read("h", "height", "mh") };
}

/**
 * Is this image worth showing as a story's hero?
 *
 * Conservative in one direction only: an image with no dimension information
 * anywhere passes, because most publishers declare nothing and rejecting them
 * would empty the feed. Dimensions are used to reject when they are present and
 * damning, never required to accept.
 */
export function isUsableStoryImage(raw: string, declared: ImageDimensions = {}): boolean {
  if (!isSafeImageUrl(raw)) return false;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  const host = url.hostname.toLowerCase();
  if (BEACON_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return false;

  const path = url.pathname.toLowerCase();
  if (REJECTED_EXTENSIONS.some((ext) => path.endsWith(ext))) return false;
  if (FURNITURE_PATTERNS.some((pattern) => path.includes(pattern))) return false;

  // Declared attributes win over query hints: a CDN can be asked for 64px of a
  // 2000px original, but an `<img width>` is what the publisher says it is.
  const hints = queryDimensions(url);
  const width = declared.width ?? hints.width;
  const height = declared.height ?? hints.height;

  if (width !== undefined && width < MIN_IMAGE_EDGE) return false;
  if (height !== undefined && height < MIN_IMAGE_EDGE) return false;

  if (width !== undefined && height !== undefined && height > 0) {
    const aspect = width / height;
    if (aspect > MAX_ASPECT || aspect < MIN_ASPECT) return false;
  }

  return true;
}

/**
 * Content-type and content-length verdict for a fetched image.
 *
 * Used by the OpenGraph pass, which sees the response headers the sync's other
 * stages never do. A URL that ends `.jpg` and answers `text/html` is a soft 404
 * — the single most common way a card ends up rendering a broken image, because
 * nothing before this point had any way to know.
 */
export function isUsableImageResponse(
  contentType: string | null,
  contentLength: string | null,
): boolean {
  const type = (contentType ?? "").toLowerCase();
  if (!type.startsWith("image/")) return false;
  // SVG and ICO are rejected by path above; catch the extensionless variants too.
  if (type.includes("svg") || type.includes("icon")) return false;

  const bytes = Number(contentLength);
  // A "photograph" under 3 KB is a pixel, a spacer, or a solid-colour rectangle.
  // Absent or unparseable is fine — many CDNs omit it on a streamed response.
  if (Number.isFinite(bytes) && bytes > 0 && bytes < 3_000) return false;

  return true;
}
