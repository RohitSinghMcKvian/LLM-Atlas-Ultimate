import type { Metadata } from "next";
import { CatalogScope } from "@/components/catalog/catalog-scope";
import { getCatalogSnapshot } from "@/lib/catalog/store";
import { LearnClient } from "@/components/learn/learn-client";

export const metadata: Metadata = {
  title: "Atlas Learn",
  description:
    "A beginner-to-expert AI/LLM course with live, model-connected lessons, auto-graded exercises, and a shareable certificate.",
};

// The catalog is a runtime snapshot. Loading it here and installing it via
// <CatalogScope> before the client root renders means server HTML and
// hydration read the same models — no mismatch, no swap-in flash, and no
// client fetch on this route.
export default async function LearnPage() {
  const snapshot = await getCatalogSnapshot();
  return (
    <CatalogScope snapshot={snapshot}>
      <LearnClient />
    </CatalogScope>
  );
}
