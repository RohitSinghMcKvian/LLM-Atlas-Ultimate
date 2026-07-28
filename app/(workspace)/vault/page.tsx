import type { Metadata } from "next";
import { CatalogScope } from "@/components/catalog/catalog-scope";
import { getCatalogSnapshot } from "@/lib/catalog/store";
import { VaultClient } from "@/components/vault/vault-client";

export const metadata: Metadata = {
  title: "Atlas Vault",
  description:
    "Manage the credentials that power your workspace — your model key, operator provider status, and tool secrets, each with a full access trail.",
};

// The catalog is a runtime snapshot. Loading it here and installing it via
// <CatalogScope> before the client root renders means server HTML and
// hydration read the same models — no mismatch, no swap-in flash, and no
// client fetch on this route.
export default async function Page() {
  const snapshot = await getCatalogSnapshot();
  return (
    <CatalogScope snapshot={snapshot}>
      <VaultClient />
    </CatalogScope>
  );
}
