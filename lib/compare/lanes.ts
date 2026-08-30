// The lane planner: what each model gets, before anything is streamed.
//
// Everything expensive or irreversible about a run is decided here, in one
// pure function, so it can be argued with in a test rather than discovered in
// production: how many lanes may run, which band each takes, whether a model can
// run at all, how the shared evidence is carried into a narrow context window,
// what a lane may spend, and how many upstream connections open at once.
//
// The old route decided none of this. It took `body.modelIds`, called
// `Promise.all` over all of them with no cap and no `maxTokens`, and found out
// about an unusable model when the provider answered 402 mid-stream.

import { modelAvailability, unavailableReason, type RouteEnv } from "@/lib/catalog/availability";
import { getModelById, intelligenceIndex, routableModels } from "@/lib/catalog";
import type { CatalogModel } from "@/lib/catalog/types";
import { estimateTokens } from "@/lib/engine/context";
import {
  MAX_LANES,
  type Band,
  type ContextFit,
  type Depth,
  type LanePlan,
  type RunConfig,
} from "./types";

/**
 * The parts of a catalog model the planner reads.
 *
 * A `Pick` rather than a hand-written shape, following `RoutableModel` in
 * `lib/catalog/availability.ts`: it keeps the object assignable to
 * `modelAvailability` (which wants exactly `routes`/`license`/`pricing`) without
 * a cast, and a field that changes type in the catalog fails here rather than
 * silently drifting.
 */
export type LaneModel = Pick<
  CatalogModel,
  "id" | "name" | "contextWindow" | "maxOutput" | "pricing" | "routes" | "license"
>;

/** Injected so the planner is testable without a catalog snapshot. */
export type ModelLookup = (id: string) => LaneModel | undefined;

const defaultLookup: ModelLookup = (id) => getModelById(id) as LaneModel | undefined;

/**
 * What one depth setting actually means.
 *
 * Exposed as data rather than branches because the composer shows the numbers
 * ("2 research rounds, judge on") and the cost estimator needs the same ones.
 * A user who cannot see what Deep costs them will not use it.
 */
export interface DepthPreset {
  /** Output ceiling per lane, before per-model and per-budget clamps. */
  maxOutputTokens: number;
  researchRounds: number;
  researchQueries: number;
  maxSources: number;
  claims: boolean;
  judge: boolean;
  headToHead: boolean;
  /** Dollars one lane may spend. */
  laneBudgetUsd: number;
  /** Upstream connections opened at once. */
  concurrency: number;
}

export const DEPTH_PRESETS: Record<Depth, DepthPreset> = {
  quick: {
    maxOutputTokens: 900,
    researchRounds: 0,
    researchQueries: 0,
    maxSources: 0,
    claims: false,
    judge: false,
    headToHead: false,
    laneBudgetUsd: 0.05,
    concurrency: 6,
  },
  standard: {
    maxOutputTokens: 1_600,
    researchRounds: 2,
    researchQueries: 6,
    maxSources: 12,
    claims: true,
    judge: true,
    headToHead: false,
    laneBudgetUsd: 0.15,
    // Lower than Quick on purpose: a Standard lane carries an evidence pack, so
    // each connection costs the provider more and is likelier to be throttled.
    concurrency: 4,
  },
  deep: {
    maxOutputTokens: 3_000,
    researchRounds: 4,
    researchQueries: 12,
    maxSources: 24,
    claims: true,
    judge: true,
    headToHead: true,
    laneBudgetUsd: 0.5,
    concurrency: 3,
  },
};

/**
 * Tokens of prompt that are not evidence: the restated task, the system prompt,
 * the ground rules, and the chat scaffolding around them.
 *
 * A fixed allowance rather than a measurement because it is small, bounded by
 * the brief's own schema, and being wrong by a hundred tokens cannot change a
 * fit decision that turns on thousands.
 */
export const PROMPT_OVERHEAD_TOKENS = 600;

/**
 * Fraction of a context window the planner is willing to fill.
 *
 * Providers count tokens differently from `chars/4`, and a request that
 * overflows is rejected outright rather than truncated — so the estimate has to
 * be wrong in the safe direction.
 */
export const CONTEXT_SAFETY = 0.9;

/**
 * Below this much room for evidence, retrieval has nothing useful to put in the
 * prompt and the lane has to summarise its way in instead.
 */
export const MIN_RAG_TOKENS = 2_000;

/**
 * Which band each lane takes, in selection order.
 *
 * Order matters and is not cosmetic: the ramp runs deep water to summit, the
 * legend under the composer reads left to right, and a lane that changed band
 * between renders would break the one thing the user is using to track it.
 */
export function bandFor(index: number): Band {
  return (index % MAX_LANES) as Band;
}

/**
 * How the shared evidence is carried into this model's context.
 *
 * The evidence itself never changes — that is the point of the shared-evidence
 * design — only how a narrow window holds it.
 */
export function fitFor(
  model: Pick<LaneModel, "contextWindow">,
  evidenceTokens: number,
  outputTokens: number,
): ContextFit {
  const usable = Math.floor((model.contextWindow || 0) * CONTEXT_SAFETY);
  const room = usable - outputTokens - PROMPT_OVERHEAD_TOKENS;
  // No room even for the ask and its answer: the lane cannot be given evidence
  // directly at all, so it reads it in passes.
  if (room <= 0) return "map-reduce";
  if (evidenceTokens <= room) return "stuff";
  if (room >= MIN_RAG_TOKENS) return "rag";
  return "map-reduce";
}

/**
 * The largest output this lane can afford, given what its input already costs.
 *
 * Returns 0 when the input alone exceeds the budget — the caller treats that as
 * "cannot run within budget" rather than silently sending a request that will
 * blow through it.
 */
export function affordableOutputTokens(
  model: Pick<LaneModel, "pricing">,
  promptTokens: number,
  budgetUsd: number,
): number {
  const inputCost = (promptTokens / 1e6) * (model.pricing.inputPerM || 0);
  const left = budgetUsd - inputCost;
  if (left <= 0) return 0;
  const rate = model.pricing.outputPerM || 0;
  // A free model has no rate to divide by, so nothing constrains it here; the
  // preset and the model's own `maxOutput` still do.
  if (rate <= 0) return Number.POSITIVE_INFINITY;
  return Math.floor((left / rate) * 1e6);
}

export interface PlanInput {
  config: RunConfig;
  env: RouteEnv;
  /** Tokens of shared evidence every lane will carry. 0 before that stage runs. */
  evidenceTokens?: number;
  lookup?: ModelLookup;
}

export interface LanePlanResult {
  lanes: LanePlan[];
  concurrency: number;
  preset: DepthPreset;
  /** Model ids dropped because the run was already at `MAX_LANES`. */
  dropped: string[];
}

/**
 * Plan every lane in a run.
 *
 * Unknown and unavailable models are planned as `blocked` rather than skipped.
 * A lane that says "connect your OpenRouter key" is information; a lane that
 * silently vanishes between the composer and the grid is a bug report.
 */
export function planLanes(input: PlanInput): LanePlanResult {
  const { config, env } = input;
  const lookup = input.lookup ?? defaultLookup;
  const evidenceTokens = Math.max(0, input.evidenceTokens ?? 0);
  const preset = DEPTH_PRESETS[config.depth] ?? DEPTH_PRESETS.standard;

  // De-duplicate before capping, so asking for the same model twice cannot cost
  // someone a lane slot.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of config.modelIds) {
    const trimmed = id?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
  }

  const kept = unique.slice(0, MAX_LANES);
  const dropped = unique.slice(MAX_LANES);

  const questionTokens = estimateTokens(config.question) + estimateTokens(config.systemPrompt);

  const lanes = kept.map((modelId, i): LanePlan => {
    const band = bandFor(i);
    const model = lookup(modelId);

    if (!model) {
      return {
        id: modelId,
        modelId,
        band,
        fit: "stuff",
        maxTokens: preset.maxOutputTokens,
        budgetUsd: preset.laneBudgetUsd,
        blocked: { code: "model_not_found", message: "This model is no longer in the catalog." },
      };
    }

    const availability = modelAvailability(model, env);
    const blocked =
      availability.kind === "needs_key" || availability.kind === "unavailable"
        ? {
            code: availability.kind === "needs_key" ? "key_required" : "no_route",
            message: unavailableReason(availability) ?? "This model cannot run here.",
          }
        : undefined;

    // The fit decision needs an output size and the output size needs a fit, so
    // the ceiling is resolved against the preset first and the fit is decided
    // from that. Overshooting the output only makes the fit more conservative.
    const ceiling = Math.min(
      preset.maxOutputTokens,
      model.maxOutput || preset.maxOutputTokens,
    );
    const fit = fitFor(model, evidenceTokens, ceiling);

    // Stuffing is the only fit that puts the whole pack in the prompt; the other
    // two send a slice, so they must not be priced as if they sent everything.
    const carried = fit === "stuff" ? evidenceTokens : Math.min(evidenceTokens, MIN_RAG_TOKENS * 4);
    const promptTokens = questionTokens + carried + PROMPT_OVERHEAD_TOKENS;

    const affordable = affordableOutputTokens(model, promptTokens, preset.laneBudgetUsd);
    const maxTokens = Math.max(1, Math.min(ceiling, affordable));

    return {
      id: modelId,
      modelId,
      band,
      fit,
      maxTokens,
      budgetUsd: preset.laneBudgetUsd,
      blocked:
        blocked ??
        (affordable < 1
          ? {
              code: "over_budget",
              message: "This model costs more than the run's per-lane budget. Raise Depth or pick a cheaper model.",
            }
          : undefined),
    };
  });

  // Blocked lanes never open a connection, so they must not reserve a slot in
  // the concurrency window either.
  const runnable = lanes.filter((l) => !l.blocked).length;

  return {
    lanes,
    concurrency: Math.max(1, Math.min(preset.concurrency, runnable || 1)),
    preset,
    dropped,
  };
}

/**
 * Models worth considering as the brief writer, judge or synthesizer.
 *
 * Ordered by capability, and filtered to models that can actually honour
 * `responseFormat: { type: "json_schema" }` — every arbiter pass asks for
 * structured output, and a model that ignores the schema produces a reply the
 * parser then has to fall back on.
 *
 * Computed from the live catalog rather than hard-coded, so the daily sync
 * retiring a model does not leave a dangling default.
 */
export function arbiterCandidates(limit = 12): string[] {
  return routableModels()
    .filter((m) => m.capabilities?.structuredOutput)
    .sort((a, b) => intelligenceIndex(b) - intelligenceIndex(a))
    .slice(0, limit)
    .map((m) => m.id);
}

/** Which judge or synthesizer to use, given the lanes.
 *
 * Prefers a model that is *not* competing. The old `pickSynthesizer()` returned
 * the first entry of `modelIds`, which meant a compared model routinely wrote
 * the summary of its own answer — the one arrangement guaranteed to flatter it.
 * Falls back to a lane only when nothing else is runnable, and the caller is
 * expected to say so in the UI rather than hide it.
 */
export function pickArbiter(
  laneIds: string[],
  candidates: string[],
  env: RouteEnv,
  lookup: ModelLookup = defaultLookup,
): { modelId: string; isContestant: boolean } | null {
  const lanes = new Set(laneIds);
  const runnable = (id: string) => {
    const m = lookup(id);
    if (!m) return false;
    const a = modelAvailability(m, env);
    return a.kind === "free" || a.kind === "your_key";
  };

  for (const id of candidates) {
    if (lanes.has(id)) continue;
    if (runnable(id)) return { modelId: id, isContestant: false };
  }
  for (const id of laneIds) {
    if (runnable(id)) return { modelId: id, isContestant: true };
  }
  return null;
}
