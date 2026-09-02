import type { Metadata } from "next";
import { HubClient } from "@/components/hub/hub-client";

export const metadata: Metadata = { title: "Atlas Hub" };

export default async function Page() {
  return <HubClient />;
}
