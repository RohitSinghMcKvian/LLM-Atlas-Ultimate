import type { AtlasGraph, EdgeKind, GraphEdge, GraphNode, NodeKind } from "./types";
import { emptyGraph } from "./types";

/**
 * Traversal over the Atlas graph.
 *
 * Pure, deterministic and budgeted. All three properties are load-bearing:
 *
 *  - **Pure** so `vitest` can reach it (`vitest.config.ts` only includes `lib/`).
 *  - **Deterministic** so the same question draws the same map. Adjacency lists
 *    are pre-sorted by `indexGraph`, every frontier is walked in that order, and
 *    the ranking is a fixed number of power iterations rather than a sampled
 *    walk. A map that reshuffles between renders cannot be read.
 *  - **Budgeted** because a two-hop expansion from a hub like `benchmark:mmlu`
 *    reaches most of the catalog. The budget is what keeps a retrieval block
 *    inside a context window.
 */

export interface NeighborOptions {
  /** Follow only these edge kinds. Omit for all. */
  kinds?: readonly EdgeKind[];
  /** `"out"` walks toward the general, `"in"` enumerates instances, `"both"` does both. */
  direction?: "out" | "in" | "both";
}

export function neighbors(g: AtlasGraph, id: string, opts: NeighborOptions = {}): GraphEdge[] {
  const dir = opts.direction ?? "both";
  const kinds = opts.kinds ? new Set<string>(opts.kinds) : null;
  const found: GraphEdge[] = [];
  if (dir === "out" || dir === "both") {
    for (const e of g.out.get(id) ?? []) if (!kinds || kinds.has(e.kind)) found.push(e);
  }
  if (dir === "in" || dir === "both") {
    for (const e of g.in.get(id) ?? []) if (!kinds || kinds.has(e.kind)) found.push(e);
  }
  return found;
}

/** The other end of an edge, relative to `id`. */
export function other(e: GraphEdge, id: string): string {
  return e.from === id ? e.to : e.from;
}

export interface ExpandOptions {
  hops?: number;
  /** Hard cap on nodes admitted, seeds included. */
  maxNodes?: number;
  kinds?: readonly EdgeKind[];
  /**
   * Skip expanding *through* a node with more than this many edges.
   *
   * Hubs are the reason naive graph-RAG returns everything. `benchmark:mmlu`
   * has an edge to every scored model, so admitting it as a seed is right and
   * walking onward from it is not — one hop through it drags in the whole
   * catalog and buries the three models the question was about. The hub is still
   * admitted and still cited; it just does not act as a bridge.
   */
  hubDegree?: number;
}

export interface Expansion {
  /** Node id → hops from the nearest seed. */
  depth: Map<string, number>;
  /** Edges whose endpoints are both admitted. */
  edges: GraphEdge[];
  /** True when the node budget stopped the walk early. */
  truncated: boolean;
}

export const DEFAULT_HOPS = 2;
export const DEFAULT_MAX_NODES = 120;
export const DEFAULT_HUB_DEGREE = 40;

export function expand(g: AtlasGraph, seeds: readonly string[], opts: ExpandOptions = {}): Expansion {
  const hops = opts.hops ?? DEFAULT_HOPS;
  const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;
  const hubDegree = opts.hubDegree ?? DEFAULT_HUB_DEGREE;

  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const s of seeds) {
    if (!g.nodes.has(s) || depth.has(s)) continue;
    depth.set(s, 0);
    queue.push(s);
  }

  let truncated = false;
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    const d = depth.get(id) ?? 0;
    if (d >= hops) continue;
    if (degree(g, id) > hubDegree && d > 0) continue;

    for (const e of neighbors(g, id, { kinds: opts.kinds })) {
      const next = other(e, id);
      if (depth.has(next)) continue;
      if (depth.size >= maxNodes) {
        truncated = true;
        break;
      }
      depth.set(next, d + 1);
      queue.push(next);
    }
    if (truncated) break;
  }

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const id of depth.keys()) {
    for (const e of g.out.get(id) ?? []) {
      if (!depth.has(e.to)) continue;
      const key = `${e.from}|${e.kind}|${e.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(e);
    }
  }

  return { depth, edges, truncated };
}

export function degree(g: AtlasGraph, id: string): number {
  return (g.out.get(id)?.length ?? 0) + (g.in.get(id)?.length ?? 0);
}

export interface RankOptions {
  /**
   * Restart probability. Higher keeps mass near the seeds; lower explores.
   * 0.15 is the conventional PageRank damping and behaves well here.
   */
  restart?: number;
  iterations?: number;
  /**
   * How much of an edge's weight survives being walked backwards.
   *
   * A model→benchmark edge read forwards is "this model scores on MMLU"; read
   * backwards it is "MMLU has 400 models", which is true and almost never what
   * was asked. Damping the reverse direction is what stops every ranking from
   * being dominated by whatever hub the seeds happen to touch.
   */
  reverseDamping?: number;
  /** Restrict the walk to these nodes. Pass an expansion's `depth` keys. */
  within?: Iterable<string>;
  /**
   * How strongly each seed was matched. Normalised internally; missing seeds
   * default to 1.
   *
   * This is not a refinement, it is the difference between working and not.
   * With uniform seed mass, a question whose best match scored 0.51 was
   * outranked by three brand nodes that scored 0.15, purely because brands sit
   * in a denser neighbourhood - the walk had no way to know which seed the
   * question was actually about. The personalisation vector is exactly where
   * match confidence belongs.
   */
  weights?: ReadonlyMap<string, number>;
}

/**
 * Deliberately far above PageRank's conventional 0.15.
 *
 * That number is tuned for "important on the whole web", and this is the
 * opposite problem: locality. At 0.15 a seed with one strong edge hands most of
 * its mass away in the first step and a shared benchmark ends up outranking the
 * model the question actually named — measured, not assumed; see
 * `query.test.ts`. 0.35 keeps the answer anchored to what was asked while still
 * letting two hops of context through.
 */
export const DEFAULT_RESTART = 0.35;
export const DEFAULT_ITERATIONS = 24;
export const DEFAULT_REVERSE_DAMPING = 0.45;

/**
 * Discount mass flowing *into* a node by how connected it is.
 *
 * Reverse damping stops a hub from pushing mass back out; this stops it from
 * hoarding mass in the first place. Logarithmic rather than linear because the
 * penalty should separate "a benchmark every model scores on" from "a family
 * with three members" without erasing the hub entirely — it is still real
 * evidence and still gets cited, it just stops being the answer.
 */
export function hubPenalty(deg: number): number {
  return 1 / Math.log2(2 + deg);
}

/**
 * Personalised PageRank (random walk with restart), run as deterministic power
 * iteration rather than a sampled walk — same reason as everything else here.
 *
 * Seeds start with all the mass, and it flows outward along edge weights,
 * pulled back to the seeds by `restart` on every step. What comes out is "how
 * much does this node have to do with what was asked", which is exactly the
 * ordering a citation block wants.
 */
export function rank(
  g: AtlasGraph,
  seeds: readonly string[],
  opts: RankOptions = {},
): Map<string, number> {
  const restart = opts.restart ?? DEFAULT_RESTART;
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
  const reverse = opts.reverseDamping ?? DEFAULT_REVERSE_DAMPING;

  const universe = opts.within ? [...opts.within].filter((id) => g.nodes.has(id)) : [...g.nodes.keys()];
  const inUniverse = new Set(universe);
  const live = seeds.filter((s) => inUniverse.has(s));
  const scores = new Map<string, number>();
  if (universe.length === 0 || live.length === 0) return scores;

  // Transition weights, precomputed once. Each entry is already normalised so a
  // node's outgoing mass sums to 1 — which is what stops a high-degree node
  // from amplifying rather than dividing the mass it receives.
  const transitions = new Map<string, { to: string; p: number }[]>();
  for (const id of universe) {
    const raw: { to: string; p: number }[] = [];
    for (const e of g.out.get(id) ?? []) {
      if (inUniverse.has(e.to)) raw.push({ to: e.to, p: e.weight * hubPenalty(degree(g, e.to)) });
    }
    for (const e of g.in.get(id) ?? []) {
      if (inUniverse.has(e.from)) {
        raw.push({ to: e.from, p: e.weight * reverse * hubPenalty(degree(g, e.from)) });
      }
    }
    const total = raw.reduce((s, r) => s + r.p, 0);
    transitions.set(
      id,
      total > 0 ? raw.map((r) => ({ to: r.to, p: r.p / total })) : [],
    );
  }

  const personal = new Map<string, number>();
  let totalSeedWeight = 0;
  for (const s of live) {
    const w = Math.max(0, opts.weights?.get(s) ?? 1);
    if (w > 0) {
      personal.set(s, (personal.get(s) ?? 0) + w);
      totalSeedWeight += w;
    }
  }
  if (totalSeedWeight === 0) {
    // Every seed was given zero weight. Fall back to uniform rather than
    // returning nothing: the caller asked about these nodes either way.
    for (const s of live) personal.set(s, 1 / live.length);
  } else {
    for (const [s, w] of personal) personal.set(s, w / totalSeedWeight);
  }

  let current = new Map<string, number>(personal);
  for (let i = 0; i < iterations; i++) {
    const next = new Map<string, number>();
    let dangling = 0;
    for (const [id, mass] of current) {
      if (mass === 0) continue;
      const edges = transitions.get(id);
      if (!edges || edges.length === 0) {
        dangling += mass;
        continue;
      }
      for (const { to, p } of edges) {
        next.set(to, (next.get(to) ?? 0) + mass * p * (1 - restart));
      }
      // The restart share goes home to the seeds, not uniformly across the
      // graph: that is the difference between "related to this question" and
      // "important in general".
      for (const [s, w] of personal) {
        next.set(s, (next.get(s) ?? 0) + mass * restart * w);
      }
    }
    if (dangling > 0) {
      for (const [s, w] of personal) {
        next.set(s, (next.get(s) ?? 0) + dangling * w);
      }
    }
    current = next;
  }

  for (const [id, v] of current) if (v > 0) scores.set(id, v);
  return scores;
}

/** Shortest paths between two nodes, up to `maxHops`, breadth-first. */
export function paths(
  g: AtlasGraph,
  from: string,
  to: string,
  maxHops = 3,
  maxPaths = 4,
): GraphEdge[][] {
  if (!g.nodes.has(from) || !g.nodes.has(to) || from === to) return [];
  const found: GraphEdge[][] = [];
  let frontier: { id: string; trail: GraphEdge[] }[] = [{ id: from, trail: [] }];
  const visited = new Set<string>([from]);

  for (let hop = 0; hop < maxHops && frontier.length > 0 && found.length < maxPaths; hop++) {
    const next: { id: string; trail: GraphEdge[] }[] = [];
    const reachedThisHop = new Set<string>();
    for (const { id, trail } of frontier) {
      for (const e of neighbors(g, id)) {
        const n = other(e, id);
        if (n === to) {
          found.push([...trail, e]);
          if (found.length >= maxPaths) return found;
          continue;
        }
        if (visited.has(n) || reachedThisHop.has(n)) continue;
        reachedThisHop.add(n);
        next.push({ id: n, trail: [...trail, e] });
      }
    }
    for (const n of reachedThisHop) visited.add(n);
    frontier = next;
  }
  return found;
}

/** A standalone graph over `ids`, keeping every edge whose endpoints are both in. */
export function subgraph(g: AtlasGraph, ids: Iterable<string>): AtlasGraph {
  const keep = new Set<string>();
  for (const id of ids) if (g.nodes.has(id)) keep.add(id);
  const sub = emptyGraph();
  for (const id of keep) sub.nodes.set(id, g.nodes.get(id)!);
  for (const id of keep) {
    const outs = (g.out.get(id) ?? []).filter((e) => keep.has(e.to));
    if (outs.length) sub.out.set(id, outs);
    const ins = (g.in.get(id) ?? []).filter((e) => keep.has(e.from));
    if (ins.length) sub.in.set(id, ins);
    sub.edgeCount += outs.length;
  }
  return sub;
}

export function nodesOfKind(g: AtlasGraph, kind: NodeKind): GraphNode[] {
  const found: GraphNode[] = [];
  for (const n of g.nodes.values()) if (n.kind === kind) found.push(n);
  found.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return found;
}
