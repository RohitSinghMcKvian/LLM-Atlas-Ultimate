import { activeFeeds } from "./feeds";
import { emptyStats, summarizeSources } from "./sync/merge";
import type { NewsSnapshot } from "./types";

// The bundled baseline snapshot.
//
// WHY THIS IS EMPTY, AND WHY THAT IS THE RIGHT ANSWER
//
// `lib/catalog/baseline.ts` ships ~400 real models so the app works offline and
// on a cold server. The obvious symmetry would be to ship a starter corpus of
// news here — and the plan for this feature originally called for one.
//
// It would have to be invented. Writing plausible headlines, attributing them to
// OpenAI or The Verge, and giving them `verified` badges and links to
// `openai.com` would put fabricated news, wearing this feature's own trust
// badges, in front of a reader — inside the one feature whose entire premise is
// that everything on screen is traceable to a real publisher. No amount of
// "bundled starter feed" labelling makes that a good trade.
//
// So the baseline is genuinely empty, and the UI has an honest cold-start state:
// "the first sync hasn't finished yet". The window is small — `getNewsSnapshot`
// schedules a sync on the first request that sees a stale snapshot, and the
// feeds need no API keys, so the corpus fills within seconds of the first page
// view. Unlike the catalog, news has no meaningful offline story to protect:
// news that cannot be fetched is not news.
//
// A deployment with no outbound network at all shows the empty state forever,
// which is exactly what is true.

export const BASELINE_NEWS_SNAPSHOT: NewsSnapshot = {
  version: "baseline-empty",
  syncedAt: new Date(0).toISOString(),
  origin: "baseline",
  articles: [],
  clusters: [],
  stats: emptyStats(),
  // The source list is real even when the corpus is not, so the filter popover
  // and the "N sources" copy can show what Atlas is about to poll rather than
  // rendering an empty shell.
  sources: summarizeSources(activeFeeds(), {}, []),
  imageHosts: [],
  warnings: [],
  enrichment: { deterministic: true, llm: false },
};

/** True when this snapshot has never been filled by a real sync. */
export function isColdStart(snapshot: Pick<NewsSnapshot, "origin" | "articles">): boolean {
  return snapshot.origin === "baseline" || snapshot.articles.length === 0;
}
