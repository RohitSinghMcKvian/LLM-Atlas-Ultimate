/**
 * Accent bands — the single source of truth for every per-module, per-track and
 * per-topic tint in the product.
 *
 * There used to be five copies of this table (`lib/modules.ts`, the Flow graph,
 * the Router log, and two in Learn), each a hand-written hex list that drifted
 * from the CSS variables and had no light-mode equivalent. Everything now reads
 * from here, and everything here points at the elevation ramp — the same six
 * bands the charts, the leaderboard bars and the hero contours draw from.
 *
 * Only three of the six bands are exposed as accents. That is deliberate: the
 * ramp is an ordered scale for data, and handing every module an arbitrary
 * point on it would turn a measurement into decoration.
 */

/** A band of the elevation ramp, usable as a categorical accent. */
export type Accent = "ridge" | "shelf" | "upland";

/** CSS variable name backing each band. */
export const ACCENT_VAR: Record<Accent, string> = {
  ridge: "--elev-4",
  shelf: "--elev-1",
  upland: "--elev-3",
};

/**
 * Theme-aware `rgb()` strings. Prefer these everywhere — inline styles, SVG
 * `fill`/`stroke`, and recharts, which accepts a CSS-var string because the
 * value lands in an SVG attribute.
 */
export const ACCENT_RGB: Record<Accent, string> = {
  ridge: "rgb(var(--elev-4))",
  shelf: "rgb(var(--elev-1))",
  upland: "rgb(var(--elev-3))",
};

/** Tailwind text classes, for the `accent === "…"` branches in Learn. */
export const ACCENT_TEXT: Record<Accent, string> = {
  ridge: "text-elev-4",
  shelf: "text-elev-1",
  upland: "text-elev-3",
};

/**
 * Resolve a band to a literal hex at call time.
 *
 * Only for the handful of consumers that cannot take a CSS variable — canvas
 * 2D, Monaco, and anything serialised into a document that leaves the app.
 * Everything else should use `ACCENT_RGB`. Falls back to the dark-theme value
 * during SSR, where there is no computed style to read.
 */
const SSR_FALLBACK: Record<Accent, string> = {
  ridge: "#D9752F",
  shelf: "#2E8F8C",
  upland: "#D9B740",
};

export function accentHex(accent: Accent): string {
  if (typeof window === "undefined") return SSR_FALLBACK[accent];
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(ACCENT_VAR[accent])
    .trim();
  const parts = raw.split(/[\s,]+/).map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) {
    return SSR_FALLBACK[accent];
  }
  return `#${parts
    .slice(0, 3)
    .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0"))
    .join("")}`;
}
