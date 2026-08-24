import type { NewsArticle, NewsCluster, NewsTopic } from "@/lib/news/types";
import { emptyDelta, nodeId, slugKey, type GraphDelta, type GraphEdge, type GraphNode } from "./types";

/**
 * The news half of the graph.
 *
 * This builder does no entity extraction. `lib/news/sync/entities.ts` already
 * resolves each article's `models[]` against the catalog and canonicalises its
 * `orgs[]` at sync time, and `lib/news/sync/cluster.ts` already assigns
 * `clusterId`. Those links existed and nothing consumed them; all this does is
 * turn them into edges.
 *
 * Pure and isomorphic, for the same reason as `build-catalog.ts`.
 */

export interface NewsGraphInput {
  articles: NewsArticle[];
  clusters: NewsCluster[];
  /**
   * Brand labels the catalog builder minted, so an org the news names can be
   * folded into the brand node instead of standing beside it.
   *
   * Without this, "Anthropic" exists twice — once as `brand:anthropic` carrying
   * every model, once as `org:anthropic` carrying every article — and a question
   * about Anthropic reaches exactly one of them. Passed in rather than imported
   * so this module stays independent of the catalog.
   */
  knownBrands?: string[];
  /**
   * How many articles to admit, newest first. The corpus runs to several
   * hundred and the older tail contributes noise to retrieval without
   * contributing answers.
   */
  limit?: number;
}

export const DEFAULT_ARTICLE_LIMIT = 240;

const TOPIC_LABELS: Record<NewsTopic, string> = {
  models: "Model releases",
  pricing: "Pricing",
  agents: "Agents",
  "open-source": "Open source",
  research: "Research",
  safety: "Safety",
  tools: "Tools",
  infrastructure: "Infrastructure",
  policy: "Policy",
  funding: "Funding",
  multimodal: "Multimodal",
};

export function buildNewsGraph(input: NewsGraphInput): GraphDelta {
  const delta = emptyDelta();
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const brandSlugs = new Set((input.knownBrands ?? []).map(slugKey));

  const add = (n: GraphNode) => {
    const prev = nodes.get(n.id);
    if (!prev || n.text.length > prev.text.length) nodes.set(n.id, n);
  };
  const link = (
    from: string,
    kind: GraphEdge["kind"],
    to: string,
    weight: number,
    props?: GraphEdge["props"],
  ) => {
    edges.push({ from, to, kind, weight, props });
  };

  const limit = input.limit ?? DEFAULT_ARTICLE_LIMIT;
  const articles = [...input.articles]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, limit);
  const admitted = new Set(articles.map((a) => a.id));

  const clusterById = new Map(input.clusters.map((c) => [c.id, c]));
  const usedClusters = new Set<string>();

  for (const a of articles) {
    const articleNode = nodeId("article", a.id);
    add({
      id: articleNode,
      kind: "article",
      label: a.title,
      // The date and the publisher are part of the claim, not decoration: a news
      // fact cited without them is unusable, and the model cites `summary`.
      summary: `${a.title} — ${a.host}, ${a.publishedAt.slice(0, 10)} (${a.verification.level}). ${a.summary}`,
      text: [a.title, a.summary, a.host, a.sourceName, ...a.topics, ...a.orgs].join(" "),
      props: {
        url: a.url,
        host: a.host,
        publishedAt: a.publishedAt,
        verification: a.verification.level,
        lead: a.lead,
      },
    });

    const cluster = clusterById.get(a.clusterId);
    if (cluster) {
      const clusterNode = nodeId("cluster", cluster.id);
      if (!usedClusters.has(cluster.id)) {
        usedClusters.add(cluster.id);
        const lead = input.articles.find((x) => x.id === cluster.leadId);
        add({
          id: clusterNode,
          kind: "cluster",
          label: lead?.title ?? "News cluster",
          summary: `A story reported by ${cluster.domains.length} publisher${cluster.domains.length === 1 ? "" : "s"} (${cluster.verification.level}), first seen ${cluster.firstAt.slice(0, 10)}.`,
          text: [lead?.title, ...cluster.topics, ...cluster.domains].filter(Boolean).join(" "),
          props: {
            publishers: cluster.domains.length,
            verification: cluster.verification.level,
            latestAt: cluster.latestAt,
          },
        });
        for (const t of cluster.topics) link(clusterNode, "on_topic", topic(add, t), 0.3);
      }
      link(articleNode, "in_cluster", clusterNode, 0.6);
    }

    for (const t of a.topics) link(articleNode, "on_topic", topic(add, t), 0.3);

    // The edge this whole builder exists for. An article that names a model is
    // the only thing in Atlas that can answer "what changed about this model
    // recently", so it outweighs every other news edge.
    for (const modelId of a.models) {
      link(articleNode, "about", nodeId("model", modelId), 0.85);
    }

    for (const org of a.orgs) {
      const slug = slugKey(org);
      if (brandSlugs.has(slug)) {
        // Fold into the catalog's brand node rather than minting a twin.
        link(articleNode, "about", nodeId("brand", org), 0.6);
        continue;
      }
      const orgNode = nodeId("org", org);
      add({
        id: orgNode,
        kind: "org",
        label: org,
        summary: `${org} — an organisation named in Atlas News.`,
        text: `${org} organisation company lab`,
        props: { name: org },
      });
      link(articleNode, "mentions", orgNode, 0.5);
    }
  }

  // Cluster membership only for articles that were actually admitted — a
  // dangling edge would be dropped by `indexGraph` anyway, and building it
  // pretends the tail is present.
  for (const c of input.clusters) {
    if (!usedClusters.has(c.id)) continue;
    for (const memberId of c.memberIds) {
      if (!admitted.has(memberId)) continue;
      link(nodeId("article", memberId), "in_cluster", nodeId("cluster", c.id), 0.6);
    }
  }

  delta.nodes = [...nodes.values()];
  delta.edges = edges;
  return delta;
}

function topic(add: (n: GraphNode) => void, t: NewsTopic): string {
  const id = nodeId("topic", t);
  add({
    id,
    kind: "topic",
    label: TOPIC_LABELS[t] ?? t,
    summary: `${TOPIC_LABELS[t] ?? t} — a news topic in Atlas.`,
    text: `${TOPIC_LABELS[t] ?? t} ${t} news topic`,
    props: { topic: t },
  });
  return id;
}
