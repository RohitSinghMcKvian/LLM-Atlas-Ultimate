/**
 * The agent rail's geometry, and its one-time nudge.
 *
 * Constants and one decision, in `lib/` rather than inside the component,
 * because `vitest.config.ts` only reaches `lib/` — a peek width or a nudge rule
 * chosen inside a `.tsx` file is a number nothing can assert on. The component
 * renders these; it does not decide them.
 */

/** Ties the rail's `aria-controls` to the panel it opens. */
export const AGENT_PANEL_ID = "atlas-agent-panel";

/**
 * How much of the rail stays on screen at rest, in pixels.
 *
 * Not an aesthetic number: 44 is the minimum comfortable touch target, and on a
 * touch device the resting state *is* the target — there is no hover to draw
 * the rail out first, so a tap has to land on the sliver itself. Anything
 * narrower would look better on a desktop mock and be unusable with a thumb.
 */
export const RAIL_PEEK_PX = 50;

/** Wait before the first-visit nudge, so it lands after the page has settled. */
export const NUDGE_DELAY_MS = 1_100;

/** How long the nudge holds the rail out before it withdraws. */
export const NUDGE_HOLD_MS = 1_500;

export const RAIL_SEEN_KEY = "atlas-rail-seen";

/**
 * Whether to play the one-time "here I am" nudge.
 *
 * A control that hides itself by default has a discovery problem, and the
 * honest fix is to show it once — not to animate it forever, which is how an
 * affordance becomes an irritant.
 *
 * Declined in two cases. Once it has been seen, because a nudge that repeats is
 * a nag. And under reduced motion, where an element that moves on its own is
 * precisely what the setting exists to prevent — those users get the rail
 * parked open instead, which is the same disclosure made out of position rather
 * than out of movement.
 */
export function shouldNudge(seen: boolean, reducedMotion: boolean): boolean {
  return !seen && !reducedMotion;
}

type Getter = Pick<Storage, "getItem">;
type Setter = Pick<Storage, "setItem">;

function store<T>(injected: T | undefined): T | undefined {
  if (injected) return injected;
  return typeof window === "undefined" ? undefined : (window.localStorage as unknown as T);
}

/**
 * Whether this browser has already been shown the rail.
 *
 * Never throws. Reading `localStorage` is a security error in a Safari private
 * window and in any browser with site data blocked, and a decorative nudge is
 * not worth taking a page down for — an unreadable store simply reports "not
 * seen", so the nudge plays again rather than never playing at all.
 */
export function railSeen(storage?: Getter): boolean {
  try {
    return store<Getter>(storage)?.getItem(RAIL_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markRailSeen(storage?: Setter): void {
  try {
    store<Setter>(storage)?.setItem(RAIL_SEEN_KEY, "1");
  } catch {
    /* Blocked storage: the nudge plays again next visit. That is the correct
       failure — showing it twice is a smaller cost than a thrown error. */
  }
}
