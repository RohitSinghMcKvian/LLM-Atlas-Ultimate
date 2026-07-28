"use client";

import * as React from "react";
import { generativeArt } from "@/lib/news/image";
import { cn } from "@/lib/utils";

// The fallback for an article with no usable image.
//
// Roughly two thirds of feed items ship no image, and a grid with holes in it
// reads as broken rather than sparse. A single repeated placeholder is worse —
// forty identical grey rectangles look like a failed load.
//
// So each article gets its own figure, derived deterministically from its id:
// the same story always looks the same, the feed reads as varied, and nothing is
// fetched. Hues are constrained to the product's cyan→violet arc (with an
// occasional amber) so these sit beside real photography without clashing.

export function NewsGeneratedArt({
  seed,
  className,
  label,
}: {
  seed: string;
  className?: string;
  /** Announced to screen readers. Pass the headline. */
  label?: string;
}) {
  const art = React.useMemo(() => generativeArt(seed), [seed]);
  const id = React.useId().replace(/:/g, "");

  const motif = React.useMemo(() => {
    switch (art.motif) {
      case "rings":
        return [0.18, 0.3, 0.42].map((r, i) => (
          <circle
            key={i}
            cx={50 + (art.blobs[0].x - 0.35) * 40}
            cy={50 + (art.blobs[0].y - 0.35) * 40}
            r={r * 100}
            fill="none"
            stroke="currentColor"
            strokeWidth={0.6}
            opacity={0.35 - i * 0.08}
          />
        ));
      case "grid":
        return Array.from({ length: 7 }, (_, i) => (
          <React.Fragment key={i}>
            <line
              x1={i * 16 + 8}
              y1={0}
              x2={i * 16 + 8}
              y2={100}
              stroke="currentColor"
              strokeWidth={0.4}
              opacity={0.22}
            />
            <line
              x1={0}
              y1={i * 16 + 8}
              x2={100}
              y2={i * 16 + 8}
              stroke="currentColor"
              strokeWidth={0.4}
              opacity={0.22}
            />
          </React.Fragment>
        ));
      case "waves":
        return Array.from({ length: 5 }, (_, i) => {
          const y = 25 + i * 13;
          return (
            <path
              key={i}
              d={`M -5 ${y} Q 25 ${y - 10 - i * 2} 50 ${y} T 105 ${y}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={0.7}
              opacity={0.3 - i * 0.04}
            />
          );
        });
      case "shards":
      default:
        return Array.from({ length: 4 }, (_, i) => {
          const offset = i * 22;
          return (
            <polygon
              key={i}
              points={`${10 + offset},95 ${28 + offset},20 ${40 + offset},95`}
              fill="currentColor"
              opacity={0.14 - i * 0.02}
            />
          );
        });
    }
  }, [art]);

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      className={cn("h-full w-full", className)}
      role="img"
      aria-label={label ? `Abstract cover art for: ${label}` : "Abstract cover art"}
      // The figure is decorative; the headline beside it carries the meaning.
      style={{ color: `hsl(${art.hue} 85% 70%)` }}
    >
      <defs>
        <linearGradient id={`bg-${id}`} gradientTransform={`rotate(${art.angle} 0.5 0.5)`}>
          <stop offset="0%" stopColor={`hsl(${art.hue} 70% 22%)`} />
          <stop offset="100%" stopColor={`hsl(${art.hue2} 65% 12%)`} />
        </linearGradient>
        <radialGradient id={`blob0-${id}`}>
          <stop offset="0%" stopColor={`hsl(${art.hue} 90% 60%)`} stopOpacity="0.55" />
          <stop offset="100%" stopColor={`hsl(${art.hue} 90% 60%)`} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`blob1-${id}`}>
          <stop offset="0%" stopColor={`hsl(${art.hue2} 90% 62%)`} stopOpacity="0.5" />
          <stop offset="100%" stopColor={`hsl(${art.hue2} 90% 62%)`} stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="100" height="100" fill={`url(#bg-${id})`} />
      <circle
        cx={art.blobs[0].x * 100}
        cy={art.blobs[0].y * 100}
        r={art.blobs[0].r * 100}
        fill={`url(#blob0-${id})`}
      />
      <circle
        cx={art.blobs[1].x * 100}
        cy={art.blobs[1].y * 100}
        r={art.blobs[1].r * 100}
        fill={`url(#blob1-${id})`}
      />
      {motif}
    </svg>
  );
}
