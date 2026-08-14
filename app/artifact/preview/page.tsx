import type { Metadata } from "next";
import { ArtifactPreviewShell } from "@/components/chat/artifact-preview-shell";

// Deliberately outside the (workspace) group: this is a bare full-bleed host for
// one artifact, with no sidebar, topbar, or command palette competing with it.
export const metadata: Metadata = {
  title: "Artifact preview",
  robots: { index: false, follow: false },
};

export default function ArtifactPreviewPage() {
  return <ArtifactPreviewShell />;
}
