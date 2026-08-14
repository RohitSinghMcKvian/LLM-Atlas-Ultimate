"use client";

import * as React from "react";
import {
  Code2,
  FileText,
  GitBranch,
  Image as ImageIcon,
  Loader2,
  Presentation,
  Workflow,
} from "lucide-react";
import type { Artifact, ArtifactType } from "@/lib/chat/artifact-sandbox";
import { cn } from "@/lib/utils";

/**
 * The artifact, as it appears in the transcript.
 *
 * It used to appear as its own source: a landing page dropped six hundred lines
 * of HTML into the conversation, burying whatever the model said about it and
 * pushing the next turn off the screen. Nobody reads a page's markup in a chat
 * log — they look at the page. So the transcript gets a card, and the code lives
 * in the panel, which is where it can actually be previewed, diffed and reverted.
 *
 * Nothing is hidden that cannot be reached: the panel's Code tab, Copy and
 * Download all still hand back the exact source.
 */

const ICON: Record<ArtifactType, React.ComponentType<{ className?: string }>> = {
  html: Code2,
  react: Code2,
  svg: ImageIcon,
  mermaid: Workflow,
  markdown: FileText,
  code: Code2,
  document: FileText,
  slides: Presentation,
};

const KIND: Record<ArtifactType, string> = {
  html: "Web page",
  react: "React component",
  svg: "Vector graphic",
  mermaid: "Diagram",
  markdown: "Document",
  code: "Code",
  document: "Document",
  slides: "Slide deck",
};

export function ArtifactCard({
  artifact,
  onOpen,
  errorCount = 0,
}: {
  artifact: Artifact;
  onOpen: () => void;
  /** Runtime errors the preview reported for this artifact. */
  errorCount?: number;
}) {
  const Icon = ICON[artifact.type];
  const lines = artifact.code ? artifact.code.split("\n").length : 0;
  const writing = artifact.complete === false;

  return (
    <button
      onClick={onOpen}
      aria-label={`Open ${artifact.title} in the artifact panel`}
      className={cn(
        "group/card my-2 flex w-full items-center gap-3 rounded-xl border border-border bg-surface-2/40 px-3 py-2.5 text-left",
        "transition-colors hover:border-action/40 hover:bg-surface-2/70",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action/50",
      )}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-action/10">
        {writing ? (
          <Loader2 className="size-4 animate-spin text-action" />
        ) : (
          <Icon className="size-4 text-action" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{artifact.title}</span>
        <span className="block truncate text-2xs text-muted-foreground">
          {writing ? "Writing…" : KIND[artifact.type]}
          {lines > 0 && ` · ${lines} line${lines === 1 ? "" : "s"}`}
          {errorCount > 0 && (
            <span className="text-danger">
              {" · "}
              {errorCount} error{errorCount === 1 ? "" : "s"}
            </span>
          )}
        </span>
      </span>
      <span className="shrink-0 text-2xs text-muted-foreground transition-colors group-hover/card:text-action">
        Open
      </span>
    </button>
  );
}

/**
 * The artifact was patched by the `artifact` tool rather than rewritten.
 *
 * Worth its own marker: the transcript has no code for that turn — the model
 * sent a fragment, not a document — so without this the panel would silently
 * change and the turn would look like it did nothing.
 */
export function ArtifactPatchNote({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="my-1.5 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2/40 px-2.5 py-1.5 text-2xs text-muted-foreground transition-colors hover:border-action/40 hover:text-foreground"
    >
      <GitBranch className="size-3 text-action" /> Artifact updated
    </button>
  );
}
