import type { Metadata } from "next";
import { PromptClient } from "@/components/prompt/prompt-client";

export const metadata: Metadata = {
  title: "Atlas Prompt",
  description:
    "A versioned prompt library with templates, variables, and changelogs — shared across Chat, Code, and Flow.",
};

export default function PromptPage() {
  return <PromptClient />;
}
