import { intelligenceIndex, modelAccess, routableModels } from "./index";
import { resolveModelIds, type FallbackPreference } from "./resolve";
import type { CatalogModel } from "./types";

// Default model selections, in one place.
//
// These used to be seven independent hardcoded arrays scattered across
// components and stores. That was survivable while the catalog was a static file
// someone edited by hand; with a catalog that regenerates daily it is a set of
// latent crashes — `components/compare/compare-client.tsx` fed its defaults
// straight into `getModelById(id)!`.
//
// Each entry is a *preference list*, not a guarantee: ids are filtered through
// `resolveModelId` and topped up from the live catalog, so a default that gets
// delisted degrades to the next-best real model instead of a blank picker.

function suits(m: CatalogModel, pref: FallbackPreference): boolean {
  if (pref.tools && !m.capabilities.toolUse) return false;
  if (pref.vision && !m.modalities.includes("vision")) return false;
  // Via `modelAccess`, not `m.access`: the stored field is legacy and unset on
  // every synced model, so reading it here would reject the entire catalog and
  // send `pick()` straight to its last-resort tier.
  if (pref.free && modelAccess(m) !== "free") return false;
  return true;
}

/**
 * `count` live model ids: the preferred ones that still resolve, topped up with
 * the strongest remaining models that match `pref`.
 */
function pick(preferred: readonly string[], count: number, pref: FallbackPreference = {}): string[] {
  const chosen = resolveModelIds(preferred).slice(0, count);
  if (chosen.length >= count) return chosen;

  const taken = new Set(chosen);
  const candidates = routableModels()
    .filter((m) => !taken.has(m.id) && suits(m, pref))
    // Copy before sorting: selector results are shared and frozen in dev.
    .slice()
    .sort((a, b) => intelligenceIndex(b) - intelligenceIndex(a));

  for (const m of candidates) {
    if (chosen.length >= count) break;
    chosen.push(m.id);
  }

  // Top up by relaxing the *capability* preferences (tools, vision) — those
  // degrade gracefully, since the surface still works with a weaker model.
  if (chosen.length < count) {
    const relaxed = pref.free
      ? routableModels().filter((m) => modelAccess(m) === "free")
      : routableModels();
    for (const m of relaxed) {
      if (chosen.length >= count) break;
      if (!chosen.includes(m.id)) chosen.push(m.id);
    }
  }

  // `free` is never relaxed to fill out a set. Returning two working free models
  // beats returning three where the third answers 402 the moment it is used —
  // these defaults are applied without the user choosing them, so an error is
  // unattributable. The single exception is having nothing at all: an empty
  // picker is a dead end, whereas a paid model at least offers the key modal.
  if (chosen.length === 0) {
    for (const m of routableModels()) {
      if (chosen.length >= count) break;
      chosen.push(m.id);
    }
  }

  return chosen;
}

/** Chat, Learn, and the topbar model switcher. Free so it works with no user key. */
export function defaultChatModel(): string {
  return pick(["gpt-oss-120b", "llama-3-3-70b", "deepseek-v4-pro"], 1, { free: true })[0] ?? "";
}

/** Compare's initial columns — a deliberate free/frontier/open mix. */
export function defaultCompareModels(): string[] {
  return pick(["claude-sonnet-4-5", "deepseek-v4-pro", "gpt-oss-120b"], 3);
}

/** Bench's initial models. Free, so a run costs the user nothing. */
export function defaultBenchModels(): string[] {
  return pick(["gpt-oss-120b", "llama-3-3-70b", "qwen3-32b"], 3, { free: true });
}

/** Cost's initial comparison set — spans the price range on purpose. */
export function defaultCostModels(): string[] {
  return pick(
    ["claude-sonnet-4-5", "gpt-5", "gpt-5-mini", "deepseek-v4-pro", "llama-3-3-70b", "gemini-2-5-flash"],
    6,
  );
}

/** Playground's initial models. */
export function defaultPlaygroundModels(): string[] {
  return pick(["deepseek-v4-pro", "llama-3-3-70b"], 2);
}

/** Flow agent nodes. Needs tool calling to be useful. */
export function defaultFlowModel(): string {
  return pick(["llama-3-3-70b", "gpt-oss-120b"], 1, { free: true, tools: true })[0] ?? "";
}

/** Atlas Code's agent. Tool calling is mandatory there. */
export function defaultAgentModel(): string {
  return pick(["gpt-oss-120b", "qwen3-coder", "deepseek-v4-pro"], 1, { free: true, tools: true })[0] ?? "";
}
