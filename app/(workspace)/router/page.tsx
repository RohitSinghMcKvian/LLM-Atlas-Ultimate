import type { Metadata } from "next";
import { CatalogScope } from "@/components/catalog/catalog-scope";
import { getCatalogSnapshot } from "@/lib/catalog/store";
import { RouterClient } from "@/components/router/router-client";

export const metadata: Metadata = {
  title: "Atlas Router",
  description:
    "A unified inference gateway — one API across many providers and local inference, with cost-aware routing, fallback, and caching.",
};

// The catalog is a runtime snapshot. Loading it here and installing it via
// <CatalogScope> before the client root renders means server HTML and
// hydration read the same models — no mismatch, no swap-in flash, and no
// client fetch on this route.
export default async function RouterPage() {
  const snapshot = await getCatalogSnapshot();
  return (
    <CatalogScope snapshot={snapshot}>
      <RouterClient />
    </CatalogScope>
  );
}
