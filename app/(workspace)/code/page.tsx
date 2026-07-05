import type { Metadata } from "next";
import { CodeClient } from "@/components/code/code-client";

export const metadata: Metadata = {
  title: "Atlas Code",
  description:
    "An agentic coding workspace in your browser — a real agent reads, edits, and runs code in a WebContainer (Node) + Pyodide (Python) sandbox with diffs and checkpoints.",
};

export default function CodePage() {
  return <CodeClient />;
}
