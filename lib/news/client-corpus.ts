"use client";

import type { NewsCorpus } from "@/lib/tools/atlas";
import type { NewsArticle, NewsCluster } from "./types";

/**
 * The news corpus, on the client, for `atlas_news`.
 *
 * `AtlasToolPorts.news` is synchronous by design — every other Atlas tool is a
 * pure function over data the browser already holds, and making one of them
 * async would have made the whole registry async for the sake of a single
 * fetch. The corpus is the one piece that is not already here: `/news` receives
 * it as a server prop and chat does not.
 *
 * So it is primed rather than fetched at call time. A chat page with Atlas
 * tools on asks for it once on mount; until that lands, `news()` answers `null`
 * and the tool says plainly that it has no corpus, which is the honest answer
 * and the one it already gives. Nothing waits on the network mid-turn.
 *
 * Module-level rather than a store: there is exactly one corpus per tab, it is
 * read-only, and nothing re-renders when it arrives — the only reader is a tool
 * call that has not happened yet.
 */

let corpus: NewsCorpus | null = null;
let inflight: Promise<NewsCorpus | null> | null = null;

/** What has been loaded, or `null`. Never fetches — safe inside a tool call. */
export function cachedNewsCorpus(): NewsCorpus | null {
  return corpus;
}

/** How many articles to hold. The tool answers at most 12 at a time. */
export const CORPUS_LIMIT = 200;

/**
 * Load the corpus once per tab.
 *
 * Failures are swallowed to `null` on purpose. This runs on mount of a page
 * whose job is not news, so a feed that is down must cost the user nothing more
 * than an `atlas_news` call that says it has nothing — never an error banner on
 * a chat they opened to do something else.
 */
export async function primeNewsCorpus(signal?: AbortSignal): Promise<NewsCorpus | null> {
  if (corpus) return corpus;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(`/api/v1/news?limit=${CORPUS_LIMIT}`, { signal });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        articles?: NewsArticle[];
        clusters?: NewsCluster[];
      };
      if (!Array.isArray(body.articles)) return null;
      corpus = { articles: body.articles, clusters: body.clusters ?? [] };
      return corpus;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Testing seam, and the reset a sign-out should do. */
export function clearNewsCorpus(): void {
  corpus = null;
  inflight = null;
}
