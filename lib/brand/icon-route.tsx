import { ImageResponse } from "next/og";
import { atlasMarkDataUri } from "./mark";

// PNG icon routes for the Web App Manifest and the notification API.
//
// WHY THESE ARE GENERATED RATHER THAN COMMITTED
//
// Both consumers need raster. `Notification.icon` and `Notification.badge` are
// fetched by the *operating system's* notification service, not by the page, and
// neither Android's nor Windows' will render an SVG. The manifest's `icons`
// array has the same constraint on most platforms.
//
// Committing four PNGs would mean four binaries in the repository that no longer
// match `app/icon.svg` the first time the mark is touched, and a reviewer cannot
// see that in a diff. Generating them from one source keeps the drawing honest,
// and these are immutable static responses in practice — the cache headers below
// mean each is fetched once per year per client.

export interface IconRouteOptions {
  size: number;
  /** Flatten to one colour. Required for an Android notification badge. */
  monochrome?: string;
  /** Transparent plate rather than the dark ground. */
  transparent?: boolean;
  /**
   * Pad the mark inside the canvas, as a fraction of the size.
   *
   * A maskable icon is cropped to whatever shape the launcher prefers — a
   * circle, a squircle, a rounded square — and the specification guarantees only
   * the middle 80% survives. Anything drawn to the edge loses its corners.
   */
  padding?: number;
}

export function renderIcon({
  size,
  monochrome,
  transparent,
  padding = 0,
}: IconRouteOptions): ImageResponse {
  const inset = Math.round(size * padding);
  const markSize = size - inset * 2;

  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // A maskable icon must fill its canvas edge to edge; the launcher
          // supplies the shape. A transparent badge must not.
          background: transparent ? "transparent" : padding > 0 ? "#191A1C" : "transparent",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={atlasMarkDataUri({
            ground: transparent || padding > 0 ? "none" : "#191A1C",
            // The rounding comes from the plate below on a maskable icon, and
            // from the mark itself otherwise.
            radius: padding > 0 ? 0 : 7,
            monochrome,
          })}
          width={markSize}
          height={markSize}
          alt=""
        />
      </div>
    ),
    { width: size, height: size },
  );
}

/**
 * One year, immutable.
 *
 * These bytes are a pure function of the code that produced them, so a deploy
 * that changes the mark changes the build and busts the CDN anyway. The OS
 * notification service in particular re-fetches an icon per notification if it
 * is allowed to, which on a daily brief is a request a day per subscriber for a
 * file that never changes.
 */
export const ICON_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=31536000, immutable",
  "Content-Type": "image/png",
};
