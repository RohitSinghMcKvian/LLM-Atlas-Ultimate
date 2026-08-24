import { cosine, lexicalEmbed, LEXICAL_DIMS } from "@/lib/chat/embed";
import type { WebSource } from "@/lib/chat/types";
import { expand, rank, type ExpandOptions } from "./query";
import type { AtlasGraph, GraphEdge, GraphNode } from "./types";

/**
 * Graph-RAG: retrieve a *subgraph*, not a list of chunks.
 *
 * The three stages exist because each fixes a different failure of the flat
 * retrieval in `lib/chat/rag.ts`:
 *
 *  1. **Seed** - find what the question is about. Two ways, because they fail
 *     differently: a verbatim mention of a label is decisive and a cosine over a
 *     bag of words is not, so a named model always wins over a merely similar
 *     one. Cosine then catches everything the question described without naming.
 *  2. **Expand** - follow the relations. This is the whole point: "beats Llama
 *     on MMLU" needs Llama's MMLU edge and then every other model on that same
 *     benchmark, and no similarity measure over prose gets there.
 *  3. **Rank and cut** - a two-hop expansion is far too big to send. Ranking is
 *     personalised PageRank from the seeds, so what survives is what the
 *     question actually reaches.
 *
 * What comes back is numbered and `WebSource`-shaped so `reconcileCitations`
 * from `lib/research/citations.ts` applies to it unchanged - a graph citation
 * the answer did not earn is stripped by exactly the same code that strips an
 * unearned web citation.
 */

export type SeedVia = "mention" | "similarity" | "expansion";

export interface RetrievedNode {
  node: GraphNode;
  /** Personalised-PageRank mass. Comparable within one retrieval, not across. */
  score: number;
  /** Hops from the nearest seed. 0 for a seed. */
  depth: number;
  via: SeedVia;
}

export interface GraphContext {
  /** Ranked, numbered, and the only nodes the answer may cite. */
  cited: RetrievedNode[];
  /** `cited` as citation sources, index-aligned, for `reconcileCitations`. */
  sources: WebSource[];
  /** The block to put in the prompt. */
  text: string;
  /** The whole expansion - a superset of `cited`, for the Map. */
  scope: { nodes: RetrievedNode[]; edges: GraphEdge[]; truncated: boolean };
  seeds: string[];
}

export interface RetrieveOptions extends ExpandOptions {
  /** How many nodes may be cited. The prompt budget, not the map budget. */
  maxCited?: number;
  /** How many seeds to start from. */
  maxSeeds?: number;
  /** Minimum cosine for a similarity seed. Below it, the node is noise. */
  minSeedScore?: number;
  /**
   * Drop a similarity seed scoring below this fraction of the best one.
   *
   * A relative floor, because an absolute one cannot tell a good question from
   * a vague one. When the top match is 0.51 and the next is 0.19, everything
   * after the first is noise that will drag the walk into whatever
   * neighbourhood happens to be densest; when the top match is 0.12 the whole
   * question was vague and the spread is real.
   */
  seedRatio?: number;
  /** Hard character cap on the rendered block. */
  maxChars?: number;
  /** 1-based number of the first citation, so graph nodes can follow web sources. */
  startIndex?: number;
}

export const DEFAULT_MAX_CITED = 24;
export const DEFAULT_MAX_SEEDS = 10;
export const DEFAULT_MIN_SEED_SCORE = 0.06;
export const DEFAULT_SEED_RATIO = 0.4;
/**
 * Mass given to a seed the question named outright, against a cosine in 0..1.
 *
 * Being named is categorically stronger evidence than resembling, so it is
 * scored above the top of the similarity range rather than inside it.
 */
export const MENTION_WEIGHT = 1.5;
/**
 * Similarity seeds allowed alongside a mention.
 *
 * When the question named something, similarity is a supplement, not a second
 * opinion - "how does Summit Pro do on vision tasks" still wants the vision
 * node, but it does not want six brand and family nodes that happen to share a
 * word. Six weak seeds is how the provider serving a named model got ranked out
 * of its own answer: each one injects mass into whatever neighbourhood it sits
 * in, and the named model's neighbours have to outrank all of them.
 */
export const MENTION_SIMILARITY_SLOTS = 2;
export const DEFAULT_MAX_CHARS = 6_000;

/** Shortest label worth matching verbatim. Below this, every question "mentions" something. */
const MIN_MENTION_CHARS = 3;

export interface NodeIndex {
  ids: string[];
  vectors: number[][];
  /** Lowercased labels, longest first, for mention matching. */
  labels: { id: string; label: string }[];
}

// Keyed by graph identity: `atlasGraph()` memoises on content, so a new object
// is exactly the signal that the index is stale. A WeakMap means a graph that
// falls out of scope takes its index with it.
const indexes = new WeakMap<AtlasGraph, NodeIndex>();

export function nodeIndex(g: AtlasGraph): NodeIndex {
  const cached = indexes.get(g);
  if (cached) return cached;

  const ids: string[] = [];
  const vectors: number[][] = [];
  const labels: { id: string; label: string }[] = [];
  for (const n of g.nodes.values()) {
    ids.push(n.id);
    vectors.push(lexicalEmbed(n.text, LEXICAL_DIMS).vector);
    const label = n.label.toLowerCase();
    if (label.length >= MIN_MENTION_CHARS) labels.push({ id: n.id, label });
  }
  // Longest first so "Llama 3.1 70B" wins over "Llama" on the same question.
  labels.sort((a, b) => (b.label.length !== a.label.length ? b.label.length - a.label.length : a.id < b.id ? -1 : 1));

  const built = { ids, vectors, labels };
  indexes.set(g, built);
  return built;
}

/**
 * Labels named outright in the question.
 *
 * Matched on a normalised copy with non-alphanumerics collapsed, so "Llama-3.1"
 * in the question finds "Llama 3.1" in the catalog. Once a span is claimed by a
 * longer label it is blanked out, so "Llama 3.1 70B" does not also seed the
 * generic "Llama 3" family - the specific match is the one that was meant.
 */
export function mentionSeeds(g: AtlasGraph, question: string, limit: number): string[] {
  if (limit <= 0) return [];
  const { labels } = nodeIndex(g);
  let haystack = ` ${normalize(question)} `;
  const found: string[] = [];
  for (const { id, label } of labels) {
    if (found.length >= limit) break;
    const term = normalize(label);
    if (term.length < MIN_MENTION_CHARS) continue;
    const needle = ` ${term} `;
    const at = haystack.indexOf(needle);
    if (at === -1) continue;
    found.push(id);
    // Blank the matched span, keeping the surrounding spaces so an adjacent
    // term can still match on its own boundaries.
    haystack =
      haystack.slice(0, at + 1) + " ".repeat(term.length) + haystack.slice(at + 1 + term.length);
  }
  return found;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function similaritySeeds(
  g: AtlasGraph,
  question: string,
  limit: number,
  minScore: number,
): { id: string; score: number }[] {
  if (limit <= 0) return [];
  const { ids, vectors } = nodeIndex(g);
  const q = lexicalEmbed(question, LEXICAL_DIMS).vector;
  const scored: { id: string; score: number }[] = [];
  for (let i = 0; i < ids.length; i++) {
    const score = cosine(q, vectors[i]);
    if (score >= minScore) scored.push({ id: ids[i], score });
  }
  scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.id < b.id ? -1 : 1));
  return scored.slice(0, limit);
}

/**
 * Retrieve. Returns `null` when the question reaches nothing, which is the
 * signal for the caller to fall back to text retrieval rather than send an
 * empty block that reads as "Atlas knows nothing about this".
 */
export function retrieveGraph(
  g: AtlasGraph,
  question: string,
  opts: RetrieveOptions = {},
): GraphContext | null {
  if (g.nodes.size === 0 || !question.trim()) return null;

  const maxSeeds = opts.maxSeeds ?? DEFAULT_MAX_SEEDS;
  const via = new Map<string, SeedVia>();
  const weights = new Map<string, number>();

  for (const id of mentionSeeds(g, question, maxSeeds)) {
    via.set(id, "mention");
    weights.set(id, MENTION_WEIGHT);
  }

  // A named entity is decisive, so similarity only fills the remaining slots -
  // and far fewer of them once anything has been named.
  const slots =
    via.size > 0 ? Math.min(MENTION_SIMILARITY_SLOTS, maxSeeds - via.size) : maxSeeds - via.size;
  const similar = similaritySeeds(g, question, slots, opts.minSeedScore ?? DEFAULT_MIN_SEED_SCORE);
  const best = similar[0]?.score ?? 0;
  const floor = best * (opts.seedRatio ?? DEFAULT_SEED_RATIO);
  for (const { id, score } of similar) {
    if (score < floor) break;
    if (via.has(id)) continue;
    via.set(id, "similarity");
    weights.set(id, score);
  }

  const seeds = [...via.keys()];
  if (seeds.length === 0) return null;

  const expansion = expand(g, seeds, opts);
  const scores = rank(g, seeds, { within: expansion.depth.keys(), weights });

  const all: RetrievedNode[] = [];
  for (const [id, depth] of expansion.depth) {
    const node = g.nodes.get(id);
    if (!node) continue;
    all.push({ node, depth, score: scores.get(id) ?? 0, via: via.get(id) ?? "expansion" });
  }
  all.sort(compareRetrieved);

  const cited = all.slice(0, opts.maxCited ?? DEFAULT_MAX_CITED);
  const sources = cited.map((r) => toSource(r.node));
  const citedIds = new Set(cited.map((r) => r.node.id));
  const citedEdges = expansion.edges.filter((e) => citedIds.has(e.from) && citedIds.has(e.to));

  return {
    cited,
    sources,
    text: formatGraphContext(cited, citedEdges, {
      startIndex: opts.startIndex ?? 1,
      maxChars: opts.maxChars ?? DEFAULT_MAX_CHARS,
    }),
    scope: { nodes: all, edges: expansion.edges, truncated: expansion.truncated },
    seeds,
  };
}

/**
 * Rank order, with one deliberate override: a node the question *named* is never
 * ranked below one it merely resembles, whatever the walk decided. Being asked
 * about outranks being adjacent to something asked about.
 */
function compareRetrieved(a: RetrievedNode, b: RetrievedNode): number {
  const am = a.via === "mention" ? 1 : 0;
  const bm = b.via === "mention" ? 1 : 0;
  if (am !== bm) return bm - am;
  if (b.score !== a.score) return b.score - a.score;
  if (a.depth !== b.depth) return a.depth - b.depth;
  return a.node.id < b.node.id ? -1 : 1;
}

const KIND_LABELS: Record<string, string> = {
  model: "Model",
  brand: "Brand",
  family: "Family",
  provider: "Provider",
  benchmark: "Benchmark",
  capability: "Capability",
  modality: "Modality",
  license: "Licence",
  tag: "Tag",
  article: "News",
  cluster: "Story",
  topic: "Topic",
  org: "Organisation",
  conversation: "Chat",
  artifact: "Artifact",
  memory: "Memory",
  project_file: "Project file",
  skill: "Skill",
  connector: "Connector",
};

/**
 * Where a fact lives in Atlas.
 *
 * Real routes only. `/cost?model=` and `/news?t=` genuinely accept those
 * parameters today, so a citation is a link that works rather than a
 * plausible-looking dead end.
 */
export function hrefFor(n: GraphNode): string {
  switch (n.kind) {
    case "model":
      return `/cost?model=${encodeURIComponent(String(n.props.modelId ?? ""))}`;
    case "article":
      return typeof n.props.url === "string" ? n.props.url : "/news";
    case "cluster":
      return "/news";
    case "topic":
      return `/news?t=${encodeURIComponent(String(n.props.topic ?? ""))}`;
    case "provider":
      return "/router";
    case "conversation":
    case "artifact":
    case "memory":
    case "project_file":
    case "skill":
    case "connector":
      return "/chat";
    default:
      return "/leaderboard";
  }
}

function toSource(n: GraphNode): WebSource {
  return {
    title: `${KIND_LABELS[n.kind] ?? n.kind} - ${n.label}`,
    url: hrefFor(n),
    snippet: n.summary,
  };
}

export interface FormatOptions {
  startIndex?: number;
  maxChars?: number;
}

/**
 * Render the subgraph as a citeable block.
 *
 * Nodes first, then the relations *between the nodes just listed* - the edges
 * are the half a flat context cannot express, and they are what lets the model
 * answer a comparison instead of reciting two unrelated facts. Both halves use
 * the same marker numbers, so an answer can cite either.
 */
export function formatGraphContext(
  nodes: RetrievedNode[],
  edges: GraphEdge[],
  opts: FormatOptions = {},
): string {
  const start = opts.startIndex ?? 1;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const marker = new Map<string, number>();
  nodes.forEach((r, i) => marker.set(r.node.id, start + i));

  const lines: string[] = [
    "<atlas_graph>",
    "Facts from the Atlas catalog and news graph. Cite them with their [n] markers.",
    "",
  ];
  for (const r of nodes) {
    lines.push(
      `[${marker.get(r.node.id)}] ${KIND_LABELS[r.node.kind] ?? r.node.kind} - ${r.node.summary}`,
    );
  }

  if (edges.length) {
    lines.push("", "Relations:");
    for (const e of edges) {
      const from = marker.get(e.from);
      const to = marker.get(e.to);
      if (!from || !to) continue;
      lines.push(`[${from}] ${e.kind.replace(/_/g, " ")} [${to}]${describeProps(e)}`);
    }
  }
  lines.push("</atlas_graph>");

  const text = lines.join("\n");
  if (text.length <= maxChars) return text;
  // Truncating mid-block would leave a dangling marker the answer could cite,
  // so the cut is announced and the block closed properly.
  return `${text.slice(0, Math.max(0, maxChars - 60)).trimEnd()}\n(truncated)\n</atlas_graph>`;
}

function describeProps(e: GraphEdge): string {
  if (!e.props) return "";
  const parts: string[] = [];
  if (typeof e.props.score === "number") {
    parts.push(`score ${e.props.score}${e.props.unit === "%" ? "%" : ""}`);
  }
  if (typeof e.props.source === "string") parts.push(`source: ${e.props.source}`);
  if (typeof e.props.measuredAt === "string") parts.push(`measured ${e.props.measuredAt}`);
  if (typeof e.props.providerModel === "string") parts.push(`as ${e.props.providerModel}`);
  return parts.length ? ` - ${parts.join(", ")}` : "";
}
