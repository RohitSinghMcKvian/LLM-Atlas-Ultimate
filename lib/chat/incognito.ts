// Incognito ("temporary chat") mode — spec §4.7's "incognito writes nothing".
//
// The gate lives in a plain module, not in a zustand store, for two reasons:
//
//  1. The persistence layer (`lib/chat/repo.ts`, artifact repo, chat index) must
//     be able to consult it. Those modules are framework-free and Node-testable;
//     importing a React store into them would drag "use client" into the
//     storage layer and make the enforcement untestable.
//  2. Enforcement must not depend on a component having re-rendered. A React
//     store's value is read during render; a module-level flag is read at the
//     moment of the write, which is the only moment that matters.
//
// Deliberately NOT persisted. A remembered incognito flag would itself be a
// write, and worse, a stale one: reopening the app hours later in a mode the
// user forgot they enabled would silently discard their conversation. Incognito
// always starts off and lasts exactly one session.

let active = false;

type Listener = (active: boolean) => void;
const listeners = new Set<Listener>();

/** True when nothing from this session may be written to storage. */
export function isIncognito(): boolean {
  return active;
}

/** Enter or leave incognito. Notifies subscribers only on an actual change. */
export function setIncognito(next: boolean): void {
  if (active === next) return;
  active = next;
  for (const fn of listeners) fn(active);
}

/** Subscribe to mode changes. Returns an unsubscribe function. */
export function subscribeIncognito(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test seam: reset the module back to its initial state. */
export function resetIncognito(): void {
  active = false;
  listeners.clear();
}
