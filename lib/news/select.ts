import { liveScore } from "./rank";
import { VERIFICATION_LEVEL_RANK } from "./sync/verify";
import type {
  NewsArticle,
  NewsCluster,
  NewsFilterState,
  NewsSort,
  NewsTopic,
  NewsView,
} from "./types";
import { isNewsTopic } from "./topics";

// Filtering, searching and sorting — the whole read model for the feed.
//
// Pure functions over the snapshot, so the client can re-derive a view on every
// keystroke without a round trip, and so every rule here is testable without
// rendering anything.

export const DEFAULT_FILTERS: NewsFilterState = {
  topics: [],
  query: "",
  sources: [],
  verifiedOnly: false,
  savedOnly: false,
  sort: "top",
  view: "magazine",
};

const SORTS: NewsSort[] = ["top", "latest", "verified", "corroborated"];
const VIEWS: NewsView[] = ["magazine", "grid", "compact", "timeline"];

// --- URL state ---------------------------------------------------------------
//
// The whole filter state round-trips through the query string, so a filtered
// view is shareable and the back button works.

export function parseNewsSearchParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): NewsFilterState {
  const get = (key: string): string | undefined => {
    if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const list = (key: string): string[] =>
    (get(key) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const sort = get("sort");
  const view = get("view");

  return {
    topics: list("t").filter(isNewsTopic),
    query: (get("q") ?? "").slice(0, 120),
    sources: list("src").slice(0, 40),
    verifiedOnly: get("verified") === "1",
    savedOnly: get("saved") === "1",
    sort: SORTS.includes(sort as NewsSort) ? (sort as NewsSort) : "top",
    view: VIEWS.includes(view as NewsView) ? (view as NewsView) : "magazine",
    articleId: get("a") || undefined,
  };
}

/** Serialise back to a query string, omitting defaults so clean URLs stay clean. */
export function toNewsSearchParams(state: NewsFilterState): string {
  const params = new URLSearchParams();
  if (state.topics.length) params.set("t", state.topics.join(","));
  if (state.query.trim()) params.set("q", state.query.trim());
  if (state.sources.length) params.set("src", state.sources.join(","));
  if (state.verifiedOnly) params.set("verified", "1");
  if (state.savedOnly) params.set("saved", "1");
  if (state.sort !== "top") params.set("sort", state.sort);
  if (state.view !== "magazine") params.set("view", state.view);
  if (state.articleId) params.set("a", state.articleId);
  return params.toString();
}

export function hasActiveFilters(state: NewsFilterState): boolean {
  return Boolean(
    state.topics.length ||
      state.query.trim() ||
      state.sources.length ||
      state.verifiedOnly ||
      state.savedOnly,
  );
}

// --- Search ------------------------------------------------------------------

/**
 * Does this article match the query?
 *
 * Matches the domain and the model ids as well as the prose, so `openai.com` and
 * `claude-opus-4-8` are both valid searches — the two things a reader is most
 * likely to paste in.
 */
function matchesQuery(article: NewsArticle, needle: string): boolean {
  if (!needle) return true;
  return (
    article.title.toLowerCase().includes(needle) ||
    article.summary.toLowerCase().includes(needle) ||
    (article.abstract?.toLowerCase().includes(needle) ?? false) ||
    article.sourceName.toLowerCase().includes(needle) ||
    article.host.toLowerCase().includes(needle) ||
    article.domain.toLowerCase().includes(needle) ||
    (article.author?.toLowerCase().includes(needle) ?? false) ||
    article.orgs.some((org) => org.toLowerCase().includes(needle)) ||
    article.models.some((id) => id.toLowerCase().includes(needle))
  );
}

// --- Filtering ---------------------------------------------------------------

export interface SelectOptions {
  articles: readonly NewsArticle[];
  clusters: readonly NewsCluster[];
  filters: NewsFilterState;
  /** Ids the reader has saved, for `savedOnly`. */
  saved?: ReadonlySet<string>;
  now?: number;
  /**
   * Collapse clusters to their lead. On by default: showing four cards for one
   * story is exactly what the clustering exists to prevent.
   */
  collapseClusters?: boolean;
}

export interface SelectResult {
  articles: NewsArticle[];
  /** How many articles were available before filtering, for "showing 48 of 612". */
  total: number;
  /** Live counts per topic, for the chip row. Computed against the OTHER filters. */
  topicCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
}

/**
 * Apply the filter state to the corpus.
 *
 * Topic semantics: OR *within* topics (a story matching any selected topic
 * qualifies), AND *across* filter kinds (it must also match the source filter,
 * the query, and so on). That is what a reader means by ticking two chips.
 */
export function selectArticles(options: SelectOptions): SelectResult {
  const {
    articles,
    clusters,
    filters,
    saved,
    now = Date.now(),
    collapseClusters = true,
  } = options;

  const needle = filters.query.trim().toLowerCase();
  const topicSet = new Set(filters.topics);
  const sourceSet = new Set(filters.sources);

  // Cluster membership is only meaningful for articles that are present, so the
  // lead lookup is built from the corpus rather than trusted from the index.
  const presentIds = new Set(articles.map((a) => a.id));
  const leadOfCluster = new Map<string, string>();
  for (const cluster of clusters) {
    const lead = cluster.memberIds.find((id) => presentIds.has(id));
    if (lead) leadOfCluster.set(cluster.id, lead);
  }

  const passes = (article: NewsArticle, ignore?: "topics" | "sources"): boolean => {
    if (ignore !== "topics" && topicSet.size) {
      if (!article.topics.some((t) => topicSet.has(t))) return false;
    }
    if (ignore !== "sources" && sourceSet.size && !sourceSet.has(article.sourceId)) return false;
    if (filters.verifiedOnly) {
      const level = article.verification.level;
      if (level !== "verified" && level !== "corroborated") return false;
    }
    if (filters.savedOnly && !saved?.has(article.id)) return false;
    if (!matchesQuery(article, needle)) return false;
    return true;
  };

  let selected = articles.filter((article) => {
    if (!passes(article)) return false;
    if (!collapseClusters) return true;
    // Keep the lead of each cluster. When a filter excludes the lead, the
    // best-ranked surviving member is promoted rather than the whole story
    // vanishing — a filtered view must never hide a story it matches.
    const lead = leadOfCluster.get(article.clusterId);
    if (!lead || lead === article.id) return true;
    const leadArticle = articles.find((a) => a.id === lead);
    return !leadArticle || !passes(leadArticle);
  });

  // Promotion can leave two survivors of one cluster when the lead was filtered
  // out; keep the best of them.
  if (collapseClusters) {
    const bestPerCluster = new Map<string, NewsArticle>();
    for (const article of selected) {
      const existing = bestPerCluster.get(article.clusterId);
      if (!existing || compare(article, existing, "top", now) < 0) {
        bestPerCluster.set(article.clusterId, article);
      }
    }
    selected = [...bestPerCluster.values()];
  }

  selected.sort((a, b) => compare(a, b, filters.sort, now));

  // Only the default "Top" ranking is diversified. "Latest" must stay strictly
  // chronological, and the two verification sorts have explicit semantics a
  // reader chose deliberately — reordering those would be lying about the sort.
  if (filters.sort === "top") selected = diversifyBySource(selected, now);

  // Counts are computed with the corresponding filter *ignored*, so a chip
  // showing "12" means "12 if you tick this", not "0 because it is not ticked".
  const topicCounts: Record<string, number> = {};
  const sourceCounts: Record<string, number> = {};
  for (const article of articles) {
    if (passes(article, "topics")) {
      for (const topic of article.topics) topicCounts[topic] = (topicCounts[topic] ?? 0) + 1;
    }
    if (passes(article, "sources")) {
      sourceCounts[article.sourceId] = (sourceCounts[article.sourceId] ?? 0) + 1;
    }
  }

  return {
    articles: selected,
    total: collapseClusters ? countLeads(articles, leadOfCluster) : articles.length,
    topicCounts,
    sourceCounts,
  };
}

/** Points deducted for each earlier article already placed from the same source. */
const REPEAT_PENALTY = 9;
/** How far ahead the greedy pass looks. Bounds the cost at ~n·k comparisons. */
const DIVERSITY_WINDOW = 40;

/**
 * Interleave sources in the default ranking.
 *
 * Publishers post in bursts. Google Developers shipped twelve items in one
 * window on live data, and because they shared a publication time and a source
 * weight they scored almost identically — so the entire first screen of the feed
 * was one publisher, and thirty other sources were invisible below the fold.
 * Sorting purely by score is *correct* and still produces a bad feed.
 *
 * A greedy pass with a per-source penalty fixes it without touching the scores
 * themselves: an article still has to be good to appear early, but the fourth
 * item from one source has to be substantially better than a first item from
 * someone else. Bounded lookahead keeps this linear in practice.
 */
function diversifyBySource(sorted: NewsArticle[], now: number): NewsArticle[] {
  if (sorted.length < 4) return sorted;

  // Scored once. `liveScore` parses a date, and this runs on every keystroke.
  const pool = sorted.map((article) => ({ article, score: liveScore(article, now) }));
  const out: NewsArticle[] = [];
  const placed = new Map<string, number>();

  while (pool.length) {
    const window = Math.min(pool.length, DIVERSITY_WINDOW);
    let bestIndex = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < window; i++) {
      const { article, score } = pool[i];
      const adjusted = score - (placed.get(article.sourceId) ?? 0) * REPEAT_PENALTY;
      if (adjusted > bestScore) {
        bestScore = adjusted;
        bestIndex = i;
      }
    }

    const [chosen] = pool.splice(bestIndex, 1);
    out.push(chosen.article);
    placed.set(chosen.article.sourceId, (placed.get(chosen.article.sourceId) ?? 0) + 1);
  }

  return out;
}

function countLeads(
  articles: readonly NewsArticle[],
  leadOfCluster: ReadonlyMap<string, string>,
): number {
  let count = 0;
  for (const article of articles) {
    if (leadOfCluster.get(article.clusterId) === article.id) count++;
  }
  return count || articles.length;
}

/**
 * The comparator behind every sort mode.
 *
 * Every branch ends in an id comparison, so the order is total and stable: an
 * unstable sort would reshuffle the feed on each keystroke of the search box.
 */
function compare(a: NewsArticle, b: NewsArticle, sort: NewsSort, now: number): number {
  switch (sort) {
    case "latest": {
      const delta = Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
      if (delta) return delta;
      break;
    }
    case "verified": {
      const rank =
        VERIFICATION_LEVEL_RANK[b.verification.level] -
        VERIFICATION_LEVEL_RANK[a.verification.level];
      if (rank) return rank;
      const score = b.verification.score - a.verification.score;
      if (score) return score;
      break;
    }
    case "corroborated": {
      const domains = b.verification.distinctDomains - a.verification.distinctDomains;
      if (domains) return domains;
      const sources = b.verification.corroboration - a.verification.corroboration;
      if (sources) return sources;
      break;
    }
    case "top":
    default: {
      const delta = liveScore(b, now) - liveScore(a, now);
      if (delta) return delta;
      break;
    }
  }
  // Recency, then id — always a total order.
  const recency = Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
  if (recency) return recency;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Cluster members other than the given article, in display order. */
export function clusterSiblings(
  article: NewsArticle,
  clusters: readonly NewsCluster[],
  articles: readonly NewsArticle[],
): NewsArticle[] {
  const cluster = clusters.find((c) => c.id === article.clusterId);
  if (!cluster) return [];
  const byId = new Map(articles.map((a) => [a.id, a]));
  return cluster.memberIds
    .filter((id) => id !== article.id)
    .map((id) => byId.get(id))
    .filter((a): a is NewsArticle => Boolean(a));
}

/** Articles related to this one: same models or topics, best first. */
export function relatedArticles(
  article: NewsArticle,
  articles: readonly NewsArticle[],
  limit = 4,
  now = Date.now(),
): NewsArticle[] {
  const models = new Set(article.models);
  const topics = new Set<NewsTopic>(article.topics);

  return articles
    .filter((a) => a.id !== article.id && a.clusterId !== article.clusterId)
    .map((a) => {
      const modelOverlap = a.models.filter((m) => models.has(m)).length;
      const topicOverlap = a.topics.filter((t) => topics.has(t)).length;
      return { article: a, relevance: modelOverlap * 3 + topicOverlap };
    })
    .filter((entry) => entry.relevance > 0)
    .sort(
      (x, y) =>
        y.relevance - x.relevance ||
        liveScore(y.article, now) - liveScore(x.article, now) ||
        (x.article.id < y.article.id ? -1 : 1),
    )
    .slice(0, limit)
    .map((entry) => entry.article);
}

/** Model ids ranked by how often the current corpus mentions them. */
export function trendingFromNews(articles: readonly NewsArticle[], limit = 6): string[] {
  const counts = new Map<string, number>();
  for (const article of articles) {
    for (const id of article.models) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([id]) => id);
}
