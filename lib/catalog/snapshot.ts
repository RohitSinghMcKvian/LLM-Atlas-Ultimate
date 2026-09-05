import type { RouteHealth } from "./sync/probe";
import type { CatalogModel, ProviderId } from "./types";

// The catalog snapshot — the unit of catalog truth at runtime.
//
// The catalog used to be a static module constant. It is now the live union of
// what NVIDIA NIM and OpenRouter actually serve, refreshed daily by
// `lib/catalog/sync/`, with the hand-curated 97 entries in `models.ts` acting as
// an override layer on top and as the offline baseline.
//
// This module is deliberately LIGHT: it imports nothing but types. That matters
// because it is the one catalog module the always-mounted workspace shell may
// transitively touch — see the code-split note in
// `components/shell/model-switcher.tsx`. `baseline.ts` (which pulls in all 91 KB
// of `models.ts`) must never be imported from here.

export interface CatalogStats {
  models: number;
  free: number;
  byok: number;
  /** Distinct brand/family owners (Anthropic, Meta, …). */
  brandProviders: number;
  /** Route providers the app can dispatch to. */
  routeProviders: number;
  benchmarks: number;
  upcoming: number;
  deprecated: number;
}

export type CatalogDiffKind = "new_model" | "price_change" | "deprecation";

export interface CatalogDiffEntry {
  kind: CatalogDiffKind;
  modelId: string;
  detail: string;
}

/**
 * The client-visible snapshot. This is what crosses the wire and the RSC
 * boundary, so every field here is paid for on every catalog page — keep it
 * lean. Server-only bookkeeping lives on `CatalogSnapshotRecord`.
 */
export interface CatalogSnapshot {
  /**
   * Content hash of `models`. Identical upstream data ⇒ identical version, which
   * is what lets `installSnapshot` no-op and skip a pointless re-render of every
   * catalog consumer.
   */
  version: string;
  /** ISO timestamp of the sync that produced this snapshot. */
  syncedAt: string;
  origin: "baseline" | "synced";
  models: CatalogModel[];
  stats: CatalogStats;
  /**
   * Stale, variant, or retired id → the live id that supersedes it, or `""` when
   * there is no successor. Serves both provider variant suffixes (`:free`,
   * `:nitro`) and tombstoned models, so an old URL or a persisted store value
   * still resolves. See `lib/catalog/resolve.ts`.
   */
  aliases: Record<string, string>;
  /** What changed versus the previous snapshot. Powers the sync-status UI. */
  diff: CatalogDiffEntry[];
  /** Non-fatal problems (partial sync, rejected sanity gate) — surfaced, not logged. */
  warnings: string[];
}

/** Per-provider outcome of one sync attempt. */
export interface CatalogSourceResult {
  status: "ok" | "failed" | "skipped";
  count: number;
  ms?: number;
  error?: string;
}

export interface CatalogTombstone {
  id: string;
  name: string;
  /** `non_chat` covers entries a later denylist entry withdrew (media models, meta-routers). */
  reason: "delisted" | "expired" | "replaced" | "non_chat";
  replacedBy?: string;
  lastSeenAt: string;
}

/**
 * The persisted snapshot. Extends the wire shape with bookkeeping the client has
 * no use for — its effects are already baked into `addedAt`, `status`, and
 * `aliases`. Keeping it off the wire is what holds the client payload at ~30 KB
 * gzipped for ~400 models.
 */
export interface CatalogSnapshotRecord extends CatalogSnapshot {
  sources: Partial<Record<ProviderId, CatalogSourceResult>>;
  /** id → ISO date first observed. Drives `addedAt`, so it must survive resyncs. */
  firstSeen: Record<string, string>;
  /** id → consecutive syncs the model has been absent. The grace-period counter. */
  missCount: Record<string, number>;
  /**
   * `"<provider>:<model id>"` → whether a one-token request actually reached it.
   *
   * Every zero-cost route is probed, because a provider's `/v1/models` is a
   * catalogue rather than an availability list: 11 published NVIDIA routes
   * answered `404 Function not found` and 7 hung. A definitively dead route is
   * pruned from `routes[]`, which is why health never needs to reach the client.
   * See `lib/catalog/sync/probe.ts`.
   */
  routeHealth: RouteHealth;
  tombstones: CatalogTombstone[];
}

export const EMPTY_STATS: CatalogStats = {
  models: 0,
  free: 0,
  byok: 0,
  brandProviders: 0,
  routeProviders: 0,
  benchmarks: 0,
  upcoming: 0,
  deprecated: 0,
};

/**
 * The pre-install sentinel. Selectors treat it as "nothing installed yet" and
 * fall back to the bundled baseline, so a module that never sees a snapshot
 * behaves exactly as it did before the catalog became dynamic.
 */
export const EMPTY_SNAPSHOT: CatalogSnapshot = {
  version: "empty",
  syncedAt: "1970-01-01T00:00:00.000Z",
  origin: "baseline",
  models: [],
  stats: EMPTY_STATS,
  aliases: {},
  diff: [],
  warnings: [],
};

/** Strip the server-only bookkeeping before serializing to a client. */
export function toWireSnapshot(record: CatalogSnapshot): CatalogSnapshot {
  return {
    version: record.version,
    syncedAt: record.syncedAt,
    origin: record.origin,
    models: record.models,
    stats: record.stats,
    aliases: record.aliases,
    diff: record.diff,
    warnings: record.warnings,
  };
}

// --- The pointer -----------------------------------------------------------
//
// Exactly two places may write it:
//   1. `components/catalog/catalog-scope.tsx`, in its render body, from a
//      server-serialized prop — so SSR and hydration read the same object.
//   2. A post-hydration effect in the two `ssr: false` shell widgets.
//
// `runSync()` deliberately does NOT install: it persists and revalidates. A
// write from anywhere else risks tearing a render that is already in progress.

// Held on `globalThis`, not in module scope.
//
// The app deliberately code-splits the catalog out of the always-mounted shell
// (`components/shell/model-switcher.tsx`), so several `next/dynamic` chunks
// import this module across async boundaries. A plain module variable gives each
// of those chunks its own pointer: one would serve the synced catalog while
// another silently fell back to the bundled baseline — which is exactly the bug
// that showed up as a dynamically-imported consumer re-fetching a catalog the
// page had already installed. The server store keys its own cache the same way,
// for the same reason.
const STATE_KEY = Symbol.for("atlas.catalog.snapshotPointer");

interface PointerState {
  current: CatalogSnapshot;
  listeners: Set<() => void>;
}

type PointerHost = typeof globalThis & { [STATE_KEY]?: PointerState };

function state(): PointerState {
  const host = globalThis as PointerHost;
  return (host[STATE_KEY] ??= { current: EMPTY_SNAPSHOT, listeners: new Set() });
}

export function activeSnapshot(): CatalogSnapshot {
  return state().current;
}

/**
 * Point the catalog at `next`. Idempotent (so React StrictMode's double render
 * is free) and monotonic (so concurrent server requests and a client that
 * already fetched something newer converge instead of thrashing).
 *
 * @returns whether the pointer actually moved.
 */
export function installSnapshot(next?: CatalogSnapshot | null): boolean {
  const s = state();
  if (!next || next === s.current) return false;
  if (next.version === s.current.version) return false;
  // Never go backwards in time — except from the sentinel, which has no time.
  if (s.current !== EMPTY_SNAPSHOT && next.syncedAt < s.current.syncedAt) return false;

  s.current = next;
  notify(s);
  return true;
}

/**
 * Tell subscribers the pointer moved — on the next microtask, not now.
 *
 * `CatalogScope` installs from its *render body*, deliberately, so that the tree
 * beneath it renders against the same snapshot the server serialized. That is
 * still exactly what happens: `s.current` moves synchronously above, so anything
 * rendering below reads the new catalog immediately.
 *
 * What cannot happen synchronously is the notification. Subscribers reach the
 * pointer through `useSyncExternalStore`, and several of them — the topbar
 * switcher, the command palette, `<CatalogHeal />` — are mounted *elsewhere* in
 * the tree. Calling their listeners mid-render is React's
 * "Cannot update a component while rendering a different component", which is a
 * genuine tearing hazard and not merely a noisy warning. Deferring by one
 * microtask lands the update in its own pass, after the render that moved the
 * pointer has committed.
 */
function notify(s: PointerState): void {
  if (s.listeners.size === 0) return;
  queueMicrotask(() => {
    for (const listener of s.listeners) listener();
  });
}

export function subscribeSnapshot(listener: () => void): () => void {
  const { listeners } = state();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only: drop back to the pre-install sentinel. */
export function resetSnapshot(): void {
  const s = state();
  s.current = EMPTY_SNAPSHOT;
  for (const listener of s.listeners) listener();
}
