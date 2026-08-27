import { BENCHMARKS } from "@/lib/catalog/benchmarks";
import { PROVIDER_LIST } from "@/lib/catalog/providers";
import { allModels } from "@/lib/catalog";
import { activeSnapshot } from "@/lib/catalog/snapshot";
import type { NewsArticle, NewsCluster } from "@/lib/news/types";
import { buildCatalogGraph } from "./build-catalog";
import { buildNewsGraph } from "./build-news";
import { indexGraph, mergeDeltas, type AtlasGraph, type GraphDelta } from "./types";

/**
 * Assembling the graph the app actually queries.
 *
 * Three halves with three different lifetimes, which is why they are assembled
 * here rather than being one builder:
 *
 *  - **Catalog** — a pure function of the snapshot the client already holds, so
 *    it is derived on demand and memoised against `activeSnapshot().version`.
 *    Nothing is stored and nothing can go stale.
 *  - **News** — the same, but the chat surface does not hold the news snapshot
 *    (it is a server prop on `/news`). So it is *attached* by a caller that has
 *    it rather than fetched from here: a module that reaches for the network on
 *    import is a module that breaks offline, and the catalog half must keep
 *    working with no network at all.
 *  - **Workspace** — the user's own, which no snapshot can regenerate. Loaded
 *    from IndexedDB by `lib/graph/store.ts` and passed in.
 *
 * The memo is a single slot rather than an LRU on purpose: there is exactly one
 * live combination at a time, and a cache that can hold two copies of a
 * 2,000-node graph is a memory leak wearing a hat.
 */

export interface NewsSource {
  /** The snapshot's content hash, so the memo can tell one corpus from another. */
  version: string;
  articles: NewsArticle[];
  clusters: NewsCluster[];
}

export interface GraphSources {
  news?: NewsSource;
  /** Nodes and edges loaded from `loadWorkspaceGraph()`. */
  workspace?: GraphDelta;
}

let cache: { key: string; graph: AtlasGraph } | null = null;

export function atlasGraph(sources: GraphSources = {}): AtlasGraph {
  // Models come from the public selector, not from `activeSnapshot().models`:
  // the selector falls back to the bundled baseline when nothing has been
  // installed, so the graph sees exactly the catalog the leaderboard and the
  // cost frontier see. The version is only ever used as a cache key, and it is
  // a stable function of the same state either way.
  const models = allModels();
  const key = [
    activeSnapshot().version,
    sources.news?.version ?? "-",
    fingerprint(sources.workspace),
  ].join("|");
  if (cache && cache.key === key) return cache.graph;

  const catalog = buildCatalogGraph({
    models,
    benchmarks: BENCHMARKS,
    providers: PROVIDER_LIST,
  });

  const parts: GraphDelta[] = [catalog];
  if (sources.news) {
    parts.push(
      buildNewsGraph({
        articles: sources.news.articles,
        clusters: sources.news.clusters,
        // Handing the brand labels across is what stops "Anthropic" existing
        // twice — once with every model, once with every article.
        knownBrands: catalog.nodes.filter((n) => n.kind === "brand").map((n) => n.label),
      }),
    );
  }
  if (sources.workspace) parts.push(sources.workspace);

  const graph = indexGraph(mergeDeltas(...parts));
  cache = { key, graph };
  return graph;
}

/** Drop the memo. For tests, and for a snapshot install that changes nothing else. */
export function resetAtlasGraph(): void {
  cache = null;
}

/**
 * A cheap content key over a delta.
 *
 * FNV-1a over ids only — not props. The workspace overlay is rewritten
 * wholesale by its builders, so an id set that has not changed means a graph
 * that has not changed, and hashing every prop of every node on each call would
 * cost more than rebuilding.
 */
function fingerprint(delta?: GraphDelta): string {
  if (!delta || (delta.nodes.length === 0 && delta.edges.length === 0)) return "-";
  let h = 0x811c9dc5;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  for (const n of delta.nodes) feed(n.id);
  for (const e of delta.edges) {
    feed(e.from);
    feed(e.kind);
    feed(e.to);
  }
  return (h >>> 0).toString(36);
}
