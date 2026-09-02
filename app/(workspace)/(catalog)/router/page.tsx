import type { Metadata } from "next";
import { RouterClient } from "@/components/router/router-client";

export const metadata: Metadata = {
  title: "Atlas Router",
  description:
    "A unified inference gateway — one API across many providers and local inference, with cost-aware routing, fallback, and caching.",
};

export default async function RouterPage() {
  return <RouterClient />;
}
