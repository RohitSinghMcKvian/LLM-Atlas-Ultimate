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
// Three states, and the third is the common one:
//   • loading  — a shimmer at the right aspect ratio, so nothing reflows
//   • loaded   — the publisher's image, faded in
//   • no image or failed — `<NewsGeneratedArt>`, which is not an error state so
//     much as the default for the two thirds of feed items that ship no image.

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
  const [state, setState] = React.useState<"idle" | "loaded" | "failed">("idle");

  // A new article in the same slot (filter change, infinite scroll) must reset
  // the state, or a recycled node keeps the previous image's "failed".
  React.useEffect(() => {
    setState("idle");
  }, [image?.url]);

  const showArt = !image?.url || state === "failed";

  return (
    <div className={cn("relative overflow-hidden bg-surface-2", className)}>
      {showArt ? (
        <NewsGeneratedArt seed={seed} label={alt} />
      ) : (
        <>
          {state === "idle" && (
            <div className="absolute inset-0 shimmer" aria-hidden="true" />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={newsImageSrc(image.url)}
            alt={image.alt || alt}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            fetchPriority={priority ? "high" : "auto"}
            sizes={sizes}
            // Belt and braces: the proxy already strips the referrer server-side,
            // but this covers the browser's own request too.
            referrerPolicy="no-referrer"
            onLoad={() => setState("loaded")}
            onError={() => setState("failed")}
            className={cn(
              "h-full w-full object-cover transition-opacity duration-500",
              state === "loaded" ? "opacity-100" : "opacity-0",
              imgClassName,
            )}
          />
        </>
      )}
    </div>
  );
}
