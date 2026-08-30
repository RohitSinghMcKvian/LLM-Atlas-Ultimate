// Lane identity: the elevation ramp, one band per lane.
//
// Terrain's rule is that the chrome carries exactly one hue and everything
// plural-coloured is data drawn from `--elev-0..5` in order. A comparison is the
// most plural thing in the product, so lanes take the ramp — and the ramp is why
// a run caps at six. That is a real constraint doing real work: it also bounds
// the fan-out, which the old route left unbounded.
//
// `lib/accent.ts` exposes only three bands, deliberately, because handing every
// *module* an arbitrary point on an ordered scale turns a measurement into
// decoration. Lanes are the exception the ramp was built for: they are an
// ordered set, rendered together, with a legend beneath them.

import type { Band } from "./types";

export const BANDS: readonly Band[] = [0, 1, 2, 3, 4, 5];

/** Survey names for the ramp, used in the legend and in screen-reader labels. */
export const BAND_LABEL: Record<Band, string> = {
  0: "Deep",
  1: "Shelf",
  2: "Lowland",
  3: "Upland",
  4: "Ridge",
  5: "Summit",
};

export const BAND_VAR: Record<Band, string> = {
  0: "--elev-0",
  1: "--elev-1",
  2: "--elev-2",
  3: "--elev-3",
  4: "--elev-4",
  5: "--elev-5",
};

/**
 * Theme-aware `rgb()` strings for inline styles and SVG attributes.
 *
 * Preferred over resolved hex everywhere it works: the value lands in a CSS
 * custom property or an SVG `fill`, so it follows a theme switch with no
 * re-render at all.
 */
export const BAND_RGB: Record<Band, string> = {
  0: "rgb(var(--elev-0))",
  1: "rgb(var(--elev-1))",
  2: "rgb(var(--elev-2))",
  3: "rgb(var(--elev-3))",
  4: "rgb(var(--elev-4))",
  5: "rgb(var(--elev-5))",
};

/**
 * Tailwind classes, written out in full.
 *
 * Not built by interpolation: Tailwind scans source text, so `text-elev-${n}`
 * would produce classes that exist in the markup and not in the stylesheet.
 */
export const BAND_TEXT: Record<Band, string> = {
  0: "text-elev-0",
  1: "text-elev-1",
  2: "text-elev-2",
  3: "text-elev-3",
  4: "text-elev-4",
  5: "text-elev-5",
};

export const BAND_BG: Record<Band, string> = {
  0: "bg-elev-0",
  1: "bg-elev-1",
  2: "bg-elev-2",
  3: "bg-elev-3",
  4: "bg-elev-4",
  5: "bg-elev-5",
};

export const BAND_BORDER: Record<Band, string> = {
  0: "border-elev-0",
  1: "border-elev-1",
  2: "border-elev-2",
  3: "border-elev-3",
  4: "border-elev-4",
  5: "border-elev-5",
};

/**
 * The letter a lane is known by in blind mode.
 *
 * Derived from the band rather than from the model, so revealing an identity
 * changes the name on the card and nothing else about it.
 */
export function blindLabel(band: Band): string {
  return `Lane ${String.fromCharCode(65 + band)}`;
}

/** Clamp anything to a real band, so a corrupt record cannot render colourless. */
export function toBand(n: number): Band {
  if (!Number.isFinite(n)) return 0;
  const i = Math.abs(Math.trunc(n)) % BANDS.length;
  return i as Band;
}
