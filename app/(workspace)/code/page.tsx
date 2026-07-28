import type { Metadata } from "next";
import { CatalogScope } from "@/components/catalog/catalog-scope";
import { getCatalogSnapshot } from "@/lib/catalog/store";
import { CodeClient } from "@/components/code/code-client";

export const metadata: Metadata = {
  title: "Atlas Code",
  description:
    "An agentic coding workspace in your browser — a real agent reads, edits, and runs code in a WebContainer (Node) + Pyodide (Python) sandbox with diffs and checkpoints.",
};

// The catalog is a runtime snapshot. Loading it here and installing it via
// <CatalogScope> before the client root renders means server HTML and
// hydration read the same models — no mismatch, no swap-in flash, and no
// client fetch on this route.
export default async function CodePage() {
  const snapshot = await getCatalogSnapshot();
  return (
    <CatalogScope snapshot={snapshot}>
      <CodeClient />
    </CatalogScope>
  );
}
