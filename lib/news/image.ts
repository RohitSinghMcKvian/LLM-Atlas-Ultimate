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
