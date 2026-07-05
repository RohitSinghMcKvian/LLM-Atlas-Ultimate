import type { Metadata } from "next";
import { NewsClient } from "@/components/news/news-client";

export const metadata: Metadata = {
  title: "Atlas News",
  description:
    "An hourly-syncing, de-duplicated AI news feed with neutral summaries, source attribution, and 'what changed' model-diff cards.",
};

export default function NewsPage() {
  return <NewsClient />;
}
