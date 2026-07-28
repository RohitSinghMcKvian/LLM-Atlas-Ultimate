import { fnv1a } from "@/lib/catalog/sync/normalize";

// URL canonicalisation and identity.
//
// Everything downstream depends on getting this right:
//
//   • The article id is derived from the URL, which is what lets a user's saved
//     and read state survive the corpus being rebuilt from scratch every hour.
//     An id that shifts when a publisher appends a tracking parameter would
//     silently lose that state.
//   • `publisher_domain_match` — and therefore the entire verification model —
//     compares the registrable domain of this URL against the feed's declared
//     domains. A sloppy host parse hands out or withholds "verified" wrongly.
//   • The image proxy's allowlist is built from these hosts.
//
// `fnv1a` is reused from the catalog sync rather than reimplemented: same hash,
// same properties, one place to change it.

/**
 * Multi-part public suffixes.
 *
 * A real Public Suffix List is ~10 000 entries and needs updating; this covers
 * the country-code patterns that actually appear in technology publishing plus
 * the blog platforms whose subdomains are separate publishers.
 *
 * Being incomplete is safe in one direction only, so the fallback is chosen
 * deliberately: an unknown multi-part suffix makes two sibling sites look like
 * ONE domain, which *under*-counts corroboration. Guessing the other way would
 * let `evil.co.uk` and `victim.co.uk` corroborate each other, which would
 * manufacture confidence out of nothing.
 */
const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "net.uk", "sch.uk", "ltd.uk", "plc.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "id.au",
  "co.jp", "or.jp", "ne.jp", "ac.jp", "go.jp", "lg.jp",
  "co.nz", "org.nz", "net.nz", "ac.nz", "govt.nz", "school.nz",
  "com.br", "net.br", "org.br", "gov.br", "edu.br",
  "co.in", "net.in", "org.in", "gov.in", "ac.in", "edu.in",
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "ac.cn",
  "co.za", "org.za", "net.za", "ac.za", "gov.za",
  "co.kr", "or.kr", "ne.kr", "go.kr", "re.kr",
  "co.il", "org.il", "ac.il", "gov.il", "net.il",
  "com.mx", "com.tr", "com.sg", "com.hk", "com.tw", "com.ar", "com.co",
  "com.es", "com.pl", "com.ua", "com.vn", "com.my", "com.ph", "com.pk",
]);

// Blog and hosting platforms (substack.com, github.io, medium.com, …) are
// deliberately NOT listed above, even though a strict Public Suffix List treats
// them as suffixes. Under PSL rules `importai.substack.com` would be its own
// registrable domain, so two unrelated Substack newsletters repeating a rumour
// would count as two independent publishers and reach `corroborated`.
//
// Falling through to the default rule collapses them all to `substack.com`, so
// they corroborate nothing. That under-counts genuine independence between two
// newsletters, which is the direction we want to be wrong in: this number is
// presented to readers as evidence.

/**
 * The registrable domain of a hostname (`www.bbc.co.uk` → `bbc.co.uk`).
 *
 * Returns the lowercased host unchanged when it has no dot, which covers
 * `localhost` and bare hostnames — both of which the image proxy rejects anyway.
 */
export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");

  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

/** True when `host` is, or is a subdomain of, any of `domains`. */
export function hostMatchesDomains(host: string, domains: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return domains.some((d) => {
    const domain = d.toLowerCase();
    return h === domain || h.endsWith(`.${domain}`);
  });
}

/**
 * Query parameters that carry no meaning for the destination.
 *
 * `ref` and `source` are borderline — a handful of sites use them for routing —
 * but on news article URLs they are overwhelmingly referral tags, and leaving
 * them in means the same story syndicated through two paths gets two ids.
 */
const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "gclsrc", "dclid", "msclkid", "twclid", "igshid", "mc_cid", "mc_eid",
  "ref", "ref_src", "referrer", "source", "src", "cmpid", "ncid", "ito", "at_medium",
  "at_campaign", "at_custom1", "at_custom2", "spm", "scid", "sh", "share", "smid",
  "_hsenc", "_hsmi", "hss_channel", "vero_id", "vero_conv", "wt.mc_id", "wtmc",
  "yclid", "rss", "feed", "amp", "output_type", "guccounter", "guce_referrer",
  "guce_referrer_sig", "trk", "trkCampaign", "sfnsn", "mibextid",
]);

function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return k.startsWith("utm_") || k.startsWith("at_") || TRACKING_PARAMS.has(k);
}

export interface CanonicalUrl {
  /** Absolute https(s) URL suitable for display and for the outbound link. */
  url: string;
  host: string;
  domain: string;
  /** Aggressively normalized identity key — see `urlKeyOf`. */
  key: string;
}

/**
 * Resolve and clean a feed link.
 *
 * Returns undefined rather than throwing for anything unusable, because a bad
 * link in one item must not cost the other thirty-nine.
 */
export function canonicalizeUrl(raw: string, base?: string): CanonicalUrl | undefined {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return undefined;

  // Reject dangerous schemes BEFORE `new URL` gets a chance to accept them.
  // A `javascript:` link that reached a card's href would be a stored XSS.
  if (/^\s*(javascript|data|vbscript|file|blob|about):/i.test(trimmed)) return undefined;

  let parsed: URL;
  try {
    parsed = base ? new URL(trimmed, base) : new URL(trimmed);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
  if (!parsed.hostname || !parsed.hostname.includes(".")) return undefined;
  // Credentials in a URL are never legitimate here and would be leaked to the
  // browser's address bar and to the image proxy.
  if (parsed.username || parsed.password) return undefined;

  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.hash = "";

  for (const key of [...parsed.searchParams.keys()]) {
    if (isTrackingParam(key)) parsed.searchParams.delete(key);
  }
  // `?` with nothing after it.
  if (!parsed.searchParams.toString()) parsed.search = "";

  const host = parsed.hostname;
  return {
    url: parsed.toString(),
    host,
    domain: registrableDomain(host),
    key: urlKeyOf(parsed),
  };
}

/**
 * The identity key behind an article id.
 *
 * More aggressive than the display URL on purpose. `www.` and a trailing slash
 * and `/amp` are dropped, the scheme is dropped, and remaining query parameters
 * are sorted — so the same story linked as `https://www.x.com/a/` by one feed
 * and `http://x.com/a?b=1&a=2` by another collapses to one id instead of
 * arriving twice and needing the clusterer to notice.
 *
 * The *display* URL keeps `www.` and its original scheme, because some hosts do
 * not serve the bare domain and the reader has to be able to follow the link.
 */
function urlKeyOf(parsed: URL): string {
  const host = parsed.hostname.replace(/^www\./, "");
  let path = parsed.pathname.replace(/\/+$/, "");
  path = path.replace(/\/amp$/i, "");
  if (!path) path = "/";

  const params = [...parsed.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.map(([k, v]) => `${k}=${v}`).join("&");

  return `${host}${path}${query ? `?${query}` : ""}`.toLowerCase();
}

/**
 * The stable article id.
 *
 * Derived from the URL key rather than the feed's own guid: guids are not
 * consistent across the publishers that syndicate the same story, and several
 * feeds regenerate them. A URL-derived id means read/saved state survives both
 * the hourly rebuild and a story being picked up by a second source.
 */
export function articleId(urlKey: string): string {
  return fnv1a(urlKey);
}

/** Stable id for a cluster, derived from its lead article. */
export function clusterId(leadId: string): string {
  return `c${fnv1a(leadId)}`;
}

export { fnv1a };
