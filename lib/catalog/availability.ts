import { PROVIDERS, inFreeTier } from "./providers";
import type { CatalogModel, ModelAccess, ModelRoute, ProviderId } from "./types";

// Can the person in front of the app actually run this model, and who pays?
//
// This is the single arbiter for that question. Both the server's failover loop
// (`lib/router/index.ts`) and the pickers call it, and the server consumes the
// route list it returns *verbatim*. That is the point: the failure mode we are
// designing against is a picker that says "Free" and a server that then answers
// 402, and the only durable way to prevent it is to have one function decide.
//
// Two reasons this cannot be a stored field on `CatalogModel`:
//
//   * It depends on which provider keys exist right now. Adding `GROQ_API_KEY`
//     must make Groq-routed models free immediately — without a resync, and
//     without waiting for a liveness probe cycle.
//   * It has four inputs, not one (see `RouteEnv`). A stored boolean drifts the
//     moment a fifth appears.
//
// So it is derived, and it costs no extra bytes on the wire: zero-cost-ness is a
// pure function of `(provider, route id)` given `ProviderMeta`, and route
// *health* never ships at all — `lib/catalog/sync/merge.ts` prunes dead routes,
// so a route present in `routes[]` is presumed live. That is the only claim a
// client could act on anyway.
//
// IMPORT DISCIPLINE — load-bearing. This module may import `./types` and
// `./providers` (~2 KB of metadata) and nothing else. Never `./index`, never
// `./baseline`, never `lib/router`. It is imported by the always-mounted shell,
// so pulling in model data here would weld the whole catalog into the chunk that
// `/docs`, `/datasets` and `/notebooks` also parse.

/**
 * Everything outside the catalog that changes the answer.
 *
 * The server builds this from `process.env`; the client builds it from
 * `GET /api/v1/providers` via `lib/hooks/use-route-env.ts`.
 */
export interface RouteEnv {
  /** Providers with a usable operator credential. */
  configured: readonly ProviderId[];
  /**
   * Providers the user has supplied their own key for.
   *
   * A user's key makes that provider reachable exactly the way an operator
   * credential does. What differs is who pays — see `runtimeFor` in
   * `lib/router/index.ts` — not whether the route can be dialled at all.
   */
  userKeys?: readonly ProviderId[];
  /**
   * @deprecated Superseded by `userKeys`. Normalised in by `userKeySet` so
   * callers that have not migrated keep working; delete after one release.
   */
  userOpenRouterKey?: boolean;
  /** `OPERATOR_SERVE_PAID` — the operator will pay for metered routes. */
  servePaid?: boolean;
  /**
   * `ATLAS_FREE_OPEN_CEILING_PER_M` — blended $/Mtok the operator is willing to
   * absorb and still call "free". Defaults to 0, i.e. only genuinely-$0 routes.
   */
  freeCeilingPerM?: number;
}

/** A `RouteEnv` with no operator keys at all. */
export const NO_PROVIDERS: RouteEnv = { configured: [] };

/**
 * Every provider, as if all were keyed. Used by `intrinsicAccess` to ask the
 * env-independent question "could this model ever be free for someone".
 */
export const ALL_PROVIDERS: RouteEnv = {
  configured: Object.keys(PROVIDERS) as ProviderId[],
};

/** The providers this user can dial with their own credential. */
function userKeySet(env: RouteEnv): ReadonlySet<ProviderId> {
  const keys = new Set(env.userKeys ?? []);
  if (env.userOpenRouterKey) keys.add("openrouter");
  return keys;
}

export type RouteCost = "free" | "metered";

/**
 * The parts of a model that decide cost and reachability.
 *
 * Structural rather than `CatalogModel` so the sync engine can ask about a draft
 * (`Omit<CatalogModel, "id">`) before an id has been assigned — the adapters need
 * the same answer the UI will get, and duplicating the rule is how it drifted in
 * the first place.
 */
export type RoutableModel = Pick<CatalogModel, "routes" | "license" | "pricing">;

function blendedPerM(model: RoutableModel): number {
  // Matches the 3:1 input:output weighting the sync engine uses, so a route the
  // sync called free is called free here too.
  const { inputPerM = 0, outputPerM = 0 } = model.pricing ?? {};
  return (inputPerM * 3 + outputPerM) / 4;
}

/**
 * What this one route costs the end user.
 *
 * Deliberately does NOT ask whether anyone holds a credential for the provider —
 * that is `modelAvailability`'s `usable` filter. Keeping the two questions apart
 * is what lets `intrinsicAccess` ask "could this ever be free for someone" by
 * passing `ALL_PROVIDERS`.
 */
export function routeCost(
  route: ModelRoute,
  model: RoutableModel,
  env: RouteEnv = NO_PROVIDERS,
): RouteCost {
  const meta = PROVIDERS[route.provider];

  // Operator-funded providers are free by definition — that is what the
  // operator's key is for.
  if (meta?.billing === "operator-funded") return "free";

  // The provider's own free tier covers this route. Descriptor-driven, so
  // OpenRouter's `:free` suffix and Z.ai's named Flash models are one mechanism
  // rather than two rules. Only a `"recurring"` allowance qualifies: a grant of
  // signup credits runs out, and a badge that expires is exactly the class of
  // lie this module exists to prevent.
  if (inFreeTier(meta?.freeTier, route.model)) return "free";

  // A genuinely zero-priced listing costs nothing to call. Distinct from the
  // tier above: that is a rate-limited free lane on an otherwise paid model,
  // this is simply a $0 price.
  if (blendedPerM(model) === 0) return "free";

  // A priced route can still be "free" to the user when the operator has opted
  // to absorb cheap open-weight models. The ceiling defaults to 0, so this does
  // not fire unless someone turns it on.
  const ceiling = env.freeCeilingPerM ?? 0;
  if (ceiling > 0 && model.license === "open" && blendedPerM(model) <= ceiling) {
    return "free";
  }
  return "metered";
}

export type Availability =
  /** Runnable at no cost to the user. `candidates` are all zero-cost. */
  | { kind: "free"; route: ModelRoute; candidates: ModelRoute[] }
  /** Runnable, billed to whoever's key is in play. */
  | { kind: "your_key"; route: ModelRoute; candidates: ModelRoute[] }
  /**
   * Metered routes exist but nobody is paying — the user must connect a key.
   * `providers` names the ones that would unlock it, so the connect dialog can
   * open pointed at a provider that can actually help.
   */
  | { kind: "needs_key"; providers: ProviderId[] }
  /** Nothing can serve it here. */
  | {
      kind: "unavailable";
      reason: "no_routes" | "no_configured_provider" | "no_free_route";
    };

/**
 * Which routes may be attempted, in order, and who pays.
 *
 * Guarantees the rest of the system relies on:
 *
 *   1. `kind: "free"` implies **every** route in `candidates` is
 *      `routeCost === "free"` and its provider is reachable. A model the user
 *      picked as free can never fall through onto a metered route. The cost of
 *      that promise is real: if every free route fails, the request fails rather
 *      than quietly billing.
 *   2. `candidates` is ordered zero-cost first, so the cheapest working route
 *      wins even when the catalog's own route order disagrees.
 *   3. `kind: "your_key"` implies every candidate is one somebody has actually
 *      agreed to pay for — the user's own key for *that* provider, or
 *      `servePaid`.
 */
export function modelAvailability(model: RoutableModel, env: RouteEnv): Availability {
  const routes = model.routes ?? [];
  if (routes.length === 0) return { kind: "unavailable", reason: "no_routes" };

  const configured = new Set(env.configured);
  const userKeys = userKeySet(env);

  const free: ModelRoute[] = [];
  const metered: ModelRoute[] = [];
  let sawConfigured = false;

  for (const route of routes) {
    // A user's own key makes a provider reachable exactly like an operator one.
    const usable = configured.has(route.provider) || userKeys.has(route.provider);
    if (!usable) continue;
    sawConfigured = true;
    (routeCost(route, model, env) === "free" ? free : metered).push(route);
  }

  if (!sawConfigured) {
    return { kind: "unavailable", reason: "no_configured_provider" };
  }

  if (free.length > 0) {
    return { kind: "free", route: free[0], candidates: free };
  }

  // Metered only. Somebody has to be willing to pay, and specifically for THIS
  // route's provider: holding a key for one metered provider must never
  // authorise spending on a different one.
  const payable = metered.filter(
    (r) => userKeys.has(r.provider) || env.servePaid === true,
  );
  if (payable.length > 0) {
    return { kind: "your_key", route: payable[0], candidates: payable };
  }

  // Reachable metered routes exist, but only on the operator's credential and
  // the operator has not opted to pay. Connecting a key for one of these
  // providers is what unlocks it.
  if (metered.length > 0) {
    return {
      kind: "needs_key",
      providers: [...new Set(metered.map((r) => r.provider))],
    };
  }

  return { kind: "unavailable", reason: "no_free_route" };
}

/**
 * The catalog-wide tier: could this model ever be free for someone?
 *
 * Env-independent, so it is safe for the leaderboard's access filter, the
 * `?access=` API contract, `catalogStats()`, and any SSR'd badge that renders
 * before the client knows which providers are configured. `modelAccess()` in
 * `./stats` delegates here, which is what lets ~30 existing call sites keep
 * working while the stored `access` field goes away.
 */
export function intrinsicAccess(model: RoutableModel): ModelAccess {
  const routes = model.routes ?? [];
  for (const route of routes) {
    if (routeCost(route, model, ALL_PROVIDERS) === "free") return "free";
  }
  return "byok";
}

/** Human-readable one-liner for why a model cannot be run. */
export function unavailableReason(a: Availability): string | undefined {
  if (a.kind === "needs_key") {
    const names = a.providers.map((p) => PROVIDERS[p]?.name ?? p);
    if (names.length === 0) return "Connect a provider key to use this model.";
    return `Connect your ${names.join(" or ")} key to use this model.`;
  }
  if (a.kind !== "unavailable") return undefined;
  switch (a.reason) {
    case "no_routes":
      return "No provider serves this model yet.";
    case "no_configured_provider":
      return "None of this model's providers have a key configured.";
    case "no_free_route":
      return "This model has no free route on the configured providers.";
  }
}
