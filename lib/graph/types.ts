/**
 * The Atlas Knowledge Graph — types and the indexed form.
 *
 * Atlas already owns a large, precise, structured corpus: ~400 catalog models
 * with routes, licences, prices, benchmark scores and capabilities, and a news
 * corpus whose sync already resolves `models[]`, `orgs[]` and `topics[]` per
 * article. Retrieval could not reach any of it, because `lib/chat/rag.ts` scores
 * prose chunks and the facts are not prose. A question like "open-licence models
 * under $1/M that beat Llama on MMLU" is a traversal, not a nearest-neighbour
 * lookup, so it was answered from pre-training — confidently, about a catalog
 * that changed this morning.
 *
 * Framework-agnostic by construction: NO React, NO zustand, NO browser globals,
 * in this file or in `build-catalog.ts` / `build-news.ts` / `query.ts`. That is
 * load-bearing twice over — `vitest.config.ts` runs under `environment: "node"`,
 * and the public MCP server has to build the same graph server-side.
 */

/**
 * What a node *is*.
 *
 * Kinds are closed rather than free-form strings because traversal weights,
 * ranking priors and the citation renderer all switch on them; a typo'd kind
 * would silently become an unreachable island rather than a compile error.
 */
export type NodeKind =
  // Catalog
  | "model"
  | "brand"
  | "family"
  | "provider"
  | "benchmark"
  | "capability"
  | "modality"
  | "license"
  | "tag"
  // News
  | "article"
  | "cluster"
  | "topic"
  | "org"
  // The user's own workspace
  | "conversation"
  | "artifact"
  | "memory"
  | "project_file"
  | "skill"
  | "connector";

/**
 * What relates two nodes.
 *
 * Direction matters and is always stated from the more specific node to the more
 * general one (`model —made_by→ brand`), so an expansion that walks `out` moves
 * up the abstraction and one that walks `in` enumerates instances. The traversal
 * in `query.ts` walks both, but ranking treats them differently.
 */
export type EdgeKind =
  | "made_by"
  | "in_family"
  | "routed_via"
  | "scored_on"
  | "has_capability"
  | "accepts"
  | "emits"
  | "licensed_as"
  | "tagged"
  | "about"
  | "in_cluster"
  | "on_topic"
  | "mentions"
  | "derived_from"
  | "used_tool";

/** Values a node may carry. Deliberately flat — the graph is not a document store. */
export type PropValue = string | number | boolean;

export interface GraphNode {
  /** `"<kind>:<key>"`. Stable across rebuilds, which is what makes deltas idempotent. */
  id: string;
  kind: NodeKind;
  /** What a human calls it. Printed in citations. */
  label: string;
  /**
   * One line of fact, printed in the citation block. Must be true on its own,
   * because the model may cite it without the surrounding subgraph.
   */
  summary: string;
  /**
   * The embeddable surface: label, aliases, summary and salient prop values.
   *
   * Kept separate from `summary` because the two have different jobs. `summary`
   * is read by a person and must stay short; `text` is read by a cosine and
   * wants every alias a question might use ("Llama 3.1 70B", "llama3", "Meta").
   */
  text: string;
  props: Record<string, PropValue>;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /**
   * 0..1 traversal strength. Not a probability — a prior on how much *following
   * this edge* tells you about the question that reached its source. A model's
   * benchmark score is a strong signal; the tag it shares with two hundred other
   * models is a weak one.
   */
  weight: number;
  props?: Record<string, PropValue>;
}

/** What a builder returns. Plain arrays: serialisable, diffable, order-independent. */
export interface GraphDelta {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * The indexed form: nodes by id plus both adjacency directions.
 *
 * Built once and read many times. Adjacency lists are sorted deterministically
 * (see `indexGraph`) so a traversal that truncates at a budget always truncates
 * at the same place — otherwise the same question would draw a different map on
 * every render, and a map that reshuffles cannot be read.
 */
export interface AtlasGraph {
  nodes: Map<string, GraphNode>;
  out: Map<string, GraphEdge[]>;
  in: Map<string, GraphEdge[]>;
  edgeCount: number;
}

export function nodeId(kind: NodeKind, key: string): string {
  return `${kind}:${slugKey(key)}`;
}

/**
 * Normalise a key into an id segment.
 *
 * Lowercased, non-alphanumerics collapsed to `-`. Two brands that differ only by
 * punctuation or case ("Meta" / "meta") must land on one node, or the graph
 * grows a duplicate island that neither half can see.
 */
export function slugKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function emptyDelta(): GraphDelta {
  return { nodes: [], edges: [] };
}

export function mergeDeltas(...deltas: GraphDelta[]): GraphDelta {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const d of deltas) {
    nodes.push(...d.nodes);
    edges.push(...d.edges);
  }
  return { nodes, edges };
}

/**
 * Build the indexed graph from one or more deltas.
 *
 * Two rules that matter:
 *
 *  1. **Last node wins on id collision, but only for a richer node.** Builders
 *     run in order and several of them mint the same brand or org node from
 *     different evidence. A later builder that knows less must not blank a
 *     summary an earlier one filled in, so a collision keeps the entry with the
 *     longer `text`. Without this, news (which knows an org's name and nothing
 *     else) silently overwrote the catalog's brand node.
 *  2. **Edges to unknown nodes are dropped, not invented.** A dangling edge is
 *     a bug in a builder; materialising a placeholder node for it would hide
 *     that bug behind a node with no facts in it, which the model would then
 *     cite.
 */
export function indexGraph(delta: GraphDelta): AtlasGraph {
  const nodes = new Map<string, GraphNode>();
  for (const n of delta.nodes) {
    const prev = nodes.get(n.id);
    if (!prev || n.text.length > prev.text.length) nodes.set(n.id, n);
  }

  const out = new Map<string, GraphEdge[]>();
  const inc = new Map<string, GraphEdge[]>();
  const seen = new Set<string>();
  let edgeCount = 0;

  for (const e of delta.edges) {
    if (!nodes.has(e.from) || !nodes.has(e.to)) continue;
    if (e.from === e.to) continue;
    const key = `${e.from}|${e.kind}|${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    push(out, e.from, e);
    push(inc, e.to, e);
    edgeCount++;
  }

  for (const list of out.values()) list.sort(compareEdges);
  for (const list of inc.values()) list.sort(compareEdges);

  return { nodes, out, in: inc, edgeCount };
}

function push(map: Map<string, GraphEdge[]>, key: string, edge: GraphEdge): void {
  const list = map.get(key);
  if (list) list.push(edge);
  else map.set(key, [edge]);
}

/** Heaviest first, then by kind and endpoint so ties break deterministically. */
function compareEdges(a: GraphEdge, b: GraphEdge): number {
  if (b.weight !== a.weight) return b.weight - a.weight;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  const an = `${a.from}|${a.to}`;
  const bn = `${b.from}|${b.to}`;
  return an < bn ? -1 : an > bn ? 1 : 0;
}

export function emptyGraph(): AtlasGraph {
  return { nodes: new Map(), out: new Map(), in: new Map(), edgeCount: 0 };
}

export interface GraphStats {
  nodes: number;
  edges: number;
  byKind: Record<string, number>;
}

export function graphStats(g: AtlasGraph): GraphStats {
  const byKind: Record<string, number> = {};
  for (const n of g.nodes.values()) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
  return { nodes: g.nodes.size, edges: g.edgeCount, byKind };
}
