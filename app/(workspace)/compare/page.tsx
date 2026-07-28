import type { Metadata } from "next";
import { CatalogScope } from "@/components/catalog/catalog-scope";
import { getCatalogSnapshot } from "@/lib/catalog/store";
import { CompareClient } from "@/components/compare/compare-client";

export const metadata: Metadata = {
  title: "Compare",
  description:
    "Run one query across many models in parallel and synthesize the results — a Perplexity-style multi-model research surface.",
};

// The catalog is a runtime snapshot. Loading it here and installing it via
// <CatalogScope> before the client root renders means server HTML and
// hydration read the same models — no mismatch, no swap-in flash, and no
// client fetch on this route.
export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ models?: string }>;
}) {
  const { models } = await searchParams;
  const initialIds = models?.split(",").map((s) => s.trim()).filter(Boolean);
  const snapshot = await getCatalogSnapshot();
  return (
    <CatalogScope snapshot={snapshot}>
      <CompareClient initialIds={initialIds} />
    </CatalogScope>
  );
}
