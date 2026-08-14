"use client";

import * as React from "react";
import {
  ARTIFACT_PREVIEW_KEY,
  ARTIFACT_SANDBOX,
  docFor,
  isExecutable,
  type Artifact,
} from "./artifact-panel";

/**
 * Full-page host for the artifact panel's "open in a new tab" action.
 *
 * The point of this page is that the artifact still renders inside the same
 * sandboxed, CSP-constrained iframe it does in the panel. Opening a blob: URL
 * directly would have inherited Atlas's origin and run the model's code with
 * full access to the user's stored API key.
 *
 * The payload arrives through sessionStorage rather than the URL: it is
 * same-origin, survives the tab open, and keeps a potentially large document
 * out of browser history.
 */
export function ArtifactPreviewShell() {
  const [artifact, setArtifact] = React.useState<Artifact | null>(null);
  const [origin, setOrigin] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setOrigin(window.location.origin);
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(ARTIFACT_PREVIEW_KEY);
    } catch {
      setError("This browser is blocking session storage, so the artifact could not be loaded.");
      return;
    }
    if (!raw) {
      setError("No artifact to preview. Open one from the chat artifact panel.");
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Artifact;
      if (!parsed?.type || typeof parsed.code !== "string" || !isExecutable(parsed.type)) {
        setError("That artifact type cannot be previewed on its own.");
        return;
      }
      setArtifact(parsed);
    } catch {
      setError("The stored artifact could not be read.");
    }
  }, []);

  if (error) {
    return (
      <main className="grid min-h-dvh place-items-center bg-background p-8">
        <p className="max-w-sm text-center text-sm text-muted-foreground">{error}</p>
      </main>
    );
  }

  if (!artifact || !origin) {
    return <main className="min-h-dvh bg-background" />;
  }

  return (
    <main className="min-h-dvh bg-background">
      <iframe
        title={artifact.title}
        srcDoc={docFor(artifact, origin)}
        sandbox={ARTIFACT_SANDBOX}
        className="h-dvh w-full border-0 bg-white"
      />
    </main>
  );
}
