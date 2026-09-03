"use client";

import * as React from "react";
import { newsImageSrc } from "@/lib/news/image";
import type { NewsImage as NewsImageData } from "@/lib/news/types";
import { cn } from "@/lib/utils";
import { NewsGeneratedArt } from "./news-generated-art";

// An article's hero image, or a generated stand-in.
//
// A plain `<img>` rather than `next/image`. The alternative would be adding
// `images.remotePatterns: ["https://**"]` to next.config, which turns Next's
// optimizer into an open image-resizing proxy for any URL on the internet.
// Instead the src points at `/api/v1/news/image`, which is same-origin, pinned
// to hosts the current corpus actually references, and sends long cache headers.
//
// THE IMAGE IS NEVER HIDDEN WAITING FOR AN EVENT
//
// This used to fade in on `onLoad`, holding the element at `opacity: 0` until
// React's synthetic handler fired. That is a race, and with a proxy sending
// year-long cache headers it is a race the image usually wins: it finishes
// decoding before React commits, the event fires with nothing listening, and a
// fully decoded 1200x600 photograph is painted invisible forever. It went
// unnoticed while only a third of articles had an image at all; recovering
// images for most of the corpus made it the hero of the daily brief.
//
// So visibility is no longer state at all. The image renders at full opacity
// from the first paint, and the shimmer sits BEHIND it — the browser simply has
// nothing to draw for the image until its pixels arrive, and the placeholder
// shows through in the meantime. There is no event to miss.
//
// `onError` still matters, because a failed image must become generated art
// rather than a broken-image glyph. But an error is a real event with a real
// consequence, not a gate on showing something we already have.

export function NewsImage({
  image,
  alt,
  seed,
  className,
  imgClassName,
  priority,
  sizes = "(min-width: 1280px) 420px, (min-width: 640px) 45vw, 100vw",
}: {
  image?: NewsImageData;
  /** The headline. Used as alt text when the feed gave none. */
  alt: string;
  /** Stable id for the generated fallback, so a card always draws the same art. */
  seed: string;
  className?: string;
  imgClassName?: string;
  /** Skip lazy loading for the one card that is always above the fold. */
  priority?: boolean;
  sizes?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  const src = image?.url ? newsImageSrc(image.url) : undefined;

  // A new article in the same slot (a filter change, infinite scroll) reuses the
  // node, so a previous image's failure must not disqualify this one.
  React.useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    return (
      <div className={cn("relative overflow-hidden bg-surface-2", className)}>
        <NewsGeneratedArt seed={seed} label={alt} />
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden bg-surface-2", className)}>
      {/* Behind the image, not conditional on it. The browser paints nothing for
          an image whose pixels have not arrived, so this shows through on its
          own and stops showing through the moment they do — with no state, no
          event, and nothing to get wrong. */}
      <div className="absolute inset-0 shimmer" aria-hidden="true" />

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={image?.alt || alt}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
        sizes={sizes}
        // Belt and braces: the proxy already strips the referrer server-side,
        // but this covers the browser's own request too.
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn(
          // `relative` lifts it above the shimmer without a z-index fight.
          //
          // NO ENTRANCE ANIMATION. `animate-in fade-in` was tried here and
          // reintroduced the very bug this rewrite removed, by a different
          // route: tailwindcss-animate sets `animation-fill-mode: both`, so the
          // element holds the keyframe's `opacity: 0` before the animation runs
          // — and every image not yet decoded, plus any whose animation never
          // starts, computes to fully transparent. Twice now, a decorative fade
          // has been the thing that made real photographs invisible. The image
          // is simply opaque.
          "relative h-full w-full object-cover",
          imgClassName,
        )}
      />
    </div>
  );
}
