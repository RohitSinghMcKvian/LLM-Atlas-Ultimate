// Tumbling-window arithmetic for the quota ledger.
//
// Everything here is UTC, deliberately. Provider quotas reset on UTC
// boundaries — Groq, OpenRouter and Anthropic all document a UTC daily reset —
// so matching them is both more correct and strictly simpler: a UTC day is
// always exactly 86 400 000 ms, which means the whole class of daylight-saving
// bugs (a 23- or 25-hour local day, a window that repeats or vanishes on the
// changeover) cannot arise. `windows.test.ts` pins that with a DST-boundary
// case so nobody "helpfully" localises this later.

export type WindowKind = "minute" | "day" | "month";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * Start of the tumbling window containing `now`, as epoch ms.
 *
 * Tumbling rather than sliding: a window is a fixed calendar slot every caller
 * agrees on without coordination, which is what lets several server instances
 * increment the same row. A sliding window would need per-caller history.
 */
export function windowStart(kind: WindowKind, now: number): number {
  if (kind === "minute") return Math.floor(now / MINUTE_MS) * MINUTE_MS;
  if (kind === "day") return Math.floor(now / DAY_MS) * DAY_MS;
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/**
 * When the window containing `now` rolls over — i.e. the first instant of the
 * next window, which is the reset time shown to the user.
 *
 * Months are the only non-uniform case: `Date.UTC` with a month index of 12
 * rolls the year over on its own, so December needs no special case.
 */
export function windowEnd(kind: WindowKind, now: number): number {
  if (kind === "minute") return windowStart("minute", now) + MINUTE_MS;
  if (kind === "day") return windowStart("day", now) + DAY_MS;
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/**
 * The window's stable identity, used as part of the ledger's primary key.
 *
 * An ISO timestamp rather than the raw epoch number so a row is legible in the
 * Supabase table editor — diagnosing "why was this caller blocked" is otherwise
 * a manual conversion every time.
 */
export function windowKey(kind: WindowKind, now: number): string {
  return new Date(windowStart(kind, now)).toISOString();
}

/** Milliseconds until the window rolls over. Never negative. */
export function msUntilReset(kind: WindowKind, now: number): number {
  return Math.max(0, windowEnd(kind, now) - now);
}
