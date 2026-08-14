"use client";

import * as React from "react";

/**
 * `useEffect` runs after paint, so anything that decides layout has to be a
 * layout effect — but React warns about `useLayoutEffect` on the server.
 */
export const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/**
 * `useMediaQuery` that settles before the first paint.
 *
 * Use it where the answer changes a *size* rather than what is rendered: the
 * post-paint variant would show one frame of the wrong layout, and setting
 * state from a layout effect re-renders synchronously before the browser draws.
 */
export function useMediaQueryLayout(query: string): boolean {
  const [matches, setMatches] = React.useState(false);

  useIsomorphicLayoutEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export function useIsMobile() {
  return useMediaQuery("(max-width: 767px)");
}

/**
 * Whether the user asked the system to reduce motion.
 *
 * Defaults to `false` before mount, which matches the CSS default — a
 * height/opacity transition is the animation, not a substitute for it, so the
 * one pre-hydration frame is identical either way.
 */
export function usePrefersReducedMotion() {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

export function useMounted() {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return mounted;
}
