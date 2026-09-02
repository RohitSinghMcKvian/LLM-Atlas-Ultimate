import type { Metadata } from "next";
import { ChatClient } from "@/components/chat/chat-client";

export const metadata: Metadata = {
  title: "Chat",
  description:
    "A premium conversational interface over any model, with artifacts, tools, and persistent memory.",
};

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ model?: string }>;
}) {
  const { model } = await searchParams;
  return <ChatClient initialModelId={model} />;
}
