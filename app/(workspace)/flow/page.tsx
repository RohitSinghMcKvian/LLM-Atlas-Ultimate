import type { Metadata } from "next";
import { FlowClient } from "@/components/flow/flow-client";

export const metadata: Metadata = {
  title: "Atlas Flow",
  description:
    "A visual multi-agent workflow builder — wire agents, tools, and conditions into a graph that compiles to a runnable Atlas Brain workflow.",
};

export default function FlowPage() {
  return <FlowClient />;
}
