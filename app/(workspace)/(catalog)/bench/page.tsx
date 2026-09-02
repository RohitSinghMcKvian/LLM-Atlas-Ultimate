import type { Metadata } from "next";
import { BenchClient } from "@/components/bench/bench-client";

export const metadata: Metadata = {
  title: "Atlas Bench",
  description:
    "Bring-your-own reproducible evals — run prompt sets against models, scored deterministically, with full reproducibility metadata.",
};

export default async function BenchPage() {
  return <BenchClient />;
}
