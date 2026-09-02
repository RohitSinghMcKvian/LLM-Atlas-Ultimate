import type { Metadata } from "next";
import { LearnClient } from "@/components/learn/learn-client";

export const metadata: Metadata = {
  title: "Atlas Learn",
  description:
    "A beginner-to-expert AI/LLM course with live, model-connected lessons, auto-graded exercises, and a shareable certificate.",
};

export default async function LearnPage() {
  return <LearnClient />;
}
