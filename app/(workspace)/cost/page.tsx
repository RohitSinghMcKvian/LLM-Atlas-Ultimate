import type { Metadata } from "next";
import { CatalogScope } from "@/components/catalog/catalog-scope";
import { getCatalogSnapshot } from "@/lib/catalog/store";
import { CostClient } from "@/components/cost/cost-client";

export const metadata: Metadata = {
  title: "Cost",
  description:
    "Enterprise cost calculator comparing open-source self-hosting vs. frontier APIs, with a cost-vs-capability frontier.",
};

// The catalog is a runtime snapshot. Loading it here and installing it via
// <CatalogScope> before the client root renders means server HTML and
// hydration read the same models — no mismatch, no swap-in flash, and no
// client fetch on this route.
export default async function CostPage({
  searchParams,
}: {
  searchParams: Promise<{ model?: string }>;
}) {
  const { model } = await searchParams;
  const snapshot = await getCatalogSnapshot();
  return (
    <CatalogScope snapshot={snapshot}>
      <CostClient initialModelId={model} />
    </CatalogScope>
  );
}
