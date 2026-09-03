import { isUsableImageResponse, isUsableStoryImage } from "../image";
import type { NewsImage } from "../types";
import { ATLAS_UA, fetchText } from "./fetch";
import { decodeEntities } from "./xml";
import type { RawArticle } from "./types";

// Recovering a story's real picture from the article page.
//
// THE PROBLEM THIS SOLVES
//
// Roughly two thirds of feed items ship no image at all. RSS was never an image
// format: `media:content` is an extension, `<enclosure>` was designed for
// podcasts, and a great many publishers emit neither. The parser already tries
// all of them (see `itemImage` in `parse.ts`) and still comes back empty most of
// the time — so the feed fell back to generated art on the majority of cards,
// which reads as a rendering failure rather than as a design.
//
// Every one of those articles *does* have a picture. It is in the page's
// `<head>`, in the same `og:image` tag that Slack, iMessage and every social
// network use to unfurl a link. This module goes and gets it.
//
// WHAT THIS IS NOT
//
// Not a scraper. It reads the document head and stops — no body text, no
// paywalled content, no reproduction of anything the publisher wrote. The only
// thing extracted is the URL of the image the publisher explicitly published for
// exactly this purpose. `readingMinutes` in `html.ts` still refuses to fetch
// article bodies, and that remains the right line.
//
// THE COST, AND WHY IT IS AFFORDABLE
//
// One extra HTTP request per *new* imageless article. Articles already in the
// corpus keep the image they were enriched with, so this is bounded by what
// publishers put out in the last hour — a few dozen, not the whole corpus — and
// it runs under its own wall-clock budget that cannot eat into the feed sweep's.

/** Bytes of the document to read. The head is at the top; the body is not wanted. */
const HEAD_BYTES = 96_000;

const HTML_ACCEPT = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5";

export interface OgImageCandidate {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
}

// Attribute order and quote style both vary in the wild, so the tag is matched
// loosely and its attributes are read individually rather than positionally.
const META_RE = /<meta\b[^>]*>/gi;
const LINK_RE = /<link\b[^>]*>/gi;
const HEAD_END_RE = /<\/head\s*>/i;

function attr(tag: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = re.exec(tag);
  if (!match) return undefined;
  return decodeEntities((match[2] ?? match[3] ?? match[4] ?? "").trim());
}

function numeric(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Resolve a possibly-relative image reference against the article's own URL.
 *
 * Protocol-relative (`//cdn.example/a.jpg`) and root-relative (`/a.jpg`) are both
 * common in `og:image`, despite the specification requiring absolute URLs.
 */
function absolutize(raw: string, base: string): string | undefined {
  if (!raw) return undefined;
  try {
    return new URL(raw, base).toString();
  } catch {
    return undefined;
  }
}

/**
 * Every image the document head advertises, best first.
 *
 * Precedence is by how deliberate the declaration is. `og:image` is what the
 * publisher chose for a link unfurl and is almost always the editorial hero.
 * `twitter:image` is usually the same asset. `link[rel=image_src]` is the
 * pre-OpenGraph spelling and still emitted by older CMSes. JSON-LD `image` is
 * last because schema.org markup frequently points at a logo — it is a
 * description of the *publisher* as often as of the article.
 */
export function extractHeadImages(html: string, baseUrl: string): OgImageCandidate[] {
  // Everything after `</head>` is body markup, where an `<img>` is as likely to
  // be a share icon as a hero. Cutting there also means a truncated read of a
  // huge page cannot accidentally reach into article content.
  const headEnd = HEAD_END_RE.exec(html);
  const head = headEnd ? html.slice(0, headEnd.index) : html;

  const og: OgImageCandidate[] = [];
  const twitter: OgImageCandidate[] = [];
  const linkRel: OgImageCandidate[] = [];

  // OpenGraph's width/height/alt are separate tags that qualify the `og:image`
  // *preceding* them, so the candidate list is built in document order and the
  // qualifiers are applied to whatever was last seen.
  let pendingOg: OgImageCandidate | undefined;

  META_RE.lastIndex = 0;
  let tag: RegExpExecArray | null;
  while ((tag = META_RE.exec(head))) {
    const raw = tag[0];
    const key = (attr(raw, "property") ?? attr(raw, "name") ?? "").toLowerCase();
    if (!key) continue;
    const content = attr(raw, "content");
    if (!content) continue;

    switch (key) {
      case "og:image":
      case "og:image:url":
      case "og:image:secure_url": {
        const url = absolutize(content, baseUrl);
        if (!url) break;
        pendingOg = { url };
        og.push(pendingOg);
        break;
      }
      case "og:image:width":
        if (pendingOg) pendingOg.width = numeric(content);
        break;
      case "og:image:height":
        if (pendingOg) pendingOg.height = numeric(content);
        break;
      case "og:image:alt":
        if (pendingOg) pendingOg.alt = content.slice(0, 300);
        break;
      case "twitter:image":
      case "twitter:image:src": {
        const url = absolutize(content, baseUrl);
        if (url) twitter.push({ url });
        break;
      }
      case "twitter:image:alt":
        if (twitter.length) twitter[twitter.length - 1].alt = content.slice(0, 300);
        break;
      default:
        break;
    }
  }

  LINK_RE.lastIndex = 0;
  while ((tag = LINK_RE.exec(head))) {
    const rel = (attr(tag[0], "rel") ?? "").toLowerCase();
    if (rel !== "image_src" && rel !== "thumbnail") continue;
    const url = absolutize(attr(tag[0], "href") ?? "", baseUrl);
    if (url) linkRel.push({ url });
  }

  return [...og, ...twitter, ...linkRel, ...jsonLdImages(head, baseUrl)];
}

const JSON_LD_RE =
  /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;

/**
 * Images declared in schema.org JSON-LD.
 *
 * `image` is polymorphic by specification — a string, an ImageObject, or an
 * array of either — and publishers use all three spellings. Anything that fails
 * to parse is skipped silently: malformed JSON-LD is extremely common and is not
 * worth a warning in a snapshot an operator reads.
 */
function jsonLdImages(head: string, baseUrl: string): OgImageCandidate[] {
  const found: OgImageCandidate[] = [];

  JSON_LD_RE.lastIndex = 0;
  let block: RegExpExecArray | null;
  while ((block = JSON_LD_RE.exec(head))) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block[1]);
    } catch {
      continue;
    }

    const push = (value: unknown): void => {
      if (found.length >= 4) return;
      if (typeof value === "string") {
        const url = absolutize(value, baseUrl);
        if (url) found.push({ url });
        return;
      }
      if (value && typeof value === "object") {
        const object = value as Record<string, unknown>;
        const url = typeof object.url === "string" ? absolutize(object.url, baseUrl) : undefined;
        if (url) {
          found.push({
            url,
            width: numeric(String(object.width ?? "")),
            height: numeric(String(object.height ?? "")),
          });
        }
      }
    };

    const visit = (node: unknown, depth: number): void => {
      if (depth > 4 || found.length >= 4) return;
      if (Array.isArray(node)) {
        for (const entry of node) visit(entry, depth + 1);
        return;
      }
      if (!node || typeof node !== "object") return;

      const record = node as Record<string, unknown>;
      const image = record.image;
      if (Array.isArray(image)) for (const entry of image) push(entry);
      else if (image !== undefined) push(image);

      // `@graph` is how most CMS plugins nest the Article node.
      if (Array.isArray(record["@graph"])) visit(record["@graph"], depth + 1);
    };

    visit(parsed, 0);
  }

  return found;
}

/**
 * The first candidate that survives the quality gate.
 *
 * Exported separately from the fetch so the precedence and the rejection rules
 * can be tested against fixture HTML without a network.
 */
export function pickHeadImage(
  candidates: readonly OgImageCandidate[],
): OgImageCandidate | undefined {
  return candidates.find((candidate) =>
    isUsableStoryImage(candidate.url, { width: candidate.width, height: candidate.height }),
  );
}

export interface VerifyImageOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Confirm a discovered URL actually serves an image.
 *
 * The failure this catches is a soft 404: a URL ending `.jpg` that answers 200
 * with an HTML error page, or a CDN placeholder that is 800 bytes of grey. Both
 * render as a broken or blank card, and nothing earlier in the pipeline has the
 * response headers needed to tell.
 *
 * Ambiguity resolves in the image's favour. A CDN that rejects `HEAD` with 405,
 * or that times out, tells us nothing — dropping the image there would trade a
 * rare bad picture for a common missing one. Only an explicit answer counts
 * against it: a 404/410, or a 2xx that is demonstrably not a usable image.
 */
export async function verifyImageUrl(
  url: string,
  options: VerifyImageOptions = {},
): Promise<boolean> {
  const { timeoutMs = 3_000, signal } = options;

  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      cache: "no-store",
      headers: { Accept: "image/*", "User-Agent": ATLAS_UA },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
    });

    if (res.status === 404 || res.status === 410) return false;
    // 405/501 (HEAD unsupported), 403 (bot-hostile WAF), anything else: unproven.
    if (!res.ok) return true;

    return isUsableImageResponse(
      res.headers.get("content-type"),
      res.headers.get("content-length"),
    );
  } catch {
    return true;
  }
}

export interface DiscoverImagesOptions {
  /** Wall-clock ceiling for the whole pass. */
  budgetMs?: number;
  concurrency?: number;
  /** Hard cap on article pages fetched in one run. */
  limit?: number;
  /** Confirm each discovered URL with a HEAD probe. */
  verify?: boolean;
  /**
   * Article id → previous failed attempts. Anything at or over
   * `MAX_IMAGE_ATTEMPTS` is skipped, which is what lets each sweep reach
   * candidates the last one never got to.
   */
  misses?: Readonly<Record<string, number>>;
  signal?: AbortSignal;
}

/**
 * Attempts before an article is left alone.
 *
 * Two, not one: a single failure is as likely to be a timeout or a WAF as it is
 * to be a page with no `og:image`, and giving up on the first would throw away
 * recoverable articles. Not more than two, because the pages that fail twice are
 * overwhelmingly the ones that will always fail, and the budget is better spent
 * on candidates nobody has tried.
 */
export const MAX_IMAGE_ATTEMPTS = 2;

export interface DiscoverImagesResult {
  /** Article pages fetched. */
  attempted: number;
  /** Articles that gained an image. */
  resolved: number;
  /** Ids tried without success this run, for the caller to persist. */
  missed: string[];
}

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * One article page, fetched and mined for its hero image.
 *
 * Never throws: a dead link, a 403, a timeout or a page with no `og:image` are
 * all the same outcome — the article keeps its generated art, which was already
 * the status quo before this pass existed.
 */
async function resolveOne(
  article: RawArticle,
  options: { verify: boolean; signal?: AbortSignal },
): Promise<NewsImage | undefined> {
  let html: string;
  try {
    const result = await fetchText(article.url, {
      accept: HTML_ACCEPT,
      maxBytes: HEAD_BYTES,
      timeoutMs: 5_000,
      // One attempt only. A page that does not answer promptly is not worth a
      // second request when the cost of failing is a gradient instead of a
      // photo, and a publisher that refuses this fetcher will refuse it twice —
      // see the note on 403s in `fetch.ts`.
      retries: 0,
      signal: options.signal,
    });
    if (result.status !== "ok" || !result.body) return undefined;
    html = result.body;
  } catch {
    return undefined;
  }

  const picked = pickHeadImage(extractHeadImages(html, article.url));
  if (!picked) return undefined;

  if (options.verify && !(await verifyImageUrl(picked.url, { signal: options.signal }))) {
    return undefined;
  }

  let host: string;
  try {
    host = new URL(picked.url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }

  return {
    url: picked.url,
    host,
    width: picked.width,
    height: picked.height,
    alt: picked.alt,
    source: "opengraph",
  };
}

/**
 * Fill in missing images across a batch of freshly-fetched articles.
 *
 * Mutates in place, because the alternative is rebuilding the outcome graph to
 * thread a second value through every stage for the sake of one optional field.
 *
 * Ordering is by source weight so that when the budget expires, what got a
 * picture is the first-party announcement rather than the fourth aggregator
 * rewrite of it — the same principle `activeFeeds()` applies to the sweep.
 */
export async function discoverImages(
  articles: readonly RawArticle[],
  options: DiscoverImagesOptions = {},
): Promise<DiscoverImagesResult> {
  const {
    budgetMs = envInt("ATLAS_NEWS_OG_BUDGET_MS", 20_000),
    concurrency = envInt("ATLAS_NEWS_OG_CONCURRENCY", 10),
    limit = envInt("ATLAS_NEWS_OG_LIMIT", 120),
    verify = process.env.ATLAS_NEWS_OG_VERIFY !== "false",
    misses = {},
    signal,
  } = options;

  // Ordering decides what gets a picture when the budget runs out, so it is
  // ordered the way the feed is read: trusted sources first, and within a source
  // the newest story first. Sorting by source weight alone spent the budget on a
  // first-party blog's back catalogue while today's headlines stayed grey.
  // De-duplicate by id, keeping the first occurrence. The caller passes this
  // sweep's arrivals ahead of the carried corpus, so a story present in both is
  // enriched once, on the object the merge will actually keep.
  // Ordering decides what gets a picture when the budget runs out, and it is the
  // difference between coverage that climbs and coverage that crawls.
  //
  //   1. NEVER TRIED first. A bounded pass over a fixed ordering otherwise
  //      spends its whole budget re-attempting the same failures for two full
  //      sweeps before the strike count lets it move on — so the corpus creeps
  //      forward one batch every two hours instead of one every hour, while an
  //      untried tail sits there untouched.
  //   2. Then source weight, so a first-party announcement outranks the fourth
  //      rewrite of it.
  //   3. Then recency, so today's headlines beat a blog's back catalogue.
  const seen = new Set<string>();
  const attempts = (id: string): number => misses[id] ?? 0;

  const pending = articles
    .filter((article) => {
      if (article.image || seen.has(article.id)) return false;
      if (attempts(article.id) >= MAX_IMAGE_ATTEMPTS) return false;
      seen.add(article.id);
      return true;
    })
    .sort(
      (a, b) =>
        attempts(a.id) - attempts(b.id) ||
        b.sourceWeight - a.sourceWeight ||
        Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
    )
    .slice(0, limit);

  if (!pending.length) return { attempted: 0, resolved: 0, missed: [] };

  const deadline = AbortSignal.timeout(budgetMs);
  const passSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;

  let cursor = 0;
  let attempted = 0;
  let resolved = 0;
  const missed: string[] = [];

  async function drain(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= pending.length) return;
      // The deadline is checked between items rather than only inside `fetch`,
      // so an expired budget stops issuing new requests immediately instead of
      // starting one that is guaranteed to abort. It also means an article the
      // budget never reached is NOT recorded as a miss — it was never tried.
      if (passSignal.aborted) return;

      const article = pending[index];
      attempted += 1;
      const image = await resolveOne(article, { verify, signal: passSignal });
      if (image) {
        article.image = image;
        resolved += 1;
      } else {
        missed.push(article.id);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, drain));

  return { attempted, resolved, missed };
}
