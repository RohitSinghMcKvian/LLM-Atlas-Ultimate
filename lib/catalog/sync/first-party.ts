import type { CatalogModel, ModelRoute, ProviderId } from "../types";

// Attach first-party routes to models Atlas already knows, using each provider's
// own model list as the arbiter.
//
// The problem this solves: every Claude, GPT, Grok, Qwen, DeepSeek, GLM and
// Mistral model in the catalog reaches its brand through OpenRouter, which is
// metered. Their vendors also serve them directly — and for some (Z.ai's Flash
// tier) the direct lane is free where the aggregator is not.
//
// The tempting shortcut is to hardcode the vendor's model ids. That is exactly
// the failure mode `lib/catalog/availability.ts` exists to prevent, one step
// earlier: a guessed id produces a route that 404s, and the picker cannot tell
// until someone tries to use it. Upstream ids also drift (`glm-4.6` is not
// `glm-4-6`, and DeepSeek exposes only `deepseek-chat` / `deepseek-reasoner`
// aliases rather than versioned names).
//
// So nothing is guessed. A candidate id is *derived* mechanically from the
// OpenRouter route already in the catalog, and then kept only if the provider's
// live `/models` response actually lists it. A provider that is unreachable, or
// that does not list the id, contributes no route at all.

/**
 * OpenRouter namespaces a model as `vendor/model`. For these providers the part
 * after the slash is the vendor's own id for the same model, which is what makes
 * the derivation mechanical rather than a lookup table someone has to maintain.
 *
 * Deliberately absent:
 *   * `cerebras`, `groq`, `nvidia` — they host *other* vendors' open weights, so
 *     there is no namespace that implies a first-party id.
 *   * `local` — the user's own machine names models however it likes.
 */
export const FIRST_PARTY_VENDORS: Partial<Record<ProviderId, readonly string[]>> = {
  anthropic: ["anthropic/"],
  openai: ["openai/"],
  xai: ["x-ai/"],
  deepseek: ["deepseek/"],
  mistral: ["mistralai/", "mistral/"],
  zai: ["z-ai/", "zhipu/"],
  dashscope: ["qwen/", "alibaba/"],
};

export const FIRST_PARTY_PROVIDERS = Object.keys(FIRST_PARTY_VENDORS) as ProviderId[];

/** Live `/models` ids, per provider. A provider absent here contributes nothing. */
export type ProviderListings = Partial<Record<ProviderId, ReadonlySet<string>>>;

/**
 * The vendor's own id for an OpenRouter route, or `undefined` if the route is
 * not in this provider's namespace.
 *
 * OpenRouter also appends variant suffixes (`:free`, `:nitro`, `:extended`).
 * Those are OpenRouter's own routing directives, not part of the upstream id, so
 * they are stripped.
 */
export function firstPartyIdFor(
  provider: ProviderId,
  openRouterModel: string,
): string | undefined {
  const prefixes = FIRST_PARTY_VENDORS[provider];
  if (!prefixes) return undefined;
  for (const prefix of prefixes) {
    if (!openRouterModel.startsWith(prefix)) continue;
    const id = openRouterModel.slice(prefix.length).split(":")[0];
    return id || undefined;
  }
  return undefined;
}

export interface AttachResult {
  models: CatalogModel[];
  /** `atlasId → route` for everything added, so a sync run can report itself. */
  added: { id: string; provider: ProviderId; model: string }[];
}

/**
 * Add a first-party route to every model whose vendor confirms it serves it.
 *
 * Routes are appended, never reordered: `mergeSnapshot` sorts by
 * `ROUTE_PRIORITY` afterwards, and duplicating that ordering here would be a
 * second place for it to drift.
 */
export function attachFirstPartyRoutes(
  models: readonly CatalogModel[],
  listings: ProviderListings,
): AttachResult {
  const providers = FIRST_PARTY_PROVIDERS.filter((p) => (listings[p]?.size ?? 0) > 0);
  if (providers.length === 0) return { models: [...models], added: [] };

  const added: AttachResult["added"] = [];

  const out = models.map((model) => {
    const routes = model.routes ?? [];
    // Only OpenRouter ids carry a vendor namespace, so they are the only source
    // a first-party id can be derived from.
    const orRoutes = routes.filter((r) => r.provider === "openrouter");
    if (orRoutes.length === 0) return model;

    const extra: ModelRoute[] = [];
    for (const provider of providers) {
      // Never add a second route for a provider the model already reaches.
      if (routes.some((r) => r.provider === provider)) continue;
      const listed = listings[provider]!;
      for (const r of orRoutes) {
        const candidate = firstPartyIdFor(provider, r.model);
        // The arbiter: the vendor's own list, not our derivation.
        if (!candidate || !listed.has(candidate)) continue;
        extra.push({ provider, model: candidate });
        added.push({ id: model.id, provider, model: candidate });
        break;
      }
    }

    return extra.length > 0 ? { ...model, routes: [...routes, ...extra] } : model;
  });

  return { models: out, added };
}
