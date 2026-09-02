import type { Metadata } from "next";
import { PlaygroundClient } from "@/components/playground/playground-client";

export const metadata: Metadata = {
  title: "Atlas Playground",
  description:
    "A fast prompt and parameter scratchpad — run one prompt across models side-by-side and tune temperature, top-p, and more.",
};

export default async function PlaygroundPage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string }>;
}) {
  const { prompt } = await searchParams;
  return <PlaygroundClient initialPrompt={prompt} />;
}
