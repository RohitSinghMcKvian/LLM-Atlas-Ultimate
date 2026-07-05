import type { Metadata } from "next";
import { CompareClient } from "@/components/compare/compare-client";

export const metadata: Metadata = {
  title: "Compare",
  description:
    "Run one query across many models in parallel and synthesize the results — a Perplexity-style multi-model research surface.",
};

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ models?: string }>;
}) {
  const { models } = await searchParams;
  const initialIds = models?.split(",").map((s) => s.trim()).filter(Boolean);
  return <CompareClient initialIds={initialIds} />;
}
