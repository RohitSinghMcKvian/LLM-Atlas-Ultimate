/**
 * The one fact the always-mounted shell needs to know about Compare.
 *
 * `<CompareRunPill>` lives in the Topbar, so it is mounted on every workspace
 * route. It used to read the live run through `useCompareRun()`, which imports
 * `lib/compare/runtime.ts` — and that pulls in the lane planner, the session
 * store, the repo, and `@/lib/catalog`, whose baseline is the entire 97-model
 * catalog. Measured on the production build, that put ~135 KB of catalog plus
 * the whole compare runtime into the chunk that `/docs` and `/datasets` parse
 * before their own page code runs, to render a pill that is `null` on those
 * routes and on every route until a comparison is actually started.
 *
 * This module is the inversion: the runtime *pushes* the two numbers the pill
 * draws, and the pill subscribes to nothing else. It imports nothing at all, so
 * the shell pays a few hundred bytes instead.
 *
 * The state is deliberately in-memory only and lives on `globalThis`, for the
 * same reason `lib/catalog/snapshot.ts` does: the runtime reaches this module
 * across a `next/dynamic` boundary, and a plain module variable would give the
 * two sides separate copies — the runtime would publish into one and the pill
 * would read the other, forever empty.
 */

/** What the pill draws: answered lanes out of the lanes that will answer. */
export interface CompareLiveProgress {
  done: number;
  total: number;
}

/** The shape of a lane this module cares about. Structural, to avoid the import. */
interface LaneLike {
  status: string;
  blocked?: unknown;
}

/**
 * Turn a run's lanes into what the pill draws, or `null` when there is nothing
 * to say.
 *
 * This is the logic that used to live inside the pill component, evaluated
 * against the live run it subscribed to. It is here, and pure, because moving
 * it is what let the pill stop importing the compare runtime — so if it drifts
 * from what the pill used to show, nothing else would notice.
 *
 * Two separate judgements, and they are not the same one:
 *
 *   - *Is anything live?* A lane still `streaming` or `queued`. Once none are,
 *     the run is over and the pill goes away even though the lanes remain.
 *   - *What counts toward the total?* Every lane that is not `blocked` — a lane
 *     with no usable key never answers, so counting it would leave the pill
 *     reading `5/6` forever.
 */
export function deriveCompareProgress(lanes: readonly LaneLike[]): CompareLiveProgress | null {
  const live = lanes.some((l) => l.status === "streaming" || l.status === "queued");
  if (!live) return null;

  const answering = lanes.filter((l) => !l.blocked);
  return {
    done: answering.filter((l) => l.status === "done").length,
    total: answering.length,
  };
}

const STATE_KEY = Symbol.for("atlas.compare.livePill");

interface PillState {
  current: CompareLiveProgress | null;
  listeners: Set<() => void>;
}

type PillHost = typeof globalThis & { [STATE_KEY]?: PillState };

function state(): PillState {
  const host = globalThis as PillHost;
  return (host[STATE_KEY] ??= { current: null, listeners: new Set() });
}

function same(a: CompareLiveProgress | null, b: CompareLiveProgress | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.done === b.done && a.total === b.total;
}

/**
 * Publish progress, or `null` once nothing is in flight.
 *
 * A no-op when the numbers have not moved, which matters: the runtime commits
 * roughly every 48 ms while lanes stream, and `getSnapshot` must return a
 * stable reference or `useSyncExternalStore` will loop.
 */
export function publishCompareProgress(next: CompareLiveProgress | null): void {
  const s = state();
  if (same(s.current, next)) return;
  s.current = next;
  for (const fn of s.listeners) fn();
}

export function getCompareProgress(): CompareLiveProgress | null {
  return state().current;
}

/** Server render has no run, and must not read one from a browser-only store. */
export function getCompareProgressServer(): CompareLiveProgress | null {
  return null;
}

export function subscribeCompareProgress(fn: () => void): () => void {
  const { listeners } = state();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
