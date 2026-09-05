import { getModelById, intelligenceIndex, isNewModel } from "./index";
import { isSelectable } from "./stats";
import { modelAvailability, type RouteEnv } from "./availability";
import { browseModels, scoreModel, SEARCH_LIMIT, type BrowseRow } from "./search";
import type { CatalogModel } from "./types";

// The shape every model picker in Atlas renders.
//
// Selection had drifted into six implementations. The topbar switcher and the
// command palette shared a tiered shortlist; Compare's lane picker grouped by
// availability; Playground, Bench, Cost and Flow each mounted a flat list of
// every routable model, so a row that would answer 402 the moment you ran it
// looked exactly like one that would work. This is the single answer to "what
// should a picker show", so a fix lands everywhere at once.
//
// The ordering is a product decision, not an implementation detail:
//
//   1. **Free first, always, flat.** Models the operator's keys serve at no cost
//      are what most people should pick, so they are never behind a disclosure.
//   2. **Then BYOK, grouped by brand.** Once you are past free you are shopping
//      for a specific model — "the new Claude", "whatever OpenAI's best is" —
//      and brand is how people navigate that. Groups collapse, so the section
//      stays short without hiding anything.
//   3. **Nothing else.** Models no configured provider can serve, and models the
//      sync has retired, are absent — reachable only through `<ModelBrowser />`,
//      which is explicitly a catalogue rather than a chooser.
//
// Every verdict comes from `modelAvailability` via `browseModels`, the same
// function the server's failover loop routes on. That is the point: a picker
// that says "Free" and a server that then answers 402 is the failure this whole
// design exists to make impossible.

/** Free rows shown before the user types. Enough to choose from, short enough to scan. */
export const FREE_LIMIT = 12;

/** Brand groups shown before the user types. */
export const BRAND_LIMIT = 8;

/** Models shown inside one brand group. */
export const PER_BRAND_LIMIT = 6;

/** Recent picks carried at the top. */
export const RECENT_LIMIT = 5;

/** Brand groups expanded by default — enough to show the section is populated. */
export const OPEN_BRAND_COUNT = 2;

export interface BrandGroup {
  /** The brand / family owner, e.g. "Anthropic". */
  brand: string;
  models: BrowseRow[];
  /** Models in this brand beyond `models`, reachable in the full browser. */
  more: number;
}

export interface PickerCapabilities {
  tools?: boolean;
  vision?: boolean;
  reasoning?: boolean;
}

export interface PickerOptions {
  query?: string;
  recentIds?: readonly string[];
  /** Capability requirements, all of which must hold. */
  require?: PickerCapabilities;
  /** Ids to omit — what a multi-select picker has already chosen. */
  exclude?: readonly string[];
}

export interface PickerSections {
  recent: BrowseRow[];
  /** Runnable at no cost right now. Flat, strongest first. */
  free: BrowseRow[];
  /** Everything billed to a key, grouped by brand. */
  byok: BrandGroup[];
  /** Free rows beyond `free`, reachable in the full browser. */
  freeMore: number;
  counts: {
    /**
     * Models in each tier that this picker would offer — after `require` and
     * `exclude`, before the display caps.
     *
     * Deliberately not the catalog-wide numbers `browseModels` returns. A
     * picker narrowed to tool-capable models that headed its Free section "28"
     * and then listed 27 rows is a small lie, and small lies about the model
     * list are the whole class of bug this module exists to remove.
     */
    free: number;
    byok: number;
    /** Every routable model, for the "browse all N" affordance — which is unfiltered. */
    total: number;
    /** How many of the rows actually shown are new enough to badge. */
    new: number;
  };
}

const EMPTY: PickerSections = {
  recent: [],
  free: [],
  byok: [],
  freeMore: 0,
  counts: { free: 0, byok: 0, total: 0, new: 0 },
};

function meetsRequirements(m: CatalogModel, require: PickerCapabilities): boolean {
  if (require.tools && !m.capabilities.toolUse) return false;
  if (require.vision && !m.modalities.includes("vision")) return false;
  if (require.reasoning && !m.capabilities.reasoning) return false;
  return true;
}

/**
 * What a picker shows, for one environment and one query.
 *
 * Returns empty sections for a null `env` rather than guessing: until
 * `/api/v1/providers` answers we do not know which providers are keyed, and a
 * Free badge that later turns out to be wrong is worse than a moment of
 * nothing. Callers render a loading state for that case.
 */
export function pickerSections(
  env: RouteEnv | null,
  options: PickerOptions = {},
): PickerSections {
  if (!env) return EMPTY;

  const { query = "", recentIds = [], require = {}, exclude = [] } = options;
  const q = query.trim();
  const searching = q.length > 0;

  // `browseModels` filters to `routableModels()`, which excludes both
  // `deprecated` and `upcoming` — so a model the sync retired cannot reach a
  // picker through this path at all.
  const { rows, counts } = browseModels(env, {
    query: q,
    tools: require.tools,
    vision: require.vision,
    reasoning: require.reasoning,
  });

  const seen = new Set(exclude);

  const recent: BrowseRow[] = [];
  if (!searching) {
    const byId = new Map(rows.map((r) => [r.model.id, r]));
    for (const id of recentIds) {
      if (recent.length >= RECENT_LIMIT) break;
      if (seen.has(id)) continue;
      const row = byId.get(id);
      // Absent from `rows` means retired, unrunnable here, or excluded by
      // `require` — in every case it must not be offered as a recent pick.
      if (!row) continue;
      seen.add(id);
      recent.push(row);
    }
  }

  const freeAll: BrowseRow[] = [];
  const byokAll: BrowseRow[] = [];
  for (const row of rows) {
    if (seen.has(row.model.id)) continue;
    const { kind } = row.availability;
    if (kind === "free") freeAll.push(row);
    else if (kind === "your_key" || kind === "needs_key") byokAll.push(row);
    // `unavailable` is dropped: no configured provider can serve it, so
    // offering it would be offering a guaranteed failure.
  }

  // A search is a request for specific models, so it widens the caps and lets
  // relevance — which `browseModels` already sorted by — decide the order.
  const free = freeAll.slice(0, searching ? SEARCH_LIMIT : FREE_LIMIT);
  const byok = groupByBrand(byokAll, searching, q);

  let fresh = 0;
  for (const row of recent) if (isNewModel(row.model)) fresh++;
  for (const row of free) if (isNewModel(row.model)) fresh++;
  for (const group of byok) for (const row of group.models) if (isNewModel(row.model)) fresh++;

  return {
    recent,
    free,
    byok,
    freeMore: Math.max(0, freeAll.length - free.length),
    counts: {
      free: freeAll.length,
      byok: byokAll.length,
      total: counts.free + counts.your_key + counts.unavailable,
      new: fresh,
    },
  };
}

/**
 * Brand groups, strongest brand first.
 *
 * "Strongest" is the brand's best model, not its model count — otherwise a
 * vendor with forty mid-tier variants outranks Anthropic and the group you
 * actually wanted sits three scrolls down. Under a query the same rule runs on
 * relevance instead, so typing "claude" puts Anthropic on top even though it is
 * not the highest-scoring brand overall.
 */
function groupByBrand(
  rows: readonly BrowseRow[],
  searching: boolean,
  query: string,
): BrandGroup[] {
  const buckets = new Map<string, BrowseRow[]>();
  for (const row of rows) {
    const bucket = buckets.get(row.model.provider);
    if (bucket) bucket.push(row);
    else buckets.set(row.model.provider, [row]);
  }

  const rank = (m: CatalogModel) => (searching ? scoreModel(m, query) : intelligenceIndex(m));
  const perBrand = searching ? SEARCH_LIMIT : PER_BRAND_LIMIT;
  const brandCap = searching ? buckets.size : BRAND_LIMIT;

  return Array.from(buckets.entries())
    .map(([brand, list]) => ({
      brand,
      models: list.slice(0, perBrand),
      more: Math.max(0, list.length - perBrand),
      best: list.reduce((best, r) => Math.max(best, rank(r.model)), 0),
    }))
    .sort((a, b) => b.best - a.best || a.brand.localeCompare(b.brand))
    .slice(0, brandCap)
    .map(({ brand, models, more }) => ({ brand, models, more }));
}

/**
 * The first id in `candidates` this picker would actually offer, if any.
 *
 * Every surface holds persisted model ids, and a sync can retire any of them
 * between sessions. Rather than each one re-deriving "is this still pickable",
 * they ask here, so the answer is by construction the same one the picker's own
 * rows give.
 */
export function firstPickable(
  env: RouteEnv | null,
  candidates: readonly string[],
  require: PickerCapabilities = {},
): string | undefined {
  if (!env) return undefined;
  for (const id of candidates) {
    const model = getModelById(id);
    // `isSelectable` is the retirement gate the pickers apply; repeat it here
    // so a stored id for a model the sync deprecated is never revived.
    if (!model || !isSelectable(model) || !meetsRequirements(model, require)) continue;
    const { kind } = modelAvailability(model, env);
    if (kind === "free" || kind === "your_key" || kind === "needs_key") return id;
  }
  return undefined;
}
