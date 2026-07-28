import { activeSnapshot, EMPTY_SNAPSHOT } from "./snapshot";
import { BASELINE_SNAPSHOT } from "./baseline";
import { getModelById, intelligenceIndex, modelAccess, routableModels } from "./index";
import { matchKey } from "./sync/normalize";
import type { CatalogModel } from "./types";

// Resolving a model id that may no longer exist.
//
// The catalog is now regenerated daily, so any id the app has *stored* — a
// persisted `activeModelId`, a saved playground config, a shared `/chat?model=…`
// link, a conversation's `model_id` column — can outlive the model it names.
// Before this, a stale id silently rendered "Select model" with no way back.
//
// Note this is resolution, not rewriting: historical records (past conversations,
// past runs) keep their original id as provenance. Only the *live* selection is
// healed.

function snap() {
  const s = activeSnapshot();
  return s === EMPTY_SNAPSHOT ? BASELINE_SNAPSHOT : s;
}

const matchIndexCache = new WeakMap<object, Map<string, string>>();

/** Lossy-key index, built lazily and keyed on the snapshot object. */
function matchIndex(): Map<string, string> {
  const s = snap();
  let index = matchIndexCache.get(s);
  if (!index) {
    index = new Map();
    for (const m of s.models) {
      const key = matchKey(m.id);
      // First writer wins, so an exact id always beats a near-miss.
      if (!index.has(key)) index.set(key, m.id);
    }
    matchIndexCache.set(s, index);
  }
  return index;
}

/**
 * The live id this id refers to, or `undefined` when the model is truly gone.
 *
 * Tries, in order: the id itself; the snapshot's alias table (variant suffixes,
 * date-stamped provider slugs, and tombstoned models that name a successor); then
 * a normalized-name match, which catches drift like `gpt-5.5` → `gpt-5-5`.
 */
export function resolveModelId(id?: string | null): string | undefined {
  if (!id) return undefined;

  if (getModelById(id)) return id;

  const alias = snap().aliases[id];
  // An empty alias is a tombstone with no successor — a definitive "gone".
  if (alias === "") return undefined;
  if (alias && getModelById(alias)) return alias;

  const near = matchIndex().get(matchKey(id));
  return near && near !== id ? near : undefined;
}

/** Whether an id names a model the user can still select right now. */
export function isLiveModelId(id?: string | null): boolean {
  return resolveModelId(id) !== undefined;
}

export interface FallbackPreference {
  /** Prefer a model that needs no user key. */
  free?: boolean;
  /** Require tool calling (the agent and flow surfaces need it). */
  tools?: boolean;
  vision?: boolean;
}

function scoreFor(m: CatalogModel): number {
  return intelligenceIndex(m);
}

/**
 * The best available substitute when a stored id cannot be resolved.
 *
 * Always returns something routable as long as the catalog is non-empty, because
 * every caller is recovering from a dangling reference and needs *a* model, not
 * another failure.
 */
export function fallbackModelId(pref: FallbackPreference = {}): string {
  const models = routableModels();
  if (models.length === 0) return "";

  // `modelAccess`, never `m.access` — the stored field is legacy and is no longer
  // written by the sync, so reading it directly would make `pref.free` reject
  // every synced model and silently drop this to the last-resort tier.
  const matches = (m: CatalogModel) =>
    (!pref.tools || m.capabilities.toolUse) &&
    (!pref.vision || m.modalities.includes("vision")) &&
    (!pref.free || modelAccess(m) === "free");

  const best = (list: readonly CatalogModel[]): CatalogModel | undefined => {
    let winner: CatalogModel | undefined;
    for (const m of list) {
      if (!winner || scoreFor(m) > scoreFor(winner)) winner = m;
    }
    return winner;
  };

  // Relax the constraints one at a time rather than returning nothing. A free
  // preference is the LAST thing to relax: handing back a model the user cannot
  // pay for is worse than handing back one without tool support.
  const tiers: CatalogModel[][] = [
    models.filter(matches),
    models.filter((m) => modelAccess(m) === "free"),
    [...models],
  ];
  for (const tier of tiers) {
    const pick = best(tier);
    if (pick) return pick.id;
  }
  return models[0].id;
}

/** Resolve a stored id, falling back to a live model when it cannot be. */
export function resolveOrFallback(id: string | null | undefined, pref?: FallbackPreference): string {
  return resolveModelId(id) ?? fallbackModelId(pref);
}

/** Filter a stored list of ids down to the ones that still resolve, de-duplicated. */
export function resolveModelIds(ids: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const live = resolveModelId(id);
    if (!live || seen.has(live)) continue;
    seen.add(live);
    out.push(live);
  }
  return out;
}
