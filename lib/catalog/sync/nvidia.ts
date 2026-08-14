import type { CatalogModel, Modality } from "../types";
import {
  brandFor,
  contextWindowFor,
  reasoningHint,
  titleizeModelId,
  toolUseHint,
  visionHint,
} from "./brands";
import { atlasId, isoDate, matchKey } from "./normalize";
import type { ModelDraft, NvidiaModel } from "./types";

// NVIDIA NIM's model list is `{ id, object, created, owned_by }` and nothing
// more. Two consequences:
//
//   1. Non-chat endpoints (embeddings, rerankers, guardrails, OCR, speech) sit in
//      the same list as chat models and have to be excluded by name. Letting one
//      through would put a model in the picker that 400s on `/chat/completions`.
//   2. For models OpenRouter does not also list, every field below the id is
//      reconstructed from heuristics. Those entries are tagged
//      `metaConfidence: "derived"`.
//
// Everything NIM serves is free on the operator's key, which is why these models
// are the backbone of the zero-configuration experience.

// The non-chat denylist now lives in `./denylist`, shared with the OpenRouter
// adapter, and re-exported here so existing importers are unaffected.
import { isChatCapable } from "./denylist";

export {
  NON_CHAT_RULES,
  NON_CHAT_PATTERNS,
  META_ROUTER_RULES,
  isChatCapable,
  isDeniedAtlasId,
} from "./denylist";

export interface NormalizeNvidiaOptions {
  today: string;
}

/**
 * Reconstruct a `ModelDraft` from an id alone.
 *
 * Only used for models OpenRouter does not list. When it does, `merge.ts`
 * attaches a NIM route to the richer OpenRouter draft instead of calling this.
 */
export function draftFromNvidiaId(m: NvidiaModel, options: NormalizeNvidiaOptions): ModelDraft | null {
  const id = atlasId(m.id);
  if (!id) return null;

  const brand = brandFor(m.id, m.owned_by ?? undefined);
  const name = titleizeModelId(m.id);
  const contextWindow = contextWindowFor(m.id);
  const vision = visionHint(m.id);

  const modalities: Modality[] = vision ? ["text", "vision"] : ["text"];
  const capabilities: CatalogModel["capabilities"] = {
    // NIM exposes OpenAI-compatible tool calling broadly but does not say so per
    // model, so this is a family hint rather than a confirmed fact — which is
    // why `metaConfidence` stays "derived" and a curated entry still wins.
    //
    // It used to be a flat `false` on the grounds of claiming only what was safe
    // to claim. That was safe for the capability badge and ruinous everywhere
    // else: the chat client read the same field as a gate, so every NIM-synced
    // model without a hand-curated twin ran as a single-shot completion with the
    // agent loop switched off. An optimistic wrong answer now costs one
    // downgraded round trip, which `lib/router/index.ts` recovers from.
    toolUse: toolUseHint(m.id),
    structuredOutput: false,
    reasoning: reasoningHint(m.id),
    caching: false,
  };

  return {
    atlasId: id,
    matchKey: matchKey(m.id),
    sourceProviders: ["nvidia"],
    aliasIds: [],
    model: {
      name,
      provider: brand,
      family: name.split(/\s+/).slice(0, 2).join(" ") || brand,
      // Everything on NIM's open catalog ships weights.
      license: "open",
      // No `access` — the nvidia route itself is what makes this free, and
      // `lib/catalog/availability.ts` reads that. See the note in openrouter.ts.
      status: "ga",
      releaseDate: isoDate(m.created, options.today),
      contextWindow,
      maxOutput: Math.min(contextWindow, 8_192),
      modalities,
      capabilities,
      // Genuinely free on the operator's NIM key.
      pricing: { inputPerM: 0, outputPerM: 0, effectiveFrom: options.today },
      benchmarks: [],
      blurb: `${name} served free on NVIDIA NIM.`,
      routes: [{ provider: "nvidia", model: m.id }],
      tags: [
        "open",
        ...(capabilities.reasoning ? ["reasoning"] : []),
        ...(vision ? ["vision"] : []),
      ],
      metaConfidence: "derived",
    },
  };
}

export interface NvidiaNormalized {
  /** Chat-capable NIM entries, in list order. */
  chat: NvidiaModel[];
  /** Excluded by `NON_CHAT_PATTERNS` — reported so a sync run is auditable. */
  excluded: string[];
}

export function normalizeNvidia(models: NvidiaModel[]): NvidiaNormalized {
  const chat: NvidiaModel[] = [];
  const excluded: string[] = [];

  for (const m of models) {
    if (!m?.id) continue;
    if (isChatCapable(m.id)) chat.push(m);
    else excluded.push(m.id);
  }

  return { chat, excluded };
}
