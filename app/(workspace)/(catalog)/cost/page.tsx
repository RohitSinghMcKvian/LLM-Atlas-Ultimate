import type { Metadata } from "next";
import { CostClient } from "@/components/cost/cost-client";

export const metadata: Metadata = {
  title: "Cost",
  description:
    "Enterprise cost calculator comparing open-source self-hosting vs. frontier APIs, with a cost-vs-capability frontier.",
};

export default async function CostPage({
  searchParams,
}: {
  searchParams: Promise<{ model?: string }>;
}) {
  const { model } = await searchParams;
  return <CostClient initialModelId={model} />;
}
