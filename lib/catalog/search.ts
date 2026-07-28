import { modelAvailability, type RouteEnv } from "./availability";
import { byokModels, freeModels, getModelById, intelligenceIndex, routableModels } from "./index";
import type { CatalogModel, ProviderId } from "./types";

// Scored model search for the pickers.
//
// The model switcher and the ⌘K palette both used to mount every model as a cmdk
// item and let cmdk filter them in JS on each keystroke. At ~100 models that was
// merely wasteful; at ~400 across ~60 brands it is both slow and — more to the
// point — unusable as an interface. Nobody browses 400 grouped rows.
//
// So: an empty query shows a short, useful list, and typing runs this scorer and
// renders only the top matches. Per-keystroke work drops from re-filtering
// hundreds of DOM nodes to a few hundred string comparisons over a capped list.

/** Maximum rows a picker renders for a query. */
export const SEARCH_LIMIT = 40;

/** Rows shown before the user types anything. */
export const SHORTLIST_LIMIT = 18;

const enum Score {
  ExactId = 1000,
  ExactName = 900,
  NamePrefix = 700,
  WordPrefix = 500,
  NameSubstring = 350,
  ProviderPrefix = 220,
  FamilyOrTag = 140,
  IdSubstring = 100,
}

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

/**
 * Relevance of one model to one query, or 0 for no match.
 *
 * Intelligence is folded in as a small tiebreaker so that among equally-relevant
 * matches ("gpt") the stronger model sorts first.
 */
export function scoreModel(model: CatalogModel, query: string): number {
  const q = normalize(query);
  if (!q) return 0;

  const name = normalize(model.name);
  const id = normalize(model.id);
  const provider = normalize(model.provider);
  const family = normalize(model.family);

  let score = 0;
  if (id === q) score = Score.ExactId;
  else if (name === q) score = Score.ExactName;
  else if (name.startsWith(q)) score = Score.NamePrefix;
  else if (name.split(/[\s-]+/).some((w) => w.startsWith(q))) score = Score.WordPrefix;
  else if (name.includes(q)) score = Score.NameSubstring;
  else if (provider.startsWith(q)) score = Score.ProviderPrefix;
  else if (family.includes(q) || model.tags?.some((t) => normalize(t).startsWith(q)))
    score = Score.FamilyOrTag;
  else if (id.includes(q) || provider.includes(q)) score = Score.IdSubstring;
  else return 0;

  return score + Math.min(intelligenceIndex(model), 100) / 1000;
}

export interface SearchOptions {
  limit?: number;
  /** Restrict to models that can run tools (the agent and flow pickers). */
  toolsOnly?: boolean;
}

/** Models matching `query`, best first. */
export function searchModels(query: string, options: SearchOptions = {}): CatalogModel[] {
  const { limit = SEARCH_LIMIT, toolsOnly = false } = options;
  const q = normalize(query);
  if (!q) return [];

  const scored: { model: CatalogModel; score: number }[] = [];
  for (const model of routableModels()) {
    if (toolsOnly && !model.capabilities.toolUse) continue;
    const score = scoreModel(model, q);
    if (score > 0) scored.push({ model, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.model);
}

function topBy(list: readonly CatalogModel[], count: number): CatalogModel[] {
  // Copy first: selector results are shared and frozen in development.
  return [...list].sort((a, b) => intelligenceIndex(b) - intelligenceIndex(a)).slice(0, count);
}

export interface Shortlist {
  recent: CatalogModel[];
  free: CatalogModel[];
  frontier: CatalogModel[];
  /** Total routable models, for the "search all N" affordance. */
  total: number;
}

/**
 * What a picker shows before the user types: their recent picks, then the
 * strongest free and frontier models. Short by design — the full catalog is one
 * keystroke away, and browsable in full on the leaderboard.
 */
export function modelShortlist(recentIds: readonly string[] = []): Shortlist {
  const recent: CatalogModel[] = [];
  const seen = new Set<string>();
  for (const id of recentIds) {
    const model = getModelById(id);
    if (model && !seen.has(model.id)) {
      seen.add(model.id);
      recent.push(model);
    }
    if (recent.length >= 5) break;
  }

  const slots = Math.max(4, Math.floor((SHORTLIST_LIMIT - recent.length) / 2));
  const free = topBy(freeModels(), slots + recent.length).filter((m) => !seen.has(m.id)).slice(0, slots);
  for (const m of free) seen.add(m.id);
  const frontier = topBy(byokModels(), slots + seen.size).filter((m) => !seen.has(m.id)).slice(0, slots);

  return { recent, free, frontier, total: routableModels().length };
}

// --- The full-catalog browser ---
//
// The shortlist above answers "what should I offer before the user types". This
// section answers "let me see everything", which is what the picker was missing:
// with 339 models and an 18-row cap there was no way to reach the other 321.

/** Which availability tier a row belongs to, from the user's point of view. */
export type AccessTab = "free" | "your_key";

export interface BrowseFilters {
  query?: string;
  tab?: AccessTab;
  /** Restrict to models with a route on this provider. */
  provider?: ProviderId | "all";
  /** Capability requirements, all of which must hold. */
  tools?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  /** Minimum context window in tokens. */
  minContext?: number;
}

export interface BrowseRow {
  model: CatalogModel;
  /** Free right now, needs the user's key, or not runnable here at all. */
  availability: ReturnType<typeof modelAvailability>;
}

export interface BrowseResult {
  rows: BrowseRow[];
  /** Counts across the whole catalog under this `env`, ignoring the tab filter. */
  counts: { free: number; your_key: number; unavailable: number };
}

/**
 * Every model, tiered by what the current environment can actually run.
 *
 * Uncapped by design — the caller reveals it in chunks via
 * `lib/hooks/use-infinite-reveal.ts`. Sorted by intelligence so the useful models
 * are in the first chunk.
 */
export function browseModels(env: RouteEnv, filters: BrowseFilters = {}): BrowseResult {
  const { query = "", tab, provider = "all", tools, vision, reasoning, minContext } = filters;
  const q = normalize(query);

  const counts = { free: 0, your_key: 0, unavailable: 0 };
  const rows: BrowseRow[] = [];

  for (const model of routableModels()) {
    const availability = modelAvailability(model, env);
    const bucket =
      availability.kind === "free"
        ? "free"
        : availability.kind === "your_key" || availability.kind === "needs_key"
          ? "your_key"
          : "unavailable";
    counts[bucket] += 1;

    if (tab && bucket !== tab) continue;
    if (provider !== "all" && !model.routes.some((r) => r.provider === provider)) continue;
    if (tools && !model.capabilities.toolUse) continue;
    if (vision && !model.modalities.includes("vision")) continue;
    if (reasoning && !model.capabilities.reasoning) continue;
    if (minContext && model.contextWindow < minContext) continue;
    if (q && scoreModel(model, q) === 0) continue;

    rows.push({ model, availability });
  }

  rows.sort((a, b) => {
    if (q) {
      const d = scoreModel(b.model, q) - scoreModel(a.model, q);
      if (d !== 0) return d;
    }
    return intelligenceIndex(b.model) - intelligenceIndex(a.model);
  });

  return { rows, counts };
}

/**
 * The shortlist, but tiered by what this environment can run.
 *
 * The env-free `modelShortlist` uses `intrinsicAccess`, which answers "could this
 * ever be free" — right for a catalog filter, wrong for a picker, because it will
 * put a Groq-only model in the Free group on a deploy with no Groq key. Once the
 * provider list has loaded, pickers should use this instead.
 */
export function modelShortlistFor(
  env: RouteEnv,
  recentIds: readonly string[] = [],
): Shortlist {
  const recent: CatalogModel[] = [];
  const seen = new Set<string>();
  for (const id of recentIds) {
    const model = getModelById(id);
    if (model && !seen.has(model.id)) {
      seen.add(model.id);
      recent.push(model);
    }
    if (recent.length >= 5) break;
  }

  const runnableFree: CatalogModel[] = [];
  const runnablePaid: CatalogModel[] = [];
  for (const m of routableModels()) {
    const a = modelAvailability(m, env);
    if (a.kind === "free") runnableFree.push(m);
    else if (a.kind === "your_key" || a.kind === "needs_key") runnablePaid.push(m);
  }

  const slots = Math.max(4, Math.floor((SHORTLIST_LIMIT - recent.length) / 2));
  const free = topBy(runnableFree, slots + recent.length)
    .filter((m) => !seen.has(m.id))
    .slice(0, slots);
  for (const m of free) seen.add(m.id);
  const frontier = topBy(runnablePaid, slots + seen.size)
    .filter((m) => !seen.has(m.id))
    .slice(0, slots);

  return { recent, free, frontier, total: routableModels().length };
}
