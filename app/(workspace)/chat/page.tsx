import type { Metadata } from "next";
import { CatalogScope } from "@/components/catalog/catalog-scope";
import { getCatalogSnapshot } from "@/lib/catalog/store";
import { ChatClient } from "@/components/chat/chat-client";

export const metadata: Metadata = {
  title: "Chat",
  description:
    "A premium conversational interface over any model, with artifacts, tools, and persistent memory.",
};

// The catalog is a runtime snapshot. Loading it here and installing it via
// <CatalogScope> before the client root renders means server HTML and
// hydration read the same models — no mismatch, no swap-in flash, and no
// client fetch on this route.
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ model?: string }>;
}) {
  const { model } = await searchParams;
  const snapshot = await getCatalogSnapshot();
  return (
    <CatalogScope snapshot={snapshot}>
      <ChatClient initialModelId={model} />
    </CatalogScope>
  );
}
