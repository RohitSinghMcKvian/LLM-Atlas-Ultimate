import type { Metadata } from "next";
import { NewsClient } from "@/components/news/news-client";
import { getNewsSnapshot, toWireNews } from "@/lib/news/store";
import { getCatalogSnapshot } from "@/lib/catalog/store";
import { parseNewsSearchParams } from "@/lib/news/select";

/**
 * Articles embedded in the RSC payload. The rest are paged in by `NewsClient`
 * immediately after mount from `/api/v1/news?offset=`.
 *
 * Not a performance nicety: the corpus reached 238 articles in testing and the
 * untruncated document was 2.2 MB, which is enough to exhaust a dev server's
 * heap on repeat renders. See `toWireNews` in `lib/news/snapshot.ts`.
 */
const PAGE_ARTICLE_LIMIT = 60;

export const metadata: Metadata = {
  title: "Atlas News",
  description:
    "Verified AI news from first-party labs, arXiv, press and analysts. De-duplicated across publishers, provenance-scored, and re-synced every hour.",
};

// The corpus is a runtime snapshot that changes hourly, so this page can never
// be prerendered.
export const dynamic = "force-dynamic";

/**
 * Both snapshots are fetched in parallel and handed down as props.
 *
 * The news corpus arrives as a server prop rather than a client fetch, so the
 * first paint is the real feed — no spinner, no layout shift, and no request
 * from the browser at all on the initial load. The model catalog is installed
 * a level up, by the workspace layout, so this route only reads the one field
 * of it the feed actually draws — the diff — rather than re-serializing all
 * ~400 models into this page's payload as well.
 *
 * Reading `getNewsSnapshot()` here is also what drives the zero-configuration
 * sync: if the corpus is older than the interval it schedules a refresh behind
 * this response and serves the current one immediately.
 */
export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [news, catalog, params] = await Promise.all([
    getNewsSnapshot(),
    getCatalogSnapshot(),
    searchParams,
  ]);

  return (
    <NewsClient
      snapshot={toWireNews(news, { limit: PAGE_ARTICLE_LIMIT })}
      totalArticles={news.articles.length}
      catalogDiff={catalog.diff}
      initial={parseNewsSearchParams(params)}
      // The operator can remove the public Refresh surface entirely; the
      // client hides the button rather than offering one that 404s.
      publicRefresh={process.env.ATLAS_NEWS_PUBLIC_REFRESH !== "false"}
    />
  );
}
