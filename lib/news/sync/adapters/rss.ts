import type { CatalogSnapshot } from "@/lib/catalog/snapshot";
import type { FeedSource } from "../../feeds";
import { isUsableStoryImage } from "../../image";
import { classify, isAiRelevant, relevanceScore } from "../classify";
import { signatureOf } from "../cluster";
import { extractEntities } from "../entities";
import { fetchText, SyncFetchError } from "../fetch";
import { readingMinutes } from "../html";
import { canonicalizeUrl, articleId, hostMatchesDomains, registrableDomain } from "../normalize";
import { itemText, parseFeed, type RawFeedItem } from "../parse";
import { summarize } from "../summarize";
import type { FeedFetchOutcome, RawArticle } from "../types";
import type { NewsImage, NewsSourceResult } from "../../types";

// One feed, end to end: fetch → parse → normalize → deterministic enrichment.
//
// Everything past this point in the pipeline works on `RawArticle[]` and never
// touches the network, which is what keeps `merge.ts` and the clusterer testable
// against plain fixtures.
//
// This function never throws. A feed that 404s, times out, serves an HTML error
// page with HTTP 200, or returns malformed XML produces an outcome with
// `status: "failed"` and zero articles. The sanity gates in `merge.ts` then
// ensure a failed feed removes nothing from the corpus — the previous snapshot's
// articles for that source simply carry forward.

export interface FetchFeedOptions {
  catalog: CatalogSnapshot;
  /** Validators stored from the previous sync, for a conditional request. */
  etag?: string;
  lastModified?: string;
  now?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Cap on items taken from one feed, so a firehose cannot dominate the corpus. */
  maxItems?: number;
}

export async function fetchFeed(
  feed: FeedSource,
  options: FetchFeedOptions,
): Promise<FeedFetchOutcome> {
  const { catalog, etag, lastModified, now = Date.now(), signal, timeoutMs, maxItems = 40 } = options;
  const started = Date.now();

  if (feed.enabled === false) {
    return { feed, result: { status: "disabled", items: 0, fresh: 0 }, articles: [] };
  }

  let body: string;
  let nextEtag: string | undefined;
  let nextLastModified: string | undefined;
  let httpStatus = 0;

  try {
    const response = await fetchText(feed.url, { etag, lastModified, signal, timeoutMs });
    httpStatus = response.httpStatus;
    nextEtag = response.etag;
    nextLastModified = response.lastModified;

    if (response.status === "not_modified") {
      // Nothing changed upstream. `merge.ts` carries this source's existing
      // articles forward untouched — this is the steady state of an hourly sweep
      // and the reason it costs almost nothing.
      return {
        feed,
        result: { status: "not_modified", items: 0, fresh: 0, ms: Date.now() - started, httpStatus },
        articles: [],
        etag: nextEtag,
        lastModified: nextLastModified,
      };
    }

    body = response.body;
  } catch (err) {
    return {
      feed,
      result: {
        status: "failed",
        items: 0,
        fresh: 0,
        ms: Date.now() - started,
        httpStatus: err instanceof SyncFetchError ? err.status ?? 0 : 0,
        error: err instanceof Error ? err.message.slice(0, 300) : "fetch failed",
      },
      articles: [],
    };
  }

  const parsed = parseFeed(body, { now, maxItems: maxItems * 3 });

  if (!parsed.items.length) {
    // Zero items has two very different causes, and conflating them cries wolf.
    //
    // A source serving an error page with HTTP 200, or one whose URL now
    // redirects to a landing page, contributes nothing while reporting success —
    // that is the failure mode that otherwise looks like health, and it is named
    // in the UI's warning strip.
    //
    // But a well-formed feed with an empty channel is a publisher who has not
    // published. arXiv declares `<skipDays>` for Saturday and Sunday and serves
    // exactly that all weekend; reporting its three categories as failures put a
    // permanent "3 of 32 sources failed" banner over the feed every weekend.
    const recognized = parsed.recognized;
    return {
      feed,
      result: {
        status: recognized ? "skipped" : "failed",
        items: 0,
        fresh: 0,
        ms: Date.now() - started,
        httpStatus,
        error: recognized ? "feed published no items" : "no items parsed",
      },
      articles: [],
      etag: nextEtag,
      lastModified: nextLastModified,
    };
  }

  const articles: RawArticle[] = [];
  const seen = new Set<string>();

  for (const item of parsed.items) {
    const article = toArticle(item, feed, catalog, now);
    if (!article) continue;
    // A feed that lists the same story twice (common around an update) should
    // not contribute it twice.
    if (seen.has(article.id)) continue;
    seen.add(article.id);
    articles.push(article);
    if (articles.length >= maxItems) break;
  }

  const result: NewsSourceResult = {
    status: "ok",
    items: parsed.items.length,
    fresh: articles.length,
    ms: Date.now() - started,
    httpStatus,
  };

  return { feed, result, articles, etag: nextEtag, lastModified: nextLastModified };
}

/**
 * Turn one parsed feed item into an enriched article, or drop it.
 *
 * Exported for `merge.test.ts` and the keyed adapters, which need the same
 * normalization applied to items that did not come from XML.
 */
export function toArticle(
  item: RawFeedItem,
  feed: FeedSource,
  catalog: CatalogSnapshot,
  now: number,
): RawArticle | null {
  const canonical = canonicalizeUrl(item.link, feed.homepage);
  // No usable destination means the reader could not verify it and we could not
  // give it a stable id. There is nothing to salvage.
  if (!canonical) return null;

  const title = item.title.trim();
  if (!title) return null;

  const bodyText = itemText(item);

  // The relevance gate, for general-technology feeds only. A lab's own
  // announcement channel is on-topic by construction, and gating it would only
  // reject genuinely novel terminology — which is the news worth having.
  if (feed.requiresAiFilter && !isAiRelevant(`${title} ${bodyText}`)) return null;

  const summary = summarize({
    summaryHtml: item.summaryHtml,
    contentHtml: item.contentHtml,
    title,
  });

  const { models, orgs } = extractEntities(title, bodyText, catalog);

  const topics = classify({
    title,
    summary: summary || bodyText.slice(0, 400),
    categories: item.categories,
    hints: feed.topicHint,
  });

  // A feed with no date is not a reason to drop the item; it is a reason to
  // treat "when we first saw it" as its timestamp. `parse.ts` deliberately does
  // not invent one so that this decision lives in exactly one place.
  const firstSeenAt = new Date(now).toISOString();
  const publishedAt = item.publishedAt ?? firstSeenAt;

  const image = toImage(item, canonical.url);

  return {
    id: articleId(canonical.key),
    urlKey: canonical.key,
    title,
    summary,
    bodyText: bodyText.slice(0, 1_200),
    url: canonical.url,
    domain: canonical.domain,
    host: canonical.host.replace(/^www\./, ""),
    sourceId: feed.id,
    sourceName: feed.name,
    tier: feed.tier,
    brand: feed.brand,
    author: item.author,
    publishedAt,
    firstSeenAt,
    topics,
    models,
    orgs,
    image,
    readMinutes: readingMinutes(bodyText),
    domainMatch: hostMatchesDomains(canonical.host, feed.domains),
    signature: signatureOf(title, models),
    aggregator: Boolean(feed.aggregator),
    sourceWeight: feed.weight,
  };
}

/**
 * Validate and attach the item's image.
 *
 * Resolved against the article URL so a protocol-relative or root-relative
 * `src` still works, and restricted to https because the proxy will refuse
 * anything else anyway — better to drop it here than to render a card whose
 * image is guaranteed to 404.
 *
 * The quality gate runs here too, and rejecting is the *better* outcome: an
 * article whose only feed image is a FeedBurner tracking pixel is left with no
 * image at all, which is precisely what makes it eligible for the OpenGraph pass
 * in `sync/og.ts` and gets it a real photograph instead. Before the gate existed
 * the pixel won, because it was technically an image and nothing looked closer.
 */
function toImage(item: RawFeedItem, articleUrl: string): NewsImage | undefined {
  if (!item.image?.url) return undefined;

  const resolved = canonicalizeUrl(item.image.url, articleUrl);
  if (!resolved) return undefined;
  if (!resolved.url.startsWith("https://")) return undefined;

  if (!isUsableStoryImage(resolved.url, { width: item.image.width, height: item.image.height })) {
    return undefined;
  }

  return {
    url: resolved.url,
    host: resolved.host,
    width: item.image.width,
    height: item.image.height,
    source: "feed",
  };
}

/** Every image host a set of articles references. Feeds the proxy allowlist. */
export function imageHostsOf(articles: readonly { image?: NewsImage }[]): string[] {
  const hosts = new Set<string>();
  for (const article of articles) {
    if (article.image?.host) hosts.add(article.image.host.toLowerCase());
  }
  return [...hosts].sort();
}

export { registrableDomain };
