import type { BenchmarkScore, CatalogModel, Modality, OutputModality } from "../types";
import { brandFor, titleizeModelId } from "./brands";
import { isChatCapable } from "./denylist";
import {
  atlasId,
  clampBlurb,
  isoDate,
  matchKey,
  perMillion,
  stripVariant,
  variantOf,
} from "./normalize";
import type { ModelDraft, OpenRouterModel } from "./types";

// OpenRouter is the metadata-rich source: context, per-token pricing, input
// modalities, supported parameters, open-weights provenance via
// `hugging_face_id`, a deprecation date, and — for a majority of models —
// Artificial Analysis benchmark indices.

export const AA_SOURCE = "Artificial Analysis";
export const AA_SOURCE_URL = "https://artificialanalysis.ai";
export const DESIGN_ARENA_SOURCE = "Design Arena";
export const DESIGN_ARENA_SOURCE_URL = "https://designarena.ai";

function isChatModel(m: OpenRouterModel): boolean {
  const outputs = m.architecture?.output_modalities;
  // Text and image output are both handled now (P12). Audio is not: nothing in
  // the app can play or store it, so an audio generation model would be a
  // picker entry that produces nothing.
  if (outputs && outputs.length > 0 && !outputs.some((o) => o === "text" || o === "image"))
    return false;
  // Shares NVIDIA's denylist: safety classifiers like `llama-guard-4-12b` and
  // `gpt-oss-safeguard-20b` speak the chat-completions protocol but are not chat
  // models, and listing them in the picker offers the user a classifier.
  return isChatCapable(m.id);
}

function modalitiesOf(m: OpenRouterModel): Modality[] {
  const inputs = m.architecture?.input_modalities ?? [];
  const out: Modality[] = ["text"];
  if (inputs.includes("image")) out.push("vision");
  if (inputs.includes("audio")) out.push("audio");
  return out;
}

/**
 * What the model emits, from OpenRouter's own `output_modalities`.
 *
 * Returns undefined for a plain text model rather than `["text"]`: the field is
 * optional precisely so the common case adds nothing to every snapshot row.
 */
function outputModalitiesOf(m: OpenRouterModel): OutputModality[] | undefined {
  const outputs = m.architecture?.output_modalities ?? [];
  if (!outputs.includes("image")) return undefined;
  return outputs.includes("text") ? ["text", "image"] : ["image"];
}

function capabilitiesOf(m: OpenRouterModel): CatalogModel["capabilities"] {
  const params = new Set(m.supported_parameters ?? []);
  const cacheRead = perMillion(m.pricing?.input_cache_read);

  return {
    toolUse: params.has("tools") || params.has("tool_choice"),
    structuredOutput: params.has("structured_outputs") || params.has("response_format"),
    reasoning:
      m.reasoning != null ||
      params.has("reasoning") ||
      params.has("include_reasoning") ||
      params.has("reasoning_effort"),
    caching: cacheRead > 0 || m.pricing?.input_cache_write != null,
  };
}

/**
 * `status` from what the provider actually tells us.
 *
 * `expiration_date` is OpenRouter's own end-of-life marker, which makes it a far
 * better deprecation signal than absence from the list. `upcoming` is never
 * synthesized — it means "announced but not servable", which by definition
 * cannot describe something the provider is currently listing.
 */
function statusOf(m: OpenRouterModel): CatalogModel["status"] {
  if (m.expiration_date) {
    const when = Date.parse(m.expiration_date);
    // Some entries carry a sentinel far-future date; only a real, near-term
    // expiry means deprecated.
    if (!Number.isNaN(when) && when < Date.now() + 365 * 86_400_000) return "deprecated";
  }
  if (/(^|[-/])(alpha|beta|exp|experimental|preview)(-|$)/i.test(m.id)) return "preview";
  return "ga";
}

/**
 * Family from the display name: everything before the first minor-version
 * component. `"GPT-5.5"` → `"GPT-5"`, `"Claude Opus 4.6"` → `"Claude Opus 4"`.
 */
function familyOf(name: string, brand: string): string {
  const trimmed = name.replace(/\s*\((?:free|fast|thinking|preview|beta)\)\s*$/i, "").trim();
  const decimal = trimmed.match(/^(.*?\d+)\.\d+/);
  if (decimal) return decimal[1].trim();
  const words = trimmed.split(/\s+/);
  return (words.length > 1 ? words.slice(0, -1).join(" ") : trimmed) || brand;
}

function benchmarksOf(m: OpenRouterModel, measuredAt: string): BenchmarkScore[] {
  const out: BenchmarkScore[] = [];
  const aa = m.benchmarks?.artificial_analysis;

  const push = (key: string, score: number | null | undefined, source: string, url: string) => {
    if (typeof score !== "number" || !Number.isFinite(score)) return;
    out.push({ key, score: Math.round(score * 10) / 10, source, sourceUrl: url, measuredAt });
  };

  push("aa-intelligence", aa?.intelligence_index, AA_SOURCE, AA_SOURCE_URL);
  push("aa-coding", aa?.coding_index, AA_SOURCE, AA_SOURCE_URL);
  push("aa-agentic", aa?.agentic_index, AA_SOURCE, AA_SOURCE_URL);

  // `design_arena` reports one row per arena/category. Take the strongest.
  // Deliberately its own key: Design Arena Elo is not on the same scale as the
  // LMSYS Arena Elo the curated catalog records under `arena`, and blending them
  // would corrupt both that column and `intelligenceIndex`'s fallback.
  const arenas = m.benchmarks?.design_arena ?? [];
  let bestElo: number | undefined;
  for (const row of arenas) {
    if (typeof row.elo === "number" && (bestElo === undefined || row.elo > bestElo)) {
      bestElo = row.elo;
    }
  }
  push("design-arena", bestElo, DESIGN_ARENA_SOURCE, DESIGN_ARENA_SOURCE_URL);

  return out;
}

function tagsOf(m: OpenRouterModel, caps: CatalogModel["capabilities"], vision: boolean): string[] {
  const aa = m.benchmarks?.artificial_analysis;
  const tags: string[] = [];
  if (caps.reasoning) tags.push("reasoning");
  if (vision) tags.push("vision");
  if (caps.toolUse) tags.push("tools");
  if (typeof aa?.coding_index === "number" && aa.coding_index >= 50) tags.push("coding");
  if (typeof aa?.agentic_index === "number" && aa.agentic_index >= 50) tags.push("agentic");
  if (m.hugging_face_id) tags.push("open");
  return tags;
}

/**
 * Group the raw list by base model id and fold variant suffixes into route
 * entries. `deepseek/deepseek-r1` and `deepseek/deepseek-r1:free` are one
 * catalog model with two routes, not two models — the free tier is a serving
 * option, and duplicating the row would be a UX regression.
 */
function groupVariants(models: OpenRouterModel[]): Map<string, {
  base: OpenRouterModel;
  variants: { id: string; variant: string; model: OpenRouterModel }[];
}> {
  const groups = new Map<
    string,
    { base: OpenRouterModel; variants: { id: string; variant: string; model: OpenRouterModel }[] }
  >();

  for (const m of models) {
    const baseId = stripVariant(m.id);
    const variant = variantOf(m.id);
    const existing = groups.get(baseId);

    if (!existing) {
      groups.set(baseId, variant ? { base: m, variants: [{ id: m.id, variant, model: m }] } : { base: m, variants: [] });
      continue;
    }
    if (variant) {
      existing.variants.push({ id: m.id, variant, model: m });
    } else {
      // A real base entry always beats a variant standing in for one.
      existing.base = m;
    }
  }

  return groups;
}

export interface NormalizeOpenRouterOptions {
  /** ISO date recorded on every derived benchmark score and price. */
  today: string;
  /**
   * Blended $/Mtok at or below which an *open-weight* model is treated as free
   * (operator-funded). Defaults to 0 — see `merge.ts` for why the default is
   * deliberately conservative.
   */
  freeOpenCeilingPerM?: number;
}

export function normalizeOpenRouter(
  models: OpenRouterModel[],
  options: NormalizeOpenRouterOptions,
): ModelDraft[] {
  const { today, freeOpenCeilingPerM = 0 } = options;
  const drafts: ModelDraft[] = [];

  for (const [baseId, group] of groupVariants(models.filter(isChatModel))) {
    const m = group.base;
    // The listed id, not `canonical_slug`: the canonical slug carries a snapshot
    // date (`anthropic/claude-opus-5-20260601`), so building public ids from it
    // would change every URL each time a vendor dates a new build. The slug is
    // registered as an alias instead, so a link using it still resolves.
    const id = atlasId(baseId);
    if (!id) continue;

    const brand = brandFor(baseId);
    const rawName = (m.name ?? "").trim();
    // OpenRouter prefixes display names with the vendor: "OpenAI: GPT-5.5".
    const name = rawName ? rawName.replace(/^[^:]{1,24}:\s*/, "") : titleizeModelId(baseId);

    const contextWindow = m.top_provider?.context_length || m.context_length || 32_768;
    // Clamped: a handful of upstream entries report a completion cap above their
    // own context window (`gpt-3.5-turbo-0613` is 4095/4096), which would make the
    // context-health meter and token budgeting nonsensical.
    const maxOutput = Math.min(
      m.top_provider?.max_completion_tokens || Math.min(contextWindow, 8_192),
      contextWindow,
    );

    const modalities = modalitiesOf(m);
    const outputModalities = outputModalitiesOf(m);
    const capabilities = capabilitiesOf(m);
    const license: CatalogModel["license"] = m.hugging_face_id ? "open" : "proprietary";

    const inputPerM = perMillion(m.pricing?.prompt);
    const outputPerM = perMillion(m.pricing?.completion);
    const cachedInputPerM = perMillion(m.pricing?.input_cache_read);
    // Deliberately left out of `blended`: the blend drives the free-tier test
    // and the leaderboard's price axis, both of which compare models on a text
    // turn. Folding in a rate that only applies when the model draws would make
    // an image model look expensive for work it does at the ordinary rate.
    const imageOutputPerM = perMillion(m.pricing?.image_output);
    const blended = (inputPerM * 3 + outputPerM) / 4;

    // Routes, in failover order: a free serving tier always precedes the paid one.
    const freeVariant = group.variants.find((v) => v.variant === "free");
    const routes: CatalogModel["routes"] = [];
    if (freeVariant) routes.push({ provider: "openrouter", model: freeVariant.id });
    routes.push({ provider: "openrouter", model: baseId });

    const isFree =
      blended === 0 ||
      freeVariant != null ||
      (license === "open" && blended <= freeOpenCeilingPerM);

    drafts.push({
      atlasId: id,
      matchKey: matchKey(baseId),
      sourceProviders: ["openrouter"],
      aliasIds: [
        ...group.variants.map((v) => atlasId(v.id)),
        ...(m.canonical_slug ? [atlasId(m.canonical_slug)] : []),
      ].filter((v) => v && v !== id),
      model: {
        name,
        provider: brand,
        family: familyOf(name, brand),
        license,
        // No `access`. Freeness is a property of the *routes* — a `:free` variant
        // route, or an operator-funded provider — and is derived at read time by
        // `lib/catalog/availability.ts`. Stamping it here duplicated the
        // derivation and let it go stale: a route pruned by the liveness probe
        // would leave behind a model still claiming to be free.
        status: statusOf(m),
        releaseDate: isoDate(m.created, today),
        contextWindow,
        maxOutput,
        modalities,
        ...(outputModalities ? { outputModalities } : {}),
        capabilities,
        pricing: {
          inputPerM,
          outputPerM,
          ...(cachedInputPerM > 0 ? { cachedInputPerM } : {}),
          ...(imageOutputPerM > 0 ? { imageOutputPerM } : {}),
          effectiveFrom: today,
        },
        benchmarks: benchmarksOf(m, today),
        blurb: clampBlurb(m.description) || `${name} served via OpenRouter.`,
        routes,
        tags: tagsOf(m, capabilities, modalities.includes("vision")),
        metaConfidence: "verified",
      },
    });
  }

  return drafts;
}
