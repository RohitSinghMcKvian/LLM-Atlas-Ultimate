import type { Metadata } from "next";
import { VaultClient } from "@/components/vault/vault-client";

export const metadata: Metadata = {
  title: "Atlas Vault",
  description:
    "Manage the credentials that power your workspace — your model key, operator provider status, and tool secrets, each with a full access trail.",
};

export default function Page() {
  return <VaultClient />;
}
