import type { RouteEnv } from "@/lib/catalog/availability";
import type { AtlasGraph } from "@/lib/graph/types";
import { catalogToolSchema, runCatalogTool } from "./catalog-tool";
import { costToolSchema, runCostTool } from "./cost-tool";
import { graphToolSchema, runGraphTool } from "./graph-tool";
import { newsToolSchema, runNewsTool, type NewsCorpus } from "./news-tool";
import { openToolSchema, runOpenTool, type NavigatePort } from "./open-tool";
import { promptToolSchema, runPromptTool, type PromptPort } from "./prompt-tool";

/**
 * Atlas's own modules, as tools.
 *
 * These four are what makes the agent know *Atlas* rather than know about LLMs
 * in general: the catalog it ships, the graph over it, the cost arithmetic the
 * Cost page runs, and the news corpus with its provenance levels. Every one is a
 * pure function over data the browser already has, so they are free, instant,
 * work with no key and work offline - which is why `lib/tools/spec.ts` classes
 * them `read` and the approval gate lets them through.
 *
 * The ports below are the only seam. Nothing here reaches for a snapshot, a key
 * or the network by itself: a tool that fetched its own data would break the
 * offline guarantee for the whole registry and would be untestable without a
 * browser.
 */

export interface AtlasToolPorts {
  /** The assembled knowledge graph. Absent means the flag is off or it failed to build. */
  graph?: () => AtlasGraph | null;
  /** The news corpus. Chat does not hold one unless a caller attached it. */
  news?: () => NewsCorpus | null;
  /** Which providers the current user can reach, for `atlas_catalog availability`. */
  routeEnv?: RouteEnv;
  now?: () => number;
  /**
   * Take the person to a route. Absent means this surface cannot navigate -
   * `atlas_open` then answers with the destination instead of moving anyone,
   * which is the honest degradation for the MCP server and for tests.
   */
  navigate?: NavigatePort;
  /** The prompt library. Absent means this surface has none. */
  prompts?: PromptPort;
}

export interface AtlasToolResult {
  content: string;
  sources?: { title: string; url: string; snippet: string }[];
  isError?: boolean;
}

/**
 * A tool definition in the shape `lib/chat/tools.ts` already uses, so these
 * enter the existing registry as ordinary entries rather than as a second
 * mechanism beside it.
 */
export interface AtlasTool {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous schemas
  schema: any;
  run: (input: any, ports: AtlasToolPorts) => AtlasToolResult; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export const ATLAS_TOOLS: AtlasTool[] = [
  {
    name: "atlas_graph",
    description:
      "Walk the Atlas knowledge graph over models, brands, providers, benchmarks, prices and news. " +
      "Use it to answer questions about how things relate - which models share a benchmark, what a " +
      "brand makes, how two models are connected. Free, local and instant.",
    schema: graphToolSchema,
    run: (input, ports) => runGraphTool(ports.graph?.() ?? null, input),
  },
  {
    name: "atlas_catalog",
    description:
      "Look up models in the Atlas catalog: search by name or description, read full detail " +
      "including prices and benchmark scores with their sources, compare models, or check whether " +
      "the user can actually run one right now. Always prefer this over recalling a model's specs.",
    schema: catalogToolSchema,
    run: (input, ports) => runCatalogTool(input, { routeEnv: ports.routeEnv }),
  },
  {
    name: "atlas_cost",
    description:
      "Run the Atlas cost engine: monthly API cost for models at a workload, self-hosting cost, " +
      "and the volume where self-hosting becomes cheaper. Uses the same arithmetic as the Cost page.",
    schema: costToolSchema,
    run: (input) => runCostTool(input),
  },
  {
    name: "atlas_news",
    description:
      "Search Atlas News - recent AI news from ~37 first-party, research and press feeds, " +
      "de-duplicated across publishers and scored for provenance. Use it before saying anything " +
      "about recent releases; every result links to the original.",
    schema: newsToolSchema,
    run: (input, ports) => runNewsTool(input, ports.news?.() ?? null, ports.now?.()),
  },
  // The two that act. Both are classed `write` in `lib/tools/spec.ts`, so both
  // reach the person before they run - the read tools above never do.
  {
    name: "atlas_open",
    description:
      "Take the person to a part of Atlas, with the right state already set: Compare with " +
      "models selected, Cost on a model, the Leaderboard filtered to what they can run, the " +
      "Playground with a prompt in it, a news story open. Use it when the answer is a page " +
      "rather than a paragraph. Asks the person first.",
    schema: openToolSchema,
    run: (input, ports) => runOpenTool(input, ports.navigate),
  },
  {
    name: "atlas_prompt",
    description:
      "Read and write the Atlas prompt library: list what is saved, read one, or save a " +
      "prompt you worked out together so it survives the conversation. Saving an id that " +
      "already exists adds a version rather than overwriting. Asks the person first.",
    schema: promptToolSchema,
    run: (input, ports) => runPromptTool(input, ports.prompts),
  },
];

export const ATLAS_TOOL_NAMES = ATLAS_TOOLS.map((t) => t.name);

export function findAtlasTool(name: string): AtlasTool | undefined {
  return ATLAS_TOOLS.find((t) => t.name === name);
}

export type { NewsCorpus, NavigatePort, PromptPort };
