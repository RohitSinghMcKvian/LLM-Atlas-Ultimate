import { NextRequest } from "next/server";
import { z } from "zod";
import { BENCHMARKS } from "@/lib/catalog/benchmarks";
import { PROVIDER_LIST } from "@/lib/catalog/providers";
import { getCatalogSnapshot } from "@/lib/catalog/store";
import { buildCatalogGraph } from "@/lib/graph/build-catalog";
import { buildNewsGraph } from "@/lib/graph/build-news";
import { indexGraph, mergeDeltas } from "@/lib/graph/types";
import { getNewsSnapshot } from "@/lib/news/store";
import { takeToken, type TokenBucket } from "@/lib/news/snapshot";
import { ATLAS_TOOLS } from "@/lib/tools/atlas";
import {
  ERRORS,
  callParamsSchema,
  failure,
  initializeResult,
  isSupportedMethod,
  parseRequest,
  success,
  toolCallResult,
  toolsListResult,
  type ExposedTool,
} from "@/lib/mcp/server-protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Atlas, as an MCP server.
 *
 * Atlas has consumed MCP servers since P6 and exposed nothing. This is the other
 * direction: Claude Desktop, Claude Code or any MCP client can query the Atlas
 * catalog, its knowledge graph, its cost engine and its news corpus.
 *
 * ### What is deliberately not here
 *
 * Memory, projects, conversations, skills - anything belonging to a *user*. API
 * routes in this app do not authenticate and `middleware.ts` currently sets
 * `gatingEnabled = false`, so a user-scoped tool here would be readable by
 * anyone who found the URL. Everything served is derived from the public catalog
 * and news snapshots, which is why `buildCatalogGraph` was written isomorphic:
 * the same builder runs in the browser and here.
 *
 * Off unless an operator turns it on, twice over - the `mcpServer` flag and
 * `ATLAS_MCP_SERVER_ENABLED`. A route that appears the moment someone deploys is
 * a route nobody decided to expose.
 */

/** Requests per IP. Generous for a person, useless for a scraper. */
const BUCKET = { capacity: 30, refillMs: 60_000 };
const MAX_BODY_BYTES = 64 * 1024;

const bucketsKey = Symbol.for("atlas.mcp.serverBuckets");
function buckets(): Map<string, TokenBucket> {
  const host = globalThis as unknown as Record<symbol, Map<string, TokenBucket>>;
  return (host[bucketsKey] ??= new Map());
}

function enabled(): boolean {
  return process.env.ATLAS_MCP_SERVER_ENABLED === "1";
}

function exposedTools(): ExposedTool[] {
  return ATLAS_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    // The same Zod-to-JSON-Schema derivation `lib/chat/tools.ts` uses, so the
    // schema a client sees and the validator that runs cannot disagree.
    inputSchema: z.toJSONSchema(t.schema, { io: "input" }) as Record<string, unknown>,
  }));
}

/**
 * Build the graph server-side from the public snapshots.
 *
 * Rebuilt per request rather than cached in module scope: a serverless instance
 * is long-lived and a stale graph would outlive several catalog syncs. The build
 * is a pure pass over data already in memory.
 */
async function serverGraph() {
  const [catalog, news] = await Promise.all([getCatalogSnapshot(), getNewsSnapshot()]);
  const catalogDelta = buildCatalogGraph({
    models: catalog.models,
    benchmarks: BENCHMARKS,
    providers: PROVIDER_LIST,
  });
  const newsDelta = buildNewsGraph({
    articles: news.articles,
    clusters: news.clusters,
    knownBrands: catalogDelta.nodes.filter((n) => n.kind === "brand").map((n) => n.label),
  });
  return {
    graph: indexGraph(mergeDeltas(catalogDelta, newsDelta)),
    news: { articles: news.articles, clusters: news.clusters },
  };
}

export async function POST(req: NextRequest) {
  // 404, not 403: an endpoint nobody enabled should not advertise that it exists.
  if (!enabled()) return new Response("Not found", { status: 404 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const decision = takeToken(buckets(), ip, Date.now(), BUCKET);
  if (!decision.allowed) {
    return Response.json(failure(null, { code: ERRORS.internal, message: "Too many requests." }), {
      status: 429,
      headers: { "Retry-After": String(decision.retryAfterSeconds) },
    });
  }

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) {
    return Response.json(
      failure(null, { code: ERRORS.invalidRequest, message: "Request too large." }),
      { status: 413 },
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return Response.json(failure(null, { code: ERRORS.parse, message: "Invalid JSON." }));
  }

  const parsed = parseRequest(raw);
  if (!parsed.ok) return Response.json(failure(parsed.id, parsed.error));

  const { request, isNotification } = parsed;
  const id = request.id ?? null;

  // A notification gets no response at all. Answering one is a protocol
  // violation some clients treat as fatal.
  if (isNotification) return new Response(null, { status: 202 });

  if (!isSupportedMethod(request.method)) {
    return Response.json(
      failure(id, { code: ERRORS.methodNotFound, message: `Unknown method: ${request.method}` }),
    );
  }

  try {
    switch (request.method) {
      case "initialize":
        return Response.json(success(id, initializeResult()));
      case "ping":
        return Response.json(success(id, {}));
      case "tools/list":
        return Response.json(success(id, toolsListResult(exposedTools())));
      case "tools/call":
        return Response.json(await handleCall(id, request.params));
      default:
        return Response.json(
          failure(id, { code: ERRORS.methodNotFound, message: request.method }),
        );
    }
  } catch {
    // Never the exception's own message: it can carry a path or a snapshot
    // detail that is nobody's business on a public endpoint.
    return Response.json(failure(id, { code: ERRORS.internal, message: "Atlas failed to answer." }));
  }
}

async function handleCall(id: string | number | null, params: unknown) {
  const parsed = callParamsSchema.safeParse(params);
  if (!parsed.success) {
    return failure(id, { code: ERRORS.invalidParams, message: "Expected { name, arguments }." });
  }

  const tool = ATLAS_TOOLS.find((t) => t.name === parsed.data.name);
  if (!tool) {
    return failure(id, { code: ERRORS.invalidParams, message: `Unknown tool: ${parsed.data.name}` });
  }

  const args = tool.schema.safeParse(parsed.data.arguments ?? {});
  if (!args.success) {
    // A schema violation is a *tool* error, not a protocol error: the model that
    // wrote the arguments can fix them, and a protocol error would look to the
    // client like a broken server.
    return success(id, toolCallResult(`Invalid arguments: ${args.error.message}`, true));
  }

  const { graph, news } = await serverGraph();
  const result = tool.run(args.data, {
    graph: () => graph,
    news: () => news,
    // No `routeEnv`: which providers are configured is operator state, and
    // `atlas_catalog availability` correctly declines rather than guessing.
  });
  return success(id, toolCallResult(result.content, result.isError === true));
}

/** A GET is how a person checks the endpoint is alive. It exposes nothing else. */
export async function GET() {
  if (!enabled()) return new Response("Not found", { status: 404 });
  return Response.json({
    server: initializeResult().serverInfo,
    protocolVersion: initializeResult().protocolVersion,
    tools: exposedTools().map((t) => t.name),
    transport: "Streamable HTTP. POST JSON-RPC 2.0 to this URL.",
  });
}
