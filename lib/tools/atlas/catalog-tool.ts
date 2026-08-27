import { z } from "zod";
import { blendedPrice, getModelById, intelligenceIndex } from "@/lib/catalog";
import { searchModels } from "@/lib/catalog/search";
import { modelAvailability, type RouteEnv } from "@/lib/catalog/availability";
import { BENCHMARK_MAP } from "@/lib/catalog/benchmarks";
import type { CatalogModel } from "@/lib/catalog/types";

/**
 * The model catalog, as a tool.
 *
 * Thin over `lib/catalog/*` on purpose - every selector here is one the
 * leaderboard, the cost page and the model switcher already use, so the agent
 * and the UI cannot disagree about what the catalog says. Duplicating any of
 * this logic would be a second source of truth about prices.
 *
 * `availability` is the one command that is not a pure catalog read: it answers
 * "can *this user, right now* run it", which depends on which provider keys
 * exist. The environment is injected rather than read here, both so the tool
 * stays testable and because this module must not reach for a key.
 */

export const catalogToolSchema = z.object({
  command: z
    .enum(["search", "get", "compare", "availability"])
    .describe(
      "search: find models by name or description. get: full detail for one model. compare: several models side by side. availability: whether the user can run them right now.",
    ),
  search_query: z.string().max(200).optional().describe("For `search`."),
  model_ids: z
    .array(z.string().max(120))
    .max(8)
    .optional()
    .describe("Catalog model ids, for `get`, `compare` and `availability`."),
  max_results: z.number().int().min(1).max(20).default(8),
});

export type CatalogToolInput = z.output<typeof catalogToolSchema>;

export interface CatalogToolDeps {
  /** How the current user can reach providers. Absent means "cannot tell". */
  routeEnv?: RouteEnv;
}

export interface CatalogToolResult {
  content: string;
  isError?: boolean;
}

export function runCatalogTool(
  input: CatalogToolInput,
  deps: CatalogToolDeps = {},
): CatalogToolResult {
  switch (input.command) {
    case "search":
      return searchCommand(input);
    case "get":
      return getCommand(input);
    case "compare":
      return compareCommand(input);
    case "availability":
      return availabilityCommand(input, deps);
  }
}

function searchCommand(input: CatalogToolInput): CatalogToolResult {
  const q = input.search_query?.trim();
  if (!q) return { content: "`search` needs a search_query.", isError: true };
  const found = searchModels(q, { limit: input.max_results });
  if (found.length === 0) {
    return {
      content: `No catalog model matches "${q}". Do not name a model that is not in the catalog - say nothing matched.`,
    };
  }
  return { content: found.map(oneLine).join("\n") };
}

function getCommand(input: CatalogToolInput): CatalogToolResult {
  const ids = input.model_ids ?? [];
  if (ids.length === 0) return { content: "`get` needs at least one model id.", isError: true };
  const parts: string[] = [];
  for (const id of ids.slice(0, input.max_results)) {
    const m = getModelById(id);
    parts.push(m ? detail(m) : `${id}: not in the catalog.`);
  }
  return { content: parts.join("\n\n") };
}

function compareCommand(input: CatalogToolInput): CatalogToolResult {
  const ids = input.model_ids ?? [];
  if (ids.length < 2) return { content: "`compare` needs at least two model ids.", isError: true };

  const models = ids.map((id) => ({ id, model: getModelById(id) }));
  const missing = models.filter((m) => !m.model).map((m) => m.id);
  const found = models.map((m) => m.model).filter((m): m is CatalogModel => Boolean(m));
  if (found.length === 0) return { content: `None of these are in the catalog: ${ids.join(", ")}.` };

  // Benchmarks only the models actually share: a column where one side is blank
  // reads as a zero, and a comparison against an absent measurement is the
  // classic way to state something false with real numbers.
  const shared = found
    .map((m) => new Set(m.benchmarks.map((b) => b.key)))
    .reduce((acc, keys) => new Set([...acc].filter((k) => keys.has(k))));

  const lines = found.map((m) => {
    const scores = [...shared]
      .map((k) => `${BENCHMARK_MAP[k]?.label ?? k} ${m.benchmarks.find((b) => b.key === k)?.score}`)
      .join(", ");
    return `${m.name} (${m.id}): $${m.pricing.inputPerM}/M in, $${m.pricing.outputPerM}/M out, ${m.contextWindow} context, ${m.license}${scores ? ` - ${scores}` : ""}`;
  });

  if (shared.size === 0) {
    lines.push("These models share no benchmark, so their scores are not comparable.");
  }
  if (missing.length) lines.push(`Not in the catalog: ${missing.join(", ")}.`);
  return { content: lines.join("\n") };
}

function availabilityCommand(
  input: CatalogToolInput,
  deps: CatalogToolDeps,
): CatalogToolResult {
  const ids = input.model_ids ?? [];
  if (ids.length === 0) {
    return { content: "`availability` needs at least one model id.", isError: true };
  }
  if (!deps.routeEnv) {
    return {
      content:
        "Provider configuration is not visible from here, so availability cannot be answered. Say so rather than guessing which models the user can run.",
      isError: true,
    };
  }
  const lines = ids.slice(0, input.max_results).map((id) => {
    const m = getModelById(id);
    if (!m) return `${id}: not in the catalog.`;
    const a = modelAvailability(m, deps.routeEnv!);
    switch (a.kind) {
      case "free":
        return `${m.name}: free to run here (via ${a.route.provider}).`;
      case "your_key":
        return `${m.name}: runnable, billed to the key in use (via ${a.route.provider}).`;
      case "needs_key":
        return `${m.name}: needs a provider key before it can run.`;
      default:
        return `${m.name}: cannot be run here (${a.reason}).`;
    }
  });
  return { content: lines.join("\n") };
}

function oneLine(m: CatalogModel): string {
  return `${m.name} (${m.id}) - ${m.provider}, ${m.license}, $${blendedPrice(m).toFixed(2)}/M blended, ${m.contextWindow} context`;
}

function detail(m: CatalogModel): string {
  const caps = Object.entries(m.capabilities)
    .filter(([, on]) => on)
    .map(([k]) => k);
  const scores = m.benchmarks
    .map((b) => `${BENCHMARK_MAP[b.key]?.label ?? b.key} ${b.score} (${b.source}, ${b.measuredAt})`)
    .join("; ");
  const idx = intelligenceIndex(m);
  return [
    `${m.name} (${m.id})`,
    `Brand: ${m.provider} - Family: ${m.family} - Licence: ${m.license} - Status: ${m.status}`,
    `Context: ${m.contextWindow}, max output ${m.maxOutput}`,
    `Price: $${m.pricing.inputPerM}/M in, $${m.pricing.outputPerM}/M out (effective ${m.pricing.effectiveFrom})`,
    `Modalities in: ${m.modalities.join(", ")}${m.outputModalities ? ` - out: ${m.outputModalities.join(", ")}` : ""}`,
    caps.length ? `Capabilities: ${caps.join(", ")}` : "Capabilities: none declared",
    scores ? `Benchmarks: ${scores}` : "Benchmarks: none recorded",
    Number.isFinite(idx) ? `Atlas intelligence index: ${idx.toFixed(1)}` : "",
    m.routes.length
      ? `Routes: ${m.routes.map((r) => `${r.provider}/${r.model}`).join(", ")}`
      : "Routes: none - this model cannot be called",
    // Surfaced rather than hidden, following the catalog's own rule: a
    // heuristic context window must not be presented as a measurement.
    m.metaConfidence === "derived"
      ? "Note: this entry's metadata was reconstructed from the model id, not attested by the provider."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
