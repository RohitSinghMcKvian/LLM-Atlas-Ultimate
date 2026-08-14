import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthPlate, type PlateStats } from "@/components/auth/auth-plate";
import { getCatalogSnapshot } from "@/lib/catalog/store";
import { isSelectable } from "@/lib/catalog";

// The plate's figures and the constellation's model names come from the live
// catalog, read on the server exactly as the landing page does. Doing it here
// rather than in a client fetch keeps the numbers out of the hydration path —
// a relative timestamp computed in the browser would disagree with the server
// render — and means the field never re-seeds when late data arrives.
export const revalidate = 86_400;

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to LLM Atlas to sync your workspace across devices.",
  // A sign-in page has nothing worth indexing and everything to lose from a
  // stale `next=` landing in search results.
  robots: { index: false, follow: false },
};

/** "4 hours ago", from an ISO timestamp, computed on the server. */
function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "recently";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const snapshot = await getCatalogSnapshot();
  const selectable = snapshot.models.filter(isSelectable);

  const stats: PlateStats = {
    models: selectable.length,
    providers: new Set(selectable.map((m) => m.provider)).size,
    benchmarks: snapshot.stats.benchmarks,
    // Only a real sync gets a timestamp. The bundled baseline carries the date
    // it was built, which would read as a badly neglected catalog rather than
    // one that was simply never wired to a provider.
    syncedLabel: snapshot.origin === "synced" ? relativeTime(snapshot.syncedAt) : null,
  };

  // Trending first, then catalog order, so the names are stable between
  // revalidations and the field doesn't reshuffle on every visit.
  const labels = [...selectable]
    .sort((a, b) => Number(Boolean(b.trending)) - Number(Boolean(a.trending)))
    .slice(0, 10)
    .map((m) => m.name);

  return (
    <AuthShell plate={<AuthPlate stats={stats} />} labels={labels.length >= 6 ? labels : undefined}>
      {children}
    </AuthShell>
  );
}
