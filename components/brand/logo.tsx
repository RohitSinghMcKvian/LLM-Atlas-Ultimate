"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The Atlas mark — a contour summit.
 *
 * Three nested contour lines around a peak, drawn the way a topographic sheet
 * draws one: closed at the datum, packed tight on the steep west face and
 * spread wide across the eastern shoulder, with a benchmark tick at the spot
 * height. It reads as an "A" because a summit and a capital A are the same
 * shape, which is the whole point — the name is doing the work, not a
 * decoration bolted onto it.
 *
 * Colour discipline follows the rest of the system: the two outer contours
 * take `currentColor`, so the mark sits correctly on any surface it is dropped
 * onto, and only the summit contour and its tick carry the ridge hue.
 */

/** Datum line the contours close against. */
const DATUM = 25;

/**
 * One contour line, closing at its own elevation rather than at the datum.
 *
 * That distinction is the whole shape. Run every contour down to the ground
 * and the inner ones come out tall and narrow — a spike, which reads as a
 * rocket. A contour only exists above the level it traces, so each one here is
 * a shallow arc sitting on its own `level`, and the three nest the way bands
 * do on a real sheet.
 *
 * The cubics do the rest: outer control points near the level give each flank
 * a shallow toe slope, inner ones near the apex round the crest over.
 */
function contour(
  level: number,
  left: number,
  right: number,
  apexX: number,
  apexY: number,
) {
  const h = level - apexY;
  const toe = level - 0.1 * h;
  const crest = apexY + 0.32 * h;
  return [
    `M ${left} ${level}`,
    `C ${left + 0.3 * (apexX - left)} ${toe},`,
    `${apexX - 0.34 * (apexX - left)} ${crest},`,
    `${apexX} ${apexY}`,
    `C ${apexX + 0.34 * (right - apexX)} ${crest},`,
    `${right - 0.3 * (right - apexX)} ${toe},`,
    `${right} ${level}`,
  ].join(" ");
}

/**
 * The three contours, lowest elevation first, at levels 25 / 19 / 13.5.
 *
 * Each apex sits a little left of centre, which shortens the west flank
 * against the east one — contours crowding a cliff on one side and opening out
 * over a dip slope on the other, rather than a symmetrical triangle.
 */
const CONTOURS = [
  { d: contour(DATUM, 4.5, 27.5, 14.8, 13.8), opacity: 0.28 },
  { d: contour(19, 8.5, 23.5, 15, 10.5), opacity: 0.5 },
  { d: contour(13.5, 11.5, 20.7, 15.2, 7.5), opacity: 1 },
] as const;

/** Below this the outermost contour closes up into mud — drop it. */
const COLLAPSE_PX = 18;

function Contours({
  size,
  className,
  /** Per-ring animation timing, applied inline. Tailwind's JIT cannot see a
   *  template-literal arbitrary class, so this has to be a style. */
  ringStyle,
}: {
  size: number;
  /** Applied to every contour path. */
  className?: string;
  ringStyle?: (index: number) => React.CSSProperties;
}) {
  const rings = size <= COLLAPSE_PX ? CONTOURS.slice(1) : CONTOURS;
  const weight = size <= COLLAPSE_PX ? 2.4 : 1.7;

  return (
    <>
      {rings.map((ring, i) => {
        const summit = i === rings.length - 1;
        return (
          <path
            key={ring.d}
            d={ring.d}
            pathLength={1}
            fill="none"
            strokeLinecap="round"
            strokeWidth={summit ? weight + 0.2 : weight}
            strokeOpacity={ring.opacity}
            style={ringStyle?.(i)}
            className={cn(
              summit ? "stroke-[rgb(var(--elev-4))]" : "stroke-current",
              className,
            )}
          />
        );
      })}
    </>
  );
}

export function AtlasMark({
  className,
  size = 28,
  /** Drop the backing plate when the caller wants a bare mark
   *  (e.g. inside a coloured pill / avatar bubble). */
  bare = false,
  /** Trace the contours outward on mount. Off by default — the mark appears in
   *  18 places and animating all of them would be noise. */
  draw = false,
}: {
  className?: string;
  size?: number;
  bare?: boolean;
  draw?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      {!bare && (
        <rect
          x="1"
          y="1"
          width="30"
          height="30"
          rx="8"
          className="fill-[rgb(var(--surface-2))] stroke-current"
          strokeOpacity="0.12"
          strokeWidth="1"
        />
      )}

      {/* Datum — the elevation the contours are measured from. */}
      {size > COLLAPSE_PX && (
        <path
          d={`M 5 ${DATUM} H 27`}
          className="stroke-current"
          strokeOpacity="0.22"
          strokeWidth="1"
          strokeLinecap="round"
        />
      )}

      <Contours
        size={size}
        className={draw ? "atlas-mark-draw" : undefined}
        ringStyle={draw ? (i) => ({ animationDelay: `${i * 90}ms` }) : undefined}
      />

      {/* Spot height — the benchmark itself, marking the summit. */}
      <circle
        cx="15.2"
        cy="7.5"
        r={size <= COLLAPSE_PX ? 2.4 : 1.6}
        className="fill-[rgb(var(--elev-4))]"
      />
    </svg>
  );
}

/**
 * Loading variant of the Atlas mark.
 *
 * The contours swell outward in sequence, each a beat behind the one inside
 * it, so the peak reads as rising rather than blinking. Animation is suppressed
 * under `prefers-reduced-motion` by the blanket rule in globals.css, which
 * leaves the static mark behind — still legible, just still.
 */
export function AtlasMarkLoading({
  className,
  size = 28,
  /** Speed multiplier — 1 is default; higher = faster. */
  speed = 1,
}: {
  className?: string;
  size?: number;
  speed?: number;
}) {
  const periodMs = 1800 / speed;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={cn("shrink-0", className)}
      role="status"
      aria-label="Loading"
    >
      <Contours
        size={size}
        className="atlas-mark-breathe"
        ringStyle={(i) => ({
          animationDuration: `${periodMs}ms`,
          animationDelay: `${Math.round((periodMs / 7) * i)}ms`,
        })}
      />
      <circle cx="15.2" cy="7.5" r={1.6} className="fill-[rgb(var(--elev-4))]" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-display text-[1.05rem] font-semibold leading-none tracking-tight",
        className,
      )}
    >
      LLM&nbsp;Atlas
    </span>
  );
}

export function BrandLockup({
  className,
  size = 28,
  showWordmark = true,
}: {
  className?: string;
  size?: number;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <AtlasMark size={size} />
      {showWordmark && <Wordmark />}
    </span>
  );
}
