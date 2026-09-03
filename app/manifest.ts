import type { MetadataRoute } from "next";

// The Web App Manifest, served at /manifest.webmanifest.
//
// Present for one concrete reason rather than as PWA box-ticking: on iOS, Web
// Push works ONLY for a site the user has added to the Home Screen, and Safari
// will not offer that unless a manifest with `display: standalone` and a
// 192px-or-larger icon is present. Chrome on Android is more forgiving but uses
// the same fields for the notification's app name and icon.
//
// Everything here is deliberately minimal. There is no offline story, no cached
// shell, and no install prompt — see the note at the top of `public/sw.js` about
// why a caching worker on a Next app is a liability rather than a feature.

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LLM Atlas — the open ecosystem for everything LLM",
    short_name: "LLM Atlas",
    description:
      "Verified AI news, model comparison and cost analysis in one workspace. Get the day's AI stories as a notification.",
    // Opens on the news feed, because the only reason this manifest exists is
    // notifications and every notification lands here.
    start_url: "/news?src=pwa",
    scope: "/",
    display: "standalone",
    orientation: "any",
    // In step with `viewport.themeColor` in app/layout.tsx.
    background_color: "#101112",
    theme_color: "#101112",
    categories: ["news", "productivity", "developer"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // A separate maskable entry, padded so a launcher can crop it to a circle
      // without taking the mark's corners off. Declaring one icon as both `any`
      // and `maskable` is a common shortcut and it produces a visibly clipped
      // logo on every Android launcher that uses a non-square shape.
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
