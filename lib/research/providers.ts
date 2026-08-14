import type { WebSource } from "@/lib/chat/types";

/**
 * Search backends behind one interface (spec §4.6, Research).
 *
 * Atlas had exactly one: a keyless scrape of DuckDuckGo's HTML endpoint. That is
 * a fine default — no account, no key, nothing to leak — but it is fragile
 * (markup changes break it), rate-limited, and returns snippets rather than
 * content. Research that fans out over several queries needs something sturdier,
 * and the sturdy options all want an API key.
 *
 * So: the keyless scrape stays the default and the only zero-configuration path,
 * and a user who has a key for a real search API can supply it. Same BYOK rule as
 * everywhere else (§1.3) — the key is held in the browser and forwarded once per
 * request by the route, never stored on a server.
 *
 * This module is pure: it says how to build a request and how to read a response
 * for each backend. The fetching lives in the route, so provider quirks are
 * testable without a network.
 */

export type SearchProviderId = "duckduckgo" | "brave" | "tavily" | "exa";

export interface SearchProvider {
  id: SearchProviderId;
  label: string;
  /** False for the keyless default; true for everything that needs BYOK. */
  needsKey: boolean;
  /** Where to get a key, shown in settings. Empty for the keyless provider. */
  keyUrl: string;
  /** Build the outbound request. */
  request: (query: string, count: number, key?: string) => SearchRequest;
  /** Read the provider's response body into the shared shape. */
  parse: (body: unknown, count: number) => WebSource[];
}

export interface SearchRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  /** True when the response is HTML to be scraped rather than JSON. */
  html?: boolean;
}

/** Max results any provider will return in one call. */
export const MAX_RESULTS = 10;

function clampCount(count: number): number {
  return Math.min(MAX_RESULTS, Math.max(1, Math.floor(count) || 5));
}

/** Strip tags and decode the entity set these endpoints actually emit. */
export function decodeHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** DuckDuckGo wraps outbound links; unwrap `/l/?uddg=<encoded>` to the real URL. */
export function unwrapDuckDuckGoUrl(href: string): string {
  try {
    const u = href.startsWith("http") ? new URL(href) : new URL(href, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : u.toString();
  } catch {
    return href;
  }
}

/** Scrape DuckDuckGo's HTML result list. Exported so the parser is testable. */
export function parseDuckDuckGoHtml(html: string, count: number): WebSource[] {
  const limit = clampCount(count);
  const out: WebSource[] = [];
  const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snipRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  const links: { url: string; title: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) && links.length < limit * 2) {
    links.push({ url: unwrapDuckDuckGoUrl(m[1]), title: decodeHtml(m[2]) });
  }
  const snips: string[] = [];
  while ((m = snipRe.exec(html)) && snips.length < limit * 2) {
    snips.push(decodeHtml(m[1]));
  }
  for (let i = 0; i < links.length && out.length < limit; i++) {
    const { url, title } = links[i];
    // DDG's own tracking redirector shows up among the results.
    if (!title || !url || url.includes("duckduckgo.com/y.js")) continue;
    out.push({ title, url, snippet: snips[i] ?? "" });
  }
  return out;
}

/** Narrow an unknown JSON value to an array of records. */
function rows(value: unknown, ...path: string[]): Record<string, unknown>[] {
  let cur: unknown = value;
  for (const key of path) {
    if (typeof cur !== "object" || cur === null) return [];
    cur = (cur as Record<string, unknown>)[key];
  }
  return Array.isArray(cur) ? (cur.filter((r) => typeof r === "object" && r !== null) as Record<string, unknown>[]) : [];
}

function str(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * A result is only usable if it has a URL — a citation without one cannot be
 * checked, which defeats the point of citing it.
 */
function usable(s: WebSource): boolean {
  return !!s.url && /^https?:\/\//i.test(s.url);
}

export const SEARCH_PROVIDERS: Record<SearchProviderId, SearchProvider> = {
  duckduckgo: {
    id: "duckduckgo",
    label: "DuckDuckGo (no key)",
    needsKey: false,
    keyUrl: "",
    request: (query) => ({
      url: "https://html.duckduckgo.com/html/",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // Without a browser-ish UA the HTML endpoint returns a stub page.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
      },
      body: new URLSearchParams({ q: query }).toString(),
      html: true,
    }),
    parse: (body, count) =>
      typeof body === "string" ? parseDuckDuckGoHtml(body, count) : [],
  },

  brave: {
    id: "brave",
    label: "Brave Search",
    needsKey: true,
    keyUrl: "https://brave.com/search/api/",
    request: (query, count, key) => ({
      url: `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${clampCount(count)}`,
      method: "GET",
      headers: { Accept: "application/json", "X-Subscription-Token": key ?? "" },
    }),
    parse: (body, count) =>
      rows(body, "web", "results")
        .map((r) => ({
          title: decodeHtml(str(r, "title")),
          url: str(r, "url"),
          snippet: decodeHtml(str(r, "description")),
        }))
        .filter(usable)
        .slice(0, clampCount(count)),
  },

  tavily: {
    id: "tavily",
    label: "Tavily",
    needsKey: true,
    keyUrl: "https://tavily.com/",
    request: (query, count, key) => ({
      url: "https://api.tavily.com/search",
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key ?? ""}` },
      body: JSON.stringify({
        query,
        max_results: clampCount(count),
        // Tavily can return page content, which is far more useful to cite from
        // than a snippet — the whole reason to pay for a search API.
        include_raw_content: false,
        search_depth: "basic",
      }),
    }),
    parse: (body, count) =>
      rows(body, "results")
        .map((r) => ({
          title: str(r, "title"),
          url: str(r, "url"),
          snippet: str(r, "content", "snippet"),
        }))
        .filter(usable)
        .slice(0, clampCount(count)),
  },

  exa: {
    id: "exa",
    label: "Exa",
    needsKey: true,
    keyUrl: "https://exa.ai/",
    request: (query, count, key) => ({
      url: "https://api.exa.ai/search",
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key ?? "" },
      body: JSON.stringify({
        query,
        numResults: clampCount(count),
        contents: { text: { maxCharacters: 1000 } },
      }),
    }),
    parse: (body, count) =>
      rows(body, "results")
        .map((r) => ({
          title: str(r, "title"),
          url: str(r, "url"),
          snippet:
            str(r, "text", "snippet") ||
            (typeof r.text === "object" && r.text !== null
              ? str(r.text as Record<string, unknown>, "text")
              : ""),
        }))
        .filter(usable)
        .slice(0, clampCount(count)),
  },
};

export const DEFAULT_PROVIDER: SearchProviderId = "duckduckgo";

export function providerById(id: string | undefined): SearchProvider {
  return SEARCH_PROVIDERS[id as SearchProviderId] ?? SEARCH_PROVIDERS[DEFAULT_PROVIDER];
}

/** Providers listed for the settings UI, keyless first. */
export function listProviders(): SearchProvider[] {
  return Object.values(SEARCH_PROVIDERS).sort(
    (a, b) => Number(a.needsKey) - Number(b.needsKey) || a.label.localeCompare(b.label),
  );
}

/**
 * De-duplicate across providers and queries.
 *
 * Fanning out several sub-questions returns the same authoritative page again and
 * again; without this the citation list is mostly repeats and the model reads one
 * source as several corroborating ones, which is worse than merely untidy.
 * Normalisation drops the fragment, the trailing slash, and the tracking
 * parameters that make one page look like five.
 */
const TRACKING_PARAMS = /^(utm_|fbclid|gclid|mc_|ref$|ref_src$|s_cid$)/i;

export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.hostname = u.hostname.replace(/^www\./i, "").toLowerCase();
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch {
    return raw.trim();
  }
}

export function dedupeSources(sources: WebSource[]): WebSource[] {
  const seen = new Set<string>();
  const out: WebSource[] = [];
  for (const s of sources) {
    if (!usable(s)) continue;
    const key = canonicalUrl(s.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}
