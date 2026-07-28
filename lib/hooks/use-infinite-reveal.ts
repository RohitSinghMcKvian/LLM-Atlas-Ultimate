"use client";

import * as React from "react";

// Render a long list in chunks, revealing more as the user scrolls to the end.
//
// The catalog grew from ~100 models to ~400, and the leaderboard renders every
// result. Mounting 400 rows costs both the initial commit and every subsequent
// re-render, and it is wasted work: nobody scrolls past the first few dozen
// before filtering.
//
// Deliberately not virtualization: rows have variable height (they expand in
// place), no windowing library is installed, and combining windowing with
// framer-motion exit animations is a reliable source of bugs. Chunked reveal
// gets nearly all of the benefit with none of that risk, and degrades to
// "render everything" if `IntersectionObserver` is unavailable.

export interface InfiniteReveal {
  /** How many items to render right now. */
  limit: number;
  /** Attach to a sentinel element after the last rendered item. */
  sentinelRef: React.MutableRefObject<HTMLDivElement | null>;
  /** Whether anything is still hidden. */
  hasMore: boolean;
  /** Reveal the next chunk immediately (for an explicit "show more" control). */
  revealMore: () => void;
}

export function useInfiniteReveal(
  total: number,
  {
    initial = 50,
    step = 50,
    /** Changing this snaps back to `initial` — pass the filter/sort state. */
    resetKey,
  }: { initial?: number; step?: number; resetKey?: unknown } = {},
): InfiniteReveal {
  const [limit, setLimit] = React.useState(initial);
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);

  // A new filter or sort means the user is looking at a different list; keeping
  // a large limit would render hundreds of rows they never asked to see.
  React.useEffect(() => {
    setLimit(initial);
  }, [resetKey, initial]);

  const hasMore = limit < total;

  const revealMore = React.useCallback(() => {
    setLimit((current) => current + step);
  }, [step]);

  React.useEffect(() => {
    if (!hasMore) return;
    const node = sentinelRef.current;
    if (!node) return;

    if (typeof IntersectionObserver === "undefined") {
      // No observer (very old browser, or a non-DOM test env): show everything
      // rather than trapping the user at 50 rows.
      setLimit(total);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) revealMore();
      },
      // Start loading before the sentinel is actually visible, so the next chunk
      // is usually mounted by the time the user reaches it.
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, total, revealMore, limit]);

  return { limit, sentinelRef, hasMore, revealMore };
}
