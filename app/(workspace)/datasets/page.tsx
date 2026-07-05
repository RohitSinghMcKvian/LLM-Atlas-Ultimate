import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const metadata: Metadata = { title: "Atlas Datasets" };

export default function Page() {
  return <ModulePlaceholder id="datasets" />;
}
