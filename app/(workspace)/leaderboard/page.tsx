import type { Metadata } from "next";
import { CatalogScope } from "@/components/catalog/catalog-scope";
import { getCatalogSnapshot } from "@/lib/catalog/store";
import { LeaderboardClient } from "@/components/leaderboard/leaderboard-client";

export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "The most complete LLM catalog — capabilities, benchmarks, pricing, and rankings for existing and upcoming models.",
};

// The catalog is a runtime snapshot. Loading it here and installing it via
// <CatalogScope> before the client root renders means server HTML and
// hydration read the same models — no mismatch, no swap-in flash, and no
// client fetch on this route.
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ access?: string }>;
}) {
  const { access: raw } = await searchParams;
  const access = raw === "free" || raw === "byok" ? raw : undefined;
  const snapshot = await getCatalogSnapshot();
  return (
    <CatalogScope snapshot={snapshot}>
      <LeaderboardClient initialAccess={access} />
    </CatalogScope>
  );
}
