import { z } from "zod";
import { neighbors, other, paths, rank } from "@/lib/graph/query";
import { hrefFor, retrieveGraph } from "@/lib/graph/retrieve";
import type { AtlasGraph, GraphEdge } from "@/lib/graph/types";

/**
 * The graph, as a tool the model can steer.
 *
 * Retrieval already puts a subgraph in front of the model before it says
 * anything, which covers the common case. This is for the cases retrieval
 * cannot anticipate: the model has read the block, worked out what it actually
 * needs, and wants to walk one more edge. "Which other models score on this
 * benchmark", "how are these two related", "what does this brand make".
 *
 * Pure over data already in the browser, so it is free, offline and instant.
 * That is why it is a `read` in `lib/tools/spec.ts` and runs without a prompt.
 */

export const graphToolSchema = z.object({
  command: z
    .enum(["query", "neighbors", "path", "explain"])
    .describe(
      "query: find nodes matching a question. neighbors: what one node connects to. path: how two nodes relate. explain: everything known about one node.",
    ),
  /** `query` */
  search_query: z.string().max(400).optional().describe("For `query`: what to look for."),
  /** `neighbors`, `explain`, and the start of `path` */
  node_id: z
    .string()
    .max(200)
    .optional()
    .describe("Node id, e.g. `model:llama-3-70b`. Ids appear in the [n] markers of the graph block."),
  /** `path` */
  to_node_id: z.string().max(200).optional().describe("For `path`: the other end."),
  edge_kind: z
    .string()
    .max(40)
    .optional()
    .describe("For `neighbors`: restrict to one relation, e.g. `scored_on`."),
  max_results: z.number().int().min(1).max(30).default(12),
});

export type GraphToolInput = z.output<typeof graphToolSchema>;

export interface GraphToolResult {
  content: string;
  isError?: boolean;
}

const NO_GRAPH =
  "The Atlas graph is not available in this session. Answer from the catalog tools or from what you already know, and say the graph was unavailable.";

export function runGraphTool(g: AtlasGraph | null, input: GraphToolInput): GraphToolResult {
  if (!g || g.nodes.size === 0) return { content: NO_GRAPH, isError: true };

  switch (input.command) {
    case "query":
      return queryCommand(g, input);
    case "neighbors":
      return neighborsCommand(g, input);
    case "path":
      return pathCommand(g, input);
    case "explain":
      return explainCommand(g, input);
  }
}

function queryCommand(g: AtlasGraph, input: GraphToolInput): GraphToolResult {
  if (!input.search_query?.trim()) {
    return { content: "`query` needs a search_query.", isError: true };
  }
  const ctx = retrieveGraph(g, input.search_query, { maxCited: input.max_results });
  if (!ctx) {
    return {
      content: `Nothing in the Atlas graph matches "${input.search_query}". Do not guess an answer from it.`,
    };
  }
  return { content: ctx.text };
}

function neighborsCommand(g: AtlasGraph, input: GraphToolInput): GraphToolResult {
  const node = resolve(g, input.node_id);
  if (!node) return unknownNode(g, input.node_id);

  const kinds = input.edge_kind ? ([input.edge_kind] as unknown as GraphEdge["kind"][]) : undefined;
  const found = neighbors(g, node, { kinds });
  if (found.length === 0) {
    return { content: `${label(g, node)} has no ${input.edge_kind ?? ""} relations.`.trim() };
  }

  const lines = found.slice(0, input.max_results).map((e) => {
    const far = other(e, node);
    return `- ${e.kind.replace(/_/g, " ")} -> ${label(g, far)} (${far})${props(e)}`;
  });
  const more = found.length > input.max_results ? `\n(${found.length - input.max_results} more)` : "";
  return { content: `${label(g, node)} (${node}):\n${lines.join("\n")}${more}` };
}

function pathCommand(g: AtlasGraph, input: GraphToolInput): GraphToolResult {
  const from = resolve(g, input.node_id);
  const to = resolve(g, input.to_node_id);
  if (!from) return unknownNode(g, input.node_id);
  if (!to) return unknownNode(g, input.to_node_id);

  const found = paths(g, from, to, 3);
  if (found.length === 0) {
    // A real answer, not a failure: "these are unrelated" is information, and
    // saying so stops the model inventing a connection to fill the silence.
    return {
      content: `No relation within 3 hops between ${label(g, from)} and ${label(g, to)}. They are not connected in the Atlas graph.`,
    };
  }
  const lines = found.map((trail) => {
    let cursor = from;
    const steps = trail.map((e) => {
      const far = other(e, cursor);
      const step = `${e.kind.replace(/_/g, " ")} -> ${label(g, far)}`;
      cursor = far;
      return step;
    });
    return `- ${label(g, from)} ${steps.join(" ")}`;
  });
  return { content: lines.join("\n") };
}

function explainCommand(g: AtlasGraph, input: GraphToolInput): GraphToolResult {
  const node = resolve(g, input.node_id);
  if (!node) return unknownNode(g, input.node_id);
  const n = g.nodes.get(node)!;

  const lines = [`${n.label} (${n.id})`, n.summary, ""];
  const propEntries = Object.entries(n.props);
  if (propEntries.length) {
    lines.push("Facts:");
    for (const [k, v] of propEntries) lines.push(`- ${k}: ${v}`);
    lines.push("");
  }
  // Rank the neighbourhood rather than printing it: a model node touches a
  // brand, a family, several benchmarks and a handful of tags, and the tags are
  // never the interesting half.
  const scores = rank(g, [n.id], { within: neighborhood(g, n.id) });
  const near = [...scores.entries()]
    .filter(([id]) => id !== n.id)
    .sort((a, b) => b[1] - a[1])
    .slice(0, input.max_results);
  if (near.length) {
    lines.push("Most related:");
    for (const [id] of near) lines.push(`- ${label(g, id)} (${id})`);
  }
  lines.push("", `In Atlas: ${hrefFor(n)}`);
  return { content: lines.join("\n") };
}

function neighborhood(g: AtlasGraph, id: string): string[] {
  const ids = new Set<string>([id]);
  for (const e of neighbors(g, id)) ids.add(other(e, id));
  return [...ids];
}

/**
 * Accept a node id, or a plain name.
 *
 * The model sees ids in the graph block but will still sometimes pass "Summit
 * Pro". Refusing that would cost a round to teach it something the tool can
 * simply handle.
 */
function resolve(g: AtlasGraph, raw?: string): string | null {
  const id = raw?.trim();
  if (!id) return null;
  if (g.nodes.has(id)) return id;
  const wanted = id.toLowerCase();
  for (const n of g.nodes.values()) {
    if (n.label.toLowerCase() === wanted) return n.id;
  }
  return null;
}

function unknownNode(g: AtlasGraph, raw?: string): GraphToolResult {
  if (!raw?.trim()) return { content: "This command needs a node_id.", isError: true };
  return {
    content: `No node called "${raw}". Use \`query\` to find one, and use the id exactly as it appears there.`,
    isError: true,
  };
}

function label(g: AtlasGraph, id: string): string {
  return g.nodes.get(id)?.label ?? id;
}

function props(e: GraphEdge): string {
  if (!e.props) return "";
  const parts: string[] = [];
  if (typeof e.props.score === "number") {
    parts.push(`score ${e.props.score}${e.props.unit === "%" ? "%" : ""}`);
  }
  if (typeof e.props.providerModel === "string") parts.push(`as ${e.props.providerModel}`);
  return parts.length ? ` - ${parts.join(", ")}` : "";
}
