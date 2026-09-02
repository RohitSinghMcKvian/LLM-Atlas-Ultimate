"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

/**
 * The route fade.
 *
 * Opacity-only, and short. The original 300ms y-translate animated the whole
 * page subtree underneath the sidebar's and topbar's backdrop-blur layers,
 * forcing the compositor to re-rasterize both blurs every frame after every
 * navigation. Fading is composited and costs nothing.
 *
 * ### Why this is not framer-motion any more
 *
 * It was one `<motion.div>` doing a 180ms opacity tween — and because this
 * component is mounted in the workspace layout, that single tween pulled all
 * 117 KB of framer-motion into the chunk that *every* workspace route parses
 * before its own page code runs, `/docs` and `/datasets` included. A CSS
 * keyframe is byte-for-byte the same animation for none of that cost, and it
 * starts on the compositor at first paint rather than after hydration.
 *
 * `key={pathname}` still does the work: React tears down the old subtree and
 * mounts a new one, which restarts the CSS animation exactly as it restarted
 * the tween. Reduced motion is handled by the blanket `prefers-reduced-motion`
 * block in `globals.css`, which pins every animation to a single iteration —
 * so the page lands at `opacity: 1` rather than being left invisible.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="atlas-route-fade">
      {children}
    </div>
  );
}
