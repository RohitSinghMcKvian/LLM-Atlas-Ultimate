import type {
  CatalogDiffEntry,
  CatalogSnapshotRecord,
  CatalogSourceResult,
  CatalogTombstone,
} from "../snapshot";
import { computeCatalogStats } from "../stats";
import type { BenchmarkScore, CatalogModel, ProviderId } from "../types";
import { isDeniedAtlasId } from "./denylist";
import { fnv1a, matchKey } from "./normalize";
import { readHealth, type RouteHealth } from "./probe";
import { draftFromNvidiaId } from "./nvidia";
import type { ModelDraft, NvidiaModel } from "./types";

// Reconciliation: fold the live provider lists into the curated overlay and
// decide what is new, what changed, and what is gone.
//
// Two rules dominate everything else here.
//
// 1. **The curated id wins.** When a synced draft matches a curated entry, the
//    merged model keeps the curated id verbatim. Every `/chat?model=…` link,
//    every persisted `activeModelId`, and every default-model constant in the app
//    keeps resolving across a catalog that is otherwise regenerated daily.
//
// 2. **A failed provider removes nothing.** If a provider list did not come back
//    `ok`, its models are carried forward untouched and no removal is even
//    considered for them. A transient 500 must never delete hundreds of models,
//    and the sanity gates below are the second line of defence for the same
//    failure mode.

/**
 * Failover order for `routes[]`.
 *
 * `streamChatEvents()` walks routes in order and only falls through on 429/5xx,
 * so this is a real priority list, not decoration: operator-funded and fastest
 * providers first, the user's own key last.
 */
export const ROUTE_PRIORITY: ProviderId[] = [
  "nvidia",
  "groq",
  "google",
  "openrouter",
  "local",
];

/**
 * Providers whose full model list the sync engine can enumerate. Only these are
 * eligible for route pruning and removal — a `google`, `groq`, or `local` route
 * cannot be verified, so it is always preserved.
 */
const ENUMERABLE_PROVIDERS: ProviderId[] = ["openrouter", "nvidia"];

/** Consecutive absent syncs before a model is removed outright. */
export const REMOVAL_GRACE_SYNCS = 2;

/** Relative blended-price change that counts as a price change worth reporting. */
const PRICE_CHANGE_THRESHOLD = 0.01;

export interface MergeInput {
  /** The curated catalog — `BASELINE_SNAPSHOT.models`. */
  overlay: CatalogModel[];
  /** OpenRouter drafts, or `null` when that list could not be fetched. */
  openrouter: ModelDraft[] | null;
  /** Chat-capable NIM entries, or `null` when that list could not be fetched. */
  nvidia: NvidiaModel[] | null;
  /** The last persisted record, if any. */
  previous: CatalogSnapshotRecord | null;
  sources: Partial<Record<ProviderId, CatalogSourceResult>>;
  /** ISO timestamp for this run. */
  now: string;
  warnings?: string[];
  /**
   * Probe verdicts for NVIDIA-only models, keyed by upstream model id. A model
   * with no `true` verdict is withheld — see `lib/catalog/sync/probe.ts`.
   */
  routeHealth?: RouteHealth;
}

function blended(pricing: CatalogModel["pricing"]): number {
  return (pricing.inputPerM * 3 + pricing.outputPerM) / 4;
}

function routeKey(r: CatalogModel["routes"][number]): string {
  return `${r.provider}:${r.model}`;
}

function routeRank(provider: ProviderId): number {
  const i = ROUTE_PRIORITY.indexOf(provider);
  // `indexOf` returns -1 for a provider missing from the list, which would sort
  // it *ahead* of nvidia. Send unknowns to the back instead.
  return i === -1 ? 99 : i;
}

function sortRoutes(routes: CatalogModel["routes"]): CatalogModel["routes"] {
  // Stable within a provider, so a `:free` route keeps its position ahead of the
  // paid twin the OpenRouter adapter placed it before.
  return [...routes].sort((a, b) => routeRank(a.provider) - routeRank(b.provider));
}

function dedupeRoutes(routes: CatalogModel["routes"]): CatalogModel["routes"] {
  const seen = new Set<string>();
  const out: CatalogModel["routes"] = [];
  for (const r of routes) {
    const key = routeKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Merge benchmark scores, curated winning on any shared key.
 *
 * A synced score's `measuredAt` is carried over from the previous snapshot when
 * the score itself has not moved — otherwise every benchmark on every model
 * would restamp daily and no snapshot would ever hash equal to the last.
 */
function mergeBenchmarks(
  curated: BenchmarkScore[],
  synced: BenchmarkScore[],
  previous: BenchmarkScore[] | undefined,
): BenchmarkScore[] {
  const byKey = new Map<string, BenchmarkScore>();
  const previousByKey = new Map((previous ?? []).map((b) => [b.key, b]));

  for (const b of synced) {
    const before = previousByKey.get(b.key);
    byKey.set(b.key, before && before.score === b.score ? before : b);
  }
  for (const b of curated) byKey.set(b.key, b);

  return Array.from(byKey.values());
}

/**
 * Keep the previous `effectiveFrom` when the numbers have not moved, so an
 * unchanged price does not look like a fresh price every day.
 */
function stablePricing(
  next: CatalogModel["pricing"],
  previous: CatalogModel["pricing"] | undefined,
): CatalogModel["pricing"] {
  if (
    previous &&
    previous.inputPerM === next.inputPerM &&
    previous.outputPerM === next.outputPerM &&
    previous.cachedInputPerM === next.cachedInputPerM
  ) {
    return { ...next, effectiveFrom: previous.effectiveFrom };
  }
  return next;
}

/**
 * Layer the curated entry over a synced draft.
 *
 * The split is by *who can know*. Provider APIs are authoritative for what they
 * serve — context, pricing, capabilities, status, routes. The curated catalog is
 * authoritative for editorial and measured judgment — names, families, blurbs,
 * access tier, benchmark scores, latency, throughput, rating, `trending`.
 *
 * A `derived` draft (NVIDIA-only, metadata reconstructed from the id) loses to
 * curated data on every mechanical field too: a hand-audited context window
 * beats a family-table guess.
 */
function applyOverlay(
  draft: ModelDraft,
  curated: CatalogModel,
  previous: CatalogModel | undefined,
  keptRoutes: CatalogModel["routes"],
): CatalogModel {
  const verified = draft.model.metaConfidence !== "derived";
  const d = draft.model;

  const merged: CatalogModel = {
    id: curated.id,
    name: curated.name,
    provider: curated.provider,
    family: curated.family,
    license: curated.license,
    // `access` is deliberately NOT carried over. The curated field was audited
    // when every free model was NVIDIA-served; once the sync began attaching live
    // OpenRouter routes it went stale, and 38 entries claimed "free" while their
    // only live route was a metered endpoint answering 402. Access is derived from
    // `routes` at read time — see `lib/catalog/availability.ts`.
    ...(curated.trending ? { trending: true } : {}),
    // The provider is listing it, so it is servable — a curated `upcoming` is
    // stale the moment a route appears. This is how an announced model becomes
    // a live one without a code change.
    status: d.status,
    releaseDate: curated.releaseDate,
    contextWindow: verified ? d.contextWindow : curated.contextWindow,
    maxOutput: verified ? d.maxOutput : curated.maxOutput,
    modalities: verified ? d.modalities : curated.modalities,
    capabilities: verified ? d.capabilities : curated.capabilities,
    pricing: verified
      ? stablePricing(d.pricing, previous?.pricing ?? curated.pricing)
      : curated.pricing,
    benchmarks: mergeBenchmarks(curated.benchmarks, d.benchmarks, previous?.benchmarks),
    ...(curated.latencyMs !== undefined ? { latencyMs: curated.latencyMs } : {}),
    ...(curated.throughputTps !== undefined ? { throughputTps: curated.throughputTps } : {}),
    ...(curated.rating !== undefined ? { rating: curated.rating } : {}),
    blurb: curated.blurb,
    routes: sortRoutes(dedupeRoutes([...d.routes, ...keptRoutes])),
    tags: Array.from(new Set([...(curated.tags ?? []), ...(d.tags ?? [])])),
    metaConfidence: "verified",
  };

  return merged;
}

function draftToModel(
  draft: ModelDraft,
  id: string,
  previous: CatalogModel | undefined,
  keptRoutes: CatalogModel["routes"] = [],
): CatalogModel {
  const d = draft.model;
  return {
    id,
    ...d,
    pricing: stablePricing(d.pricing, previous?.pricing),
    benchmarks: mergeBenchmarks([], d.benchmarks, previous?.benchmarks),
    releaseDate: previous?.releaseDate ?? d.releaseDate,
    routes: sortRoutes(dedupeRoutes([...d.routes, ...keptRoutes])),
  };
}

/**
 * Routes we have no standing to remove this run: those on a provider whose list
 * we could not enumerate, plus those a fetched list still confirms. Drawn from
 * both the curated entry and the previous snapshot, because either may hold a
 * route the current run's drafts do not carry.
 */
function survivingRoutes(
  curated: CatalogModel | undefined,
  previous: CatalogModel | undefined,
  survives: (route: CatalogModel["routes"][number]) => boolean,
): CatalogModel["routes"] {
  return dedupeRoutes(
    [...(curated?.routes ?? []), ...(previous?.routes ?? [])].filter(survives),
  );
}

/**
 * Reuse the previous object when the merge produced something structurally
 * identical. Selectors and `intelligenceIndex` cache on object identity, so
 * this keeps every unchanged model's cached derivations warm across a sync.
 */
function preserveIdentity(next: CatalogModel, previous: CatalogModel | undefined): CatalogModel {
  if (previous && JSON.stringify(previous) === JSON.stringify(next)) return previous;
  return next;
}

interface MatchIndex {
  byRoute: Map<string, CatalogModel>;
  byMatchKey: Map<string, CatalogModel>;
  byId: Map<string, CatalogModel>;
}

/**
 * Index the overlay for draft matching, strongest signal first.
 *
 * `byRoute` is the one that matters. A curated entry records the *exact* upstream
 * model id it routes to, so an identical id in a provider list is proof of the
 * same model — no normalization required. Name-based matching cannot see through
 * a version suffix (`amazon/nova-lite-v1` vs the curated `nova-lite`), and
 * without this index those models look delisted and get retired despite being
 * live.
 *
 * `matchKey` is the lossy fallback for models whose upstream id has changed. An
 * ambiguous key (two curated entries colliding) is dropped rather than allowed to
 * merge two distinct models into one.
 */
function indexOverlay(overlay: CatalogModel[]): MatchIndex {
  const byId = new Map<string, CatalogModel>();
  const byRoute = new Map<string, CatalogModel>();
  const counts = new Map<string, number>();
  const byMatchKey = new Map<string, CatalogModel>();

  for (const m of overlay) {
    byId.set(m.id, m);
    for (const r of m.routes) {
      byRoute.set(routeKey(r), m);
      // A `:free` route and its paid twin both point at the same model.
      byRoute.set(`${r.provider}:${stripVariantSuffix(r.model)}`, m);
    }
    const key = matchKey(m.id);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    byMatchKey.set(key, m);
  }
  for (const [key, count] of counts) {
    if (count > 1) byMatchKey.delete(key);
  }

  return { byRoute, byMatchKey, byId };
}

function stripVariantSuffix(model: string): string {
  const colon = model.indexOf(":");
  return colon === -1 ? model : model.slice(0, colon);
}

/** The curated entry a draft corresponds to, or undefined. */
function matchOverlay(draft: ModelDraft, index: MatchIndex): CatalogModel | undefined {
  for (const r of draft.model.routes) {
    const hit = index.byRoute.get(routeKey(r)) ?? index.byRoute.get(`${r.provider}:${stripVariantSuffix(r.model)}`);
    if (hit) return hit;
  }
  return index.byId.get(draft.atlasId) ?? index.byMatchKey.get(draft.matchKey);
}

export function mergeSnapshot(input: MergeInput): CatalogSnapshotRecord {
  const { overlay, previous, sources, now } = input;
  const today = now.slice(0, 10);
  const warnings = [...(input.warnings ?? [])];

  const enumerable = new Set<ProviderId>(
    ENUMERABLE_PROVIDERS.filter((p) => sources[p]?.status === "ok"),
  );
  const canPrune = (provider: ProviderId) => enumerable.has(provider);

  const previousById = new Map((previous?.models ?? []).map((m) => [m.id, m]));
  const overlayIndex = indexOverlay(overlay);

  // --- 1. Collect drafts, folding NVIDIA into OpenRouter where they overlap ---

  const routeHealth: RouteHealth = { ...(previous?.routeHealth ?? {}), ...(input.routeHealth ?? {}) };
  const withheld: string[] = [];

  const drafts: ModelDraft[] = [];
  const draftByMatchKey = new Map<string, ModelDraft>();
  // Upstream route id → the draft holding it. The strongest identity signal there
  // is: two providers naming the exact same model id are unambiguously the same
  // model, where `matchKey` cannot see through a spec suffix
  // (`meta/llama-4-maverick-17b-128e-instruct` vs the curated `llama-4-maverick`).
  // Without this, widening the probe published NIM near-duplicates of curated
  // entries — two "Llama 4 Maverick" rows in the picker.
  const draftByRoute = new Map<string, ModelDraft>();
  const aliases: Record<string, string> = {};

  const indexDraft = (draft: ModelDraft) => {
    draftByMatchKey.set(draft.matchKey, draft);
    for (const r of draft.model.routes) draftByRoute.set(routeKey(r), draft);
  };

  const addDraft = (draft: ModelDraft): ModelDraft => {
    const existing =
      draftByMatchKey.get(draft.matchKey) ??
      draft.model.routes.map((r) => draftByRoute.get(routeKey(r))).find(Boolean);
    if (existing) {
      // Same model from a second provider — merge routes rather than duplicate.
      existing.model.routes = dedupeRoutes([...existing.model.routes, ...draft.model.routes]);
      for (const p of draft.sourceProviders) {
        if (!existing.sourceProviders.includes(p)) existing.sourceProviders.push(p);
      }
      if (draft.atlasId !== existing.atlasId) existing.aliasIds.push(draft.atlasId);
      indexDraft(existing);
      return existing;
    }
    indexDraft(draft);
    drafts.push(draft);
    return draft;
  };

  for (const draft of input.openrouter ?? []) addDraft(draft);

  // Which draft will claim each curated entry. A curated model records the exact
  // upstream ids it routes to on *every* provider, so this is how a NIM id finds
  // the OpenRouter draft that is already going to become that curated model —
  // neither `matchKey` nor the draft's own routes can bridge that gap.
  const draftByOverlayId = new Map<string, ModelDraft>();
  for (const draft of drafts) {
    const curated = matchOverlay(draft, overlayIndex);
    if (curated && !draftByOverlayId.has(curated.id)) draftByOverlayId.set(curated.id, draft);
  }

  for (const nv of input.nvidia ?? []) {
    const key = matchKey(nv.id);
    const nvRouteKey = routeKey({ provider: "nvidia", model: nv.id });
    const viaOverlay = overlayIndex.byRoute.get(nvRouteKey);
    const existing =
      draftByMatchKey.get(key) ??
      draftByRoute.get(nvRouteKey) ??
      (viaOverlay ? draftByOverlayId.get(viaOverlay.id) : undefined);
    if (existing) {
      // NIM serves it on the operator's key, so it leads the failover order.
      //
      // Deliberately no longer sets `access = "free"`. A NIM *listing* is not a
      // guarantee: 11 of the routes published this way answered `404 Function not
      // found` and 7 hung. Freeness is derived from the surviving routes by
      // `lib/catalog/availability.ts`, and `survives` below drops the route once
      // a probe condemns it — so a dead NIM listing can no longer make a paid
      // model masquerade as free.
      existing.model.routes = dedupeRoutes([
        { provider: "nvidia", model: nv.id },
        ...existing.model.routes,
      ]);
      if (!existing.sourceProviders.includes("nvidia")) existing.sourceProviders.push("nvidia");
      continue;
    }
    // NIM-only: no OpenRouter listing corroborates it, so it must have passed a
    // liveness probe. Unknown verdicts are withheld, not published — a model that
    // 404s the moment a user selects it is worse than one we do not offer yet.
    if (readHealth(routeHealth, "nvidia", nv.id)?.ok !== true) {
      withheld.push(nv.id);
      continue;
    }
    const draft = draftFromNvidiaId(nv, { today });
    if (draft) addDraft(draft);
  }

  // --- 1b. Drop routes a probe condemned ---

  // Must happen before `liveRouteKeys` is built, and before any draft is turned
  // into a model. A draft's routes come straight from the provider *listing*, and
  // a listing is not an availability guarantee: 11 NVIDIA routes published this
  // way answered `404 Function not found`. Filtering only the curated/previous
  // routes (which is all `survivingRoutes` below does) misses exactly these,
  // because the dead route is re-attached fresh from the listing on every sync.
  const healthyRoute = (r: CatalogModel["routes"][number]) =>
    readHealth(routeHealth, r.provider, r.model)?.ok !== false;

  const liveDrafts: ModelDraft[] = [];
  for (const draft of drafts) {
    const kept = draft.model.routes.filter(healthyRoute);
    if (kept.length === 0) {
      // Every route is known-dead. Let the carry-forward grace period handle it
      // rather than publishing a model nothing can serve.
      withheld.push(draft.atlasId);
      continue;
    }
    if (kept.length !== draft.model.routes.length) draft.model.routes = kept;
    liveDrafts.push(draft);
  }
  drafts.length = 0;
  drafts.push(...liveDrafts);

  // --- 2. Resolve final ids and merge with the overlay ---

  // Every route a fetched provider list confirms exists right now. A route that
  // is *not* here and *is* on an enumerable provider is the only kind we may
  // prune. Note a NIM listing counts: the probe gates whether an unlisted-by-
  // OpenRouter model may be published as a new entry, not whether a route we
  // already knew about is still real.
  const liveRouteKeys = new Set<string>();
  for (const draft of drafts) {
    for (const r of draft.model.routes) liveRouteKeys.add(routeKey(r));
  }
  for (const nv of input.nvidia ?? []) liveRouteKeys.add(`nvidia:${nv.id}`);

  const survives = (r: CatalogModel["routes"][number]) => {
    // A probe that definitively failed outranks the listing: a provider
    // advertising a model it will not serve is exactly the case the probe exists
    // to catch, and an already-published entry should be pruned once we know it
    // is dead. Applies to every probed provider, not just NVIDIA — Groq and
    // Google get probed too once their keys are present.
    if (readHealth(routeHealth, r.provider, r.model)?.ok === false) return false;
    return !canPrune(r.provider) || liveRouteKeys.has(routeKey(r));
  };

  const models: CatalogModel[] = [];
  const claimedIds = new Set<string>();
  const consumedOverlayIds = new Set<string>();
  const sourceProvidersById = new Map<string, ProviderId[]>();

  for (const draft of drafts) {
    const curated = matchOverlay(draft, overlayIndex);

    let id: string;
    let model: CatalogModel;

    if (curated && !consumedOverlayIds.has(curated.id)) {
      consumedOverlayIds.add(curated.id);
      id = curated.id;
      // Routes on providers we could not enumerate are unverifiable, so they
      // survive; routes on providers we did enumerate are replaced by live truth.
      // Both the curated entry and the last snapshot can hold such routes — a
      // model discovered on NIM while OpenRouter is down must not lose the
      // OpenRouter route we already knew about.
      const keptRoutes = survivingRoutes(curated, previousById.get(curated.id), survives);
      model = applyOverlay(draft, curated, previousById.get(curated.id), keptRoutes);
    } else {
      id = draft.atlasId;
      if (claimedIds.has(id)) {
        // Two drafts resolved to the same public id. Keep the first and alias the
        // loser so an inbound link still lands somewhere sensible.
        aliases[`${id}-dup`] = id;
        continue;
      }
      const before = previousById.get(id);
      model = draftToModel(draft, id, before, survivingRoutes(undefined, before, survives));
    }

    if (claimedIds.has(id)) continue;
    claimedIds.add(id);

    for (const alias of draft.aliasIds) {
      if (alias && alias !== id) aliases[alias] = id;
    }
    if (draft.atlasId !== id) aliases[draft.atlasId] = id;

    sourceProvidersById.set(id, draft.sourceProviders);
    models.push(model);
  }

  // --- 3. Carry-forward and the removal grace period ---

  const missCount: Record<string, number> = {};
  const tombstones: CatalogTombstone[] = [...(previous?.tombstones ?? [])];
  const newTombstones: CatalogTombstone[] = [];

  // Everything that existed before, preferring the curated version when there is
  // one so editorial fixes still land on carried-forward entries.
  const carryCandidates = new Map<string, CatalogModel>();
  for (const m of previous?.models ?? []) carryCandidates.set(m.id, m);
  for (const m of overlay) carryCandidates.set(m.id, m);

  for (const [id, candidate] of carryCandidates) {
    if (claimedIds.has(id)) continue;

    // Withdraw anything the denylist now covers. Without this the carry-forward
    // re-admits it every run, so a model that predates a denylist entry — the
    // Lyria music models and the OpenRouter meta-routers both did — would survive
    // forever. Tombstoning here means the fix self-heals on the next sync with no
    // manual database step.
    if (isDeniedAtlasId(id, candidate.routes)) {
      const tombstone: CatalogTombstone = {
        id,
        name: candidate.name,
        reason: "non_chat",
        lastSeenAt: previous?.syncedAt ?? candidate.addedAt ?? candidate.releaseDate,
      };
      newTombstones.push(tombstone);
      tombstones.push(tombstone);
      aliases[id] = "";
      claimedIds.add(id);
      continue;
    }

    // Announced-but-unreleased models are forward-looking by design: they have no
    // routes and were never expected in a provider list.
    if (candidate.status === "upcoming") {
      models.push(candidate);
      claimedIds.add(id);
      continue;
    }

    // A route is only evidence of absence when we successfully enumerated its
    // provider and it was not in the list.
    const kept = candidate.routes.filter(survives);
    if (kept.length > 0) {
      models.push(
        kept.length === candidate.routes.length
          ? candidate
          : { ...candidate, routes: sortRoutes(kept) },
      );
      claimedIds.add(id);
      continue;
    }

    // Genuinely absent from every list we successfully fetched.
    const misses = (previous?.missCount[id] ?? 0) + 1;

    if (misses < REMOVAL_GRACE_SYNCS) {
      // Grace period: keep the record but strip the dead routes and mark it
      // deprecated, which hides it from every picker while leaving it visible in
      // the leaderboard. One bad upstream response therefore costs a badge, not
      // a deletion.
      missCount[id] = misses;
      models.push({ ...candidate, status: "deprecated", routes: [] });
      claimedIds.add(id);
      continue;
    }

    // Confirmed gone across consecutive syncs — remove it entirely.
    const tombstone: CatalogTombstone = {
      id,
      name: candidate.name,
      reason: candidate.status === "deprecated" ? "expired" : "delisted",
      lastSeenAt: previous?.syncedAt ?? candidate.addedAt ?? candidate.releaseDate,
    };
    newTombstones.push(tombstone);
    tombstones.push(tombstone);
    aliases[id] = "";
  }

  // A model that came back clears its counter implicitly: `missCount` is rebuilt
  // from scratch each run and only carries entries still absent.

  // --- 4. firstSeen / addedAt ---

  const firstSeen: Record<string, string> = { ...(previous?.firstSeen ?? {}) };
  const firstSync = !previous || previous.origin === "baseline";

  if (firstSync) {
    // Seed from the curated dates so the very first sync does not present ~300
    // pre-existing models as brand new in the "New & Notable" rail and the news
    // feed.
    for (const m of models) {
      firstSeen[m.id] ??= m.addedAt ?? m.releaseDate ?? today;
    }
  }

  const withAddedAt = models.map((m) => {
    firstSeen[m.id] ??= today;
    const addedAt = firstSeen[m.id];
    if (m.addedAt === addedAt) return m;
    return { ...m, addedAt };
  });

  // --- 5. Deterministic order, then identity preservation ---

  withAddedAt.sort(
    (a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );

  const finalModels = withAddedAt.map((m) => preserveIdentity(m, previousById.get(m.id)));

  // --- 6. Diff ---

  const diff: CatalogDiffEntry[] = [];
  if (!firstSync) {
    for (const m of finalModels) {
      const before = previousById.get(m.id);
      if (!before) {
        diff.push({
          kind: "new_model",
          modelId: m.id,
          detail: `${m.name} (${m.provider}) added`,
        });
        continue;
      }
      if (before.status !== "deprecated" && m.status === "deprecated") {
        diff.push({
          kind: "deprecation",
          modelId: m.id,
          detail: `${m.name} was delisted upstream`,
        });
      }
      const was = blended(before.pricing);
      const is = blended(m.pricing);
      if (was > 0 && Math.abs(is - was) / was > PRICE_CHANGE_THRESHOLD) {
        const direction = is < was ? "down" : "up";
        diff.push({
          kind: "price_change",
          modelId: m.id,
          detail: `${m.name} blended price ${direction} $${was.toFixed(2)} → $${is.toFixed(2)} /Mtok`,
        });
      }
    }
    for (const t of newTombstones) {
      diff.push({
        kind: "deprecation",
        modelId: t.id,
        detail: `${t.name} removed — no longer served by any provider`,
      });
    }
  }

  // --- 7. Version, stats, warnings ---

  const version = fnv1a(JSON.stringify(finalModels));
  const stats = computeCatalogStats(finalModels);

  for (const provider of ENUMERABLE_PROVIDERS) {
    const source = sources[provider];
    if (source && source.status === "failed") {
      warnings.push(
        `${provider} model list unavailable (${source.error ?? "unknown error"}) — its models were carried forward unchanged.`,
      );
    }
  }

  const candidate: CatalogSnapshotRecord = {
    version,
    syncedAt: now,
    origin: enumerable.size > 0 ? "synced" : "baseline",
    models: finalModels,
    stats,
    aliases: { ...(previous?.aliases ?? {}), ...aliases },
    diff,
    warnings,
    sources,
    firstSeen,
    missCount,
    routeHealth,
    tombstones,
  };

  // --- 8. Sanity gates ---

  const rejection = checkSanity(candidate, { overlay, previous, enumerable });
  if (rejection) {
    // Keep serving what we already had. Bookkeeping is *not* advanced, so a
    // rejected run cannot push a model closer to removal.
    // With no previous record to fall back on, the bundled catalog is the
    // safe answer.
    const base: CatalogSnapshotRecord = previous ?? {
      ...candidate,
      models: overlay,
      stats: computeCatalogStats(overlay),
      origin: "baseline",
      diff: [],
      aliases: {},
      firstSeen: {},
      missCount: {},
      routeHealth: {},
      tombstones: [],
    };

    return {
      ...base,
      syncedAt: now,
      sources,
      warnings: [...warnings, rejection],
    };
  }

  return candidate;
}

interface SanityContext {
  overlay: CatalogModel[];
  previous: CatalogSnapshotRecord | null;
  enumerable: Set<ProviderId>;
}

/**
 * Reasons to distrust a freshly-built snapshot and keep the previous one.
 *
 * These exist because the failure mode is asymmetric: a sync that adds nothing is
 * invisible, while a sync that deletes most of the catalog takes the whole
 * product down. Every gate is a shape that a real upstream change essentially
 * never has and an upstream *bug* frequently does.
 */
export function checkSanity(
  candidate: CatalogSnapshotRecord,
  { overlay, previous, enumerable }: SanityContext,
): string | null {
  const count = candidate.models.length;

  if (enumerable.size === 0) {
    return "No provider model list could be fetched — keeping the previous catalog.";
  }

  // The bundled catalog is a floor: a synced snapshot smaller than what ships in
  // the app is definitionally wrong.
  if (count < overlay.length) {
    return `Sync produced ${count} models, fewer than the ${overlay.length} bundled — keeping the previous catalog.`;
  }

  if (count > 600) {
    return `Sync produced ${count} models, above the 600 sanity ceiling — keeping the previous catalog.`;
  }

  // Mass deprecation is the failure mode the size gates miss entirely. A provider
  // that returns a *truncated* list (rather than an error) keeps the catalog the
  // same size — every missing model is carried forward into the grace period —
  // while quietly pulling most of the catalog out of every picker, and setting up
  // a real deletion on the next run.
  const newlyMissing = Object.keys(candidate.missCount).length;
  const base = Math.max(previous?.models.length ?? 0, overlay.length);
  if (newlyMissing >= 3 && newlyMissing > base * 0.2) {
    return `${newlyMissing} of ${base} models went missing in one sync — suspected truncated provider response, keeping the previous catalog.`;
  }

  if (previous && previous.models.length > 0) {
    const floor = Math.floor(previous.models.length * 0.8);
    if (count < floor) {
      return `Sync produced ${count} models, a drop of more than 20% from ${previous.models.length} — keeping the previous catalog.`;
    }

    const previousIds = new Set(previous.models.map((m) => m.id));
    const currentIds = new Set(candidate.models.map((m) => m.id));
    const removed = [...previousIds].filter((id) => !currentIds.has(id)).length;
    const anyFailed = Object.values(candidate.sources).some((s) => s?.status === "failed");
    if (anyFailed && removed > previous.models.length * 0.05) {
      return `A provider list failed and ${removed} models would be removed — keeping the previous catalog.`;
    }

    // A units change upstream (per-token quoted as per-million, say) shows up as
    // a synchronized, enormous price move across the catalog.
    const previousById = new Map(previous.models.map((m) => [m.id, m]));
    let wild = 0;
    let compared = 0;
    for (const m of candidate.models) {
      const before = previousById.get(m.id);
      if (!before) continue;
      const was = blended(before.pricing);
      if (was <= 0) continue;
      compared++;
      if (Math.abs(blended(m.pricing) - was) / was > 0.5) wild++;
    }
    if (compared > 20 && wild > compared * 0.25) {
      return `${wild} of ${compared} models changed price by more than 50% — suspected upstream unit change, keeping the previous catalog.`;
    }
  }

  return null;
}
