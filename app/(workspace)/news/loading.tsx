import { Skeleton } from "@/components/ui/skeleton";

// A bespoke skeleton for /news.
//
// The shared `(workspace)/loading.tsx` renders flat rows, which for this page
// would be replaced by a hero, a chip bar and a grid of image cards — a visible
// re-flow on every navigation. This mirrors the real geometry instead, so the
// transition is a fade rather than a jump.

export default function NewsLoading() {
  return (
    <div className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:py-10" aria-busy="true">
      <span className="sr-only">Loading AI news…</span>

      <div className="mb-4 rounded-3xl border border-border p-5 sm:p-7">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-3 h-9 w-56" />
        <Skeleton className="mt-3 h-4 w-full max-w-xl" />
        <div className="mt-5 flex flex-wrap gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-7 w-12" />
            </div>
          ))}
        </div>
        <div className="mt-5 flex gap-2 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-56 shrink-0 rounded-full" />
          ))}
        </div>
      </div>

      <div className="flex gap-1.5 overflow-hidden border-b border-border py-2.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-24 shrink-0 rounded-full" />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <li
              key={i}
              className="overflow-hidden rounded-2xl border border-border"
              // Fade the lower cards, the same cue the shared skeleton uses.
              style={{ opacity: 1 - i * 0.12 }}
            >
              <Skeleton className="aspect-video w-full rounded-none" />
              <div className="space-y-2 p-4">
                <Skeleton className="h-3 w-16 rounded-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-3 w-full" />
                <div className="flex items-center gap-2 pt-2">
                  <Skeleton className="h-2.5 w-24" />
                  <Skeleton className="ml-auto h-6 w-6 rounded-md" />
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="hidden space-y-4 lg:block">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border p-3">
              <Skeleton className="h-2.5 w-24" />
              <div className="mt-2 space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
                <Skeleton className="h-3 w-4/6" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
