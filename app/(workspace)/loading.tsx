import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shared workspace route skeleton.
 *
 * Two jobs. It gives a navigation instant feedback instead of leaving the
 * previous page frozen while the next route's chunks load. And — less
 * obviously — it is the Suspense boundary that makes `<Link>` prefetching
 * useful at all: without one, Next's prefetch stops at the layout and never
 * warms the page segment, so every click paid a cold round-trip.
 *
 * Mirrors the frame every module page uses (max-w-[1500px], px-4 py-8) so the
 * header lands in roughly the same place the real content will.
 */
export default function WorkspaceLoading() {
  return (
    <div
      className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:py-10"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      {/* Header — title + subtitle */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2.5">
          <Skeleton className="h-8 w-52 rounded-lg" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-full rounded-xl sm:w-56" />
          <Skeleton className="h-9 w-24 rounded-xl" />
        </div>
      </div>

      {/* Content rows */}
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-20 rounded-2xl"
            // Fade the rows out down the page so the block reads as "loading"
            // rather than as real content that failed to render.
            style={{ opacity: 1 - i * 0.13 }}
          />
        ))}
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
