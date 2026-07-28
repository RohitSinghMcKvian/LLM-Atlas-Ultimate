import type { Metadata } from "next";
import { CatalogScope } from "@/components/catalog/catalog-scope";
import { getCatalogSnapshot } from "@/lib/catalog/store";
import { BenchClient } from "@/components/bench/bench-client";

export const metadata: Metadata = {
  title: "Atlas Bench",
  description:
    "Bring-your-own reproducible evals — run prompt sets against models, scored deterministically, with full reproducibility metadata.",
};

// The catalog is a runtime snapshot. Loading it here and installing it via
// <CatalogScope> before the client root renders means server HTML and
// hydration read the same models — no mismatch, no swap-in flash, and no
// client fetch on this route.
export default async function BenchPage() {
  const snapshot = await getCatalogSnapshot();
  return (
    <CatalogScope snapshot={snapshot}>
      <BenchClient />
    </CatalogScope>
  );
}
