import type { Metadata } from "next";
import { CatalogScope } from "@/components/catalog/catalog-scope";
import { NewsClient } from "@/components/news/news-client";
import { getCatalogSnapshot } from "@/lib/catalog/store";
import { getNewsSnapshot } from "@/lib/news/store";
import { parseNewsSearchParams } from "@/lib/news/select";

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
 * from the browser at all on the initial load. `<CatalogScope>` installs the
 * model catalog before the client root renders, so server HTML and hydration
 * agree on which models exist.
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
    <CatalogScope snapshot={catalog}>
      <NewsClient
        snapshot={news}
        catalogDiff={catalog.diff}
        initial={parseNewsSearchParams(params)}
        // The operator can remove the public Refresh surface entirely; the
        // client hides the button rather than offering one that 404s.
        publicRefresh={process.env.ATLAS_NEWS_PUBLIC_REFRESH !== "false"}
      />
    </CatalogScope>
  );
}
