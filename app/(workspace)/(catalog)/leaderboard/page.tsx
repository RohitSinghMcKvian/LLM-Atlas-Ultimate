import type { Metadata } from "next";
import { LeaderboardClient } from "@/components/leaderboard/leaderboard-client";

export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "The most complete LLM catalog — capabilities, benchmarks, pricing, and rankings for existing and upcoming models.",
};

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ access?: string }>;
}) {
  const { access: raw } = await searchParams;
  const access = raw === "free" || raw === "byok" ? raw : undefined;
  return <LeaderboardClient initialAccess={access} />;
}
