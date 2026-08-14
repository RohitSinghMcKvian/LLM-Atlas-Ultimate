"use client";

import * as React from "react";
import { Activity, FolderTree, Monitor, X } from "lucide-react";
import { RunPanel } from "@/components/chat/run-panel";
import { FilesTab } from "@/components/chat/files-tab";
import { ArtifactPanel } from "@/components/chat/artifact-panel";
import type { ChatRailMountProps } from "@/components/chat/chat-rail-mount";
import { effectiveTab, tabEnabled, type RailTab } from "@/lib/chat/rail-state";
import { cn } from "@/lib/utils";

/**
 * One rail, three tabs.
 *
 * Process used to live in three places at once: a timeline folded inside each
 * bubble, a workspace strip above the composer, and the artifact in an aside. To
 * follow a build you had to watch all three, and the bubble — the place people
 * actually look — was the one showing nothing.
 *
 * They are the same question asked three ways: what is Atlas doing, what has it
 * made, what does it look like. So they share one surface and one width budget,
 * which also means the artifact keeps every pixel it had rather than losing half
 * of them to a second permanent panel.
 */
export type { RailTab };

const TABS: { id: RailTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "run", label: "Run", icon: Activity },
  { id: "files", label: "Files", icon: FolderTree },
  { id: "preview", label: "Preview", icon: Monitor },
];

export function ChatRail({
  tab,
  onTabChange,
  onClose,
  toolCalls,
  reasoning,
  progress,
  rounds,
  maxRounds,
  spentUsd,
  maxUsd,
  contextChars,
  contextWindow,
  stop,
  onContinueRun,
  onOpenSettings,
  workspace,
  streaming,
  elapsedMs,
  onStop,
  runSummary,
  conversationId,
  produced,
  artifactFiles,
  selectedPath,
  onSelectPath,
  artifactId,
  onRevert,
  onFix,
  onErrors,
  onRemix,
  onEditArtifact,
  onOpenWorkspaceFile,
}: ChatRailMountProps) {
  const hasPreview = artifactFiles.length > 0;
  // A tab persisted from an earlier session, or a build that produced only data
  // files, must never leave the body empty. This is what the rail renders.
  const shown = effectiveTab(tab, hasPreview);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
        <div role="tablist" aria-label="Build" className="flex min-w-0 flex-1 items-center gap-0.5">
          {TABS.map((t) => {
            const disabled = !tabEnabled(t.id, hasPreview);
            const active = shown === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                disabled={disabled}
                // A disabled tab is never stored: selecting it would persist a
                // value that renders nothing on the next load.
                onClick={() => !disabled && onTabChange(t.id)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors",
                  active
                    ? "bg-surface-2 text-foreground"
                    : disabled
                      ? "text-muted-foreground/40"
                      : "text-muted-foreground hover:bg-surface-2/60 hover:text-foreground",
                )}
              >
                <t.icon className={cn("size-3.5", active && "text-action")} />
                {t.label}
                {/* A live run is the one thing worth a badge here: the whole
                    point of the rail is that you can tell it is working without
                    switching to it. */}
                {t.id === "run" && streaming && !active && (
                  <span className="size-1.5 rounded-full bg-action animate-pulse-dot" />
                )}
              </button>
            );
          })}
        </div>
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1">
        {shown === "run" && (
          <RunPanel
            toolCalls={toolCalls}
            reasoning={reasoning}
            progress={progress}
            rounds={rounds}
            maxRounds={maxRounds}
            spentUsd={spentUsd}
            maxUsd={maxUsd}
            contextChars={contextChars}
            contextWindow={contextWindow}
            workspace={workspace}
            streaming={streaming}
            elapsedMs={elapsedMs}
            onStop={onStop}
            summary={runSummary}
            stop={stop}
            onContinueRun={onContinueRun}
            onOpenSettings={onOpenSettings}
          />
        )}
        {shown === "files" && (
          <FilesTab
            conversationId={conversationId}
            workspace={workspace}
            produced={produced}
            artifactPaths={artifactFiles.map((f) => f.path)}
            selectedPath={selectedPath}
            onOpenFile={onOpenWorkspaceFile}
          />
        )}
        {/* Mounted only while selected: the preview is a live sandboxed iframe
            running model-authored script, and keeping it alive behind a hidden
            tab would leave it executing where nobody can see it. */}
        {shown === "preview" && hasPreview && (
          <ArtifactPanel
            files={artifactFiles}
            selectedPath={selectedPath}
            onSelectPath={onSelectPath}
            artifactId={artifactId}
            onRevert={onRevert}
            onClose={onClose}
            onFix={onFix}
            onErrors={onErrors}
            onRemix={onRemix}
            onEdit={onEditArtifact}
            embedded
          />
        )}
      </div>
    </div>
  );
}
