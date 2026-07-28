import type { Metadata } from "next";
import { CatalogScope } from "@/components/catalog/catalog-scope";
import { getCatalogSnapshot } from "@/lib/catalog/store";
import { FlowClient } from "@/components/flow/flow-client";

export const metadata: Metadata = {
  title: "Atlas Flow",
  description:
    "A visual multi-agent workflow builder — wire agents, tools, and conditions into a graph that compiles to a runnable Atlas Brain workflow.",
};

// The catalog is a runtime snapshot. Loading it here and installing it via
// <CatalogScope> before the client root renders means server HTML and
// hydration read the same models — no mismatch, no swap-in flash, and no
// client fetch on this route.
export default async function FlowPage() {
  const snapshot = await getCatalogSnapshot();
  return (
    <CatalogScope snapshot={snapshot}>
      <FlowClient />
    </CatalogScope>
  );
}
