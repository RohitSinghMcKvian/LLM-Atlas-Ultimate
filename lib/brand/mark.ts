// The Atlas mark, as a standalone SVG string.
//
// `app/icon.svg` is the same drawing, but a static asset cannot be reused by the
// `next/og` routes that generate the PNG icons the Web App Manifest and the
// notification API require — both of those need raster, and Satori will not read
// a file from /public. So the geometry lives here once and both consumers build
// from it, rather than the drawing being copied into three files that then drift.
//
// Kept as a string rather than as JSX because Satori's SVG support is partial;
// rendering the whole mark as a single `<img src="data:image/svg+xml,…">` is the
// path that behaves identically across every element it supports.

/** Ink and ridge, matching the dark theme in `app/globals.css`. */
const GROUND = "#191A1C";
const INK = "#E9E9EA";
const RIDGE = "#D9752F";

export interface MarkOptions {
  /** Background fill, or `none` for a transparent plate. */
  ground?: string;
  /** Corner radius as a fraction of the viewBox. Zero for a square badge. */
  radius?: number;
  /**
   * Draw every stroke in one colour.
   *
   * Android tints a notification badge to a single flat colour and discards
   * everything else, so a badge drawn in the brand palette arrives as an
   * illegible blob. Monochrome white on transparent is what that platform
   * actually wants.
   */
  monochrome?: string;
}

export function atlasMarkSvg({ ground = GROUND, radius = 7, monochrome }: MarkOptions = {}): string {
  const ink = monochrome ?? INK;
  const ridge = monochrome ?? RIDGE;
  // The contour bands read as depth through opacity. A monochrome badge has no
  // depth to convey and every stroke has to survive being flattened, so they go
  // to full strength.
  const faint = monochrome ? "1" : "0.28";
  const mid = monochrome ? "1" : "0.5";
  const rule = monochrome ? "0" : "0.22";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  ${ground === "none" ? "" : `<rect x="0" y="0" width="32" height="32" rx="${radius}" fill="${ground}"/>`}
  <path d="M 5 25 H 27" stroke="${ink}" stroke-opacity="${rule}" stroke-width="1" stroke-linecap="round"/>
  <g fill="none" stroke-linecap="round">
    <path d="M 4.5 25 C 7.59 23.88, 11.298 17.384, 14.8 13.8 C 19.118 17.384, 23.69 23.88, 27.5 25" stroke="${ink}" stroke-opacity="${faint}" stroke-width="1.7"/>
    <path d="M 8.5 19 C 10.45 18.15, 12.79 13.22, 15 10.5 C 17.89 13.22, 20.95 18.15, 23.5 19" stroke="${ink}" stroke-opacity="${mid}" stroke-width="1.7"/>
    <path d="M 11.5 13.5 C 12.61 12.9, 13.942 9.42, 15.2 7.5 C 17.07 9.42, 19.05 12.9, 20.7 13.5" stroke="${ridge}" stroke-width="1.9"/>
  </g>
  <circle cx="15.2" cy="7.5" r="1.6" fill="${ridge}"/>
</svg>`;
}

/** The mark as a data URI, which is the form Satori and `<img>` both accept. */
export function atlasMarkDataUri(options?: MarkOptions): string {
  return `data:image/svg+xml;base64,${Buffer.from(atlasMarkSvg(options)).toString("base64")}`;
}
