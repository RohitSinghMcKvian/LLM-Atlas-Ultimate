"use client";

// Change-set review (Depth v2 B.3): the agent stages a todo's edits across N
// files; this presents one grouped review with per-file / per-hunk accept or
// reject, applied atomically. Reject-all restores the pre-todo checkpoint.

import * as React from "react";
import { Check, ChevronDown, FileDiff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DiffViewer } from "@/components/diff-viewer";
import type { ChangeSet, Hunk } from "@/lib/engine/types";
import { changeSetFiles } from "@/lib/engine/changeset";
import { cn } from "@/lib/utils";

export function ChangeSetReview({
  changeSet,
  onResolve,
}: {
  changeSet: ChangeSet;
  /** accepted = the hunks (with .accepted decisions) to apply; null = revert all. */
  onResolve: (hunks: Hunk[] | null) => void;
}) {
  const [hunks, setHunks] = React.useState<Hunk[]>(() =>
    changeSet.hunks.map((h) => ({ ...h })),
  );
  const files = changeSetFiles(changeSet);
  const setHunk = (idx: number, accepted: boolean) =>
    setHunks((hs) => hs.map((h, i) => (i === idx ? { ...h, accepted } : h)));
  const rejectedCount = hunks.filter((h) => !h.accepted).length;

  return (
    <div className="border-t border-violet/30 bg-violet/5 px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2">
        <FileDiff className="size-4 shrink-0 text-violet" />
        <p className="min-w-0 flex-1 text-xs">
          <span className="font-medium">Review change set — {changeSet.label}.</span>{" "}
          <span className="text-muted-foreground">
            {files.length} file{files.length === 1 ? "" : "s"}, {hunks.length} hunk
            {hunks.length === 1 ? "" : "s"}. Reject any hunk to revert just that region.
          </span>
        </p>
      </div>

      <div className="max-h-72 space-y-2 overflow-y-auto">
        {files.map((path) => (
          <FileHunks
            key={path}
            path={path}
            hunks={hunks
              .map((h, i) => ({ h, i }))
              .filter(({ h }) => h.path === path)}
            onDecision={setHunk}
          />
        ))}
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <Button size="sm" variant="primary" onClick={() => onResolve(hunks)}>
          <Check className="size-3.5" />
          {rejectedCount ? `Apply (${rejectedCount} rejected)` : "Accept all"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onResolve(null)}>
          <X className="size-3.5" /> Revert all (restore checkpoint)
        </Button>
      </div>
    </div>
  );
}

function FileHunks({
  path,
  hunks,
  onDecision,
}: {
  path: string;
  hunks: { h: Hunk; i: number }[];
  onDecision: (idx: number, accepted: boolean) => void;
}) {
  const [open, setOpen] = React.useState(true);
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-surface-2/50 px-2.5 py-1.5 text-left"
      >
        <ChevronDown className={cn("size-3 transition-transform", !open && "-rotate-90")} />
        <code className="truncate text-xs">{path}</code>
        <span className="ml-auto text-2xs text-muted-foreground">
          {hunks.filter(({ h }) => h.accepted).length}/{hunks.length} kept
        </span>
      </button>
      {open && (
        <div className="space-y-1.5 p-2">
          {hunks.map(({ h, i }) => (
            <div key={i} className="rounded-lg border border-border/60">
              <div className="flex items-center justify-between gap-2 px-2 py-1">
                <span className="text-2xs text-muted-foreground">
                  hunk @ line {h.startBefore + 1}
                </span>
                <div className="flex overflow-hidden rounded-md border border-border text-2xs">
                  <button
                    onClick={() => onDecision(i, true)}
                    className={cn(
                      "px-2 py-0.5",
                      h.accepted ? "bg-success/15 text-success" : "text-muted-foreground hover:bg-surface-2",
                    )}
                  >
                    keep
                  </button>
                  <button
                    onClick={() => onDecision(i, false)}
                    className={cn(
                      "px-2 py-0.5",
                      !h.accepted ? "bg-danger/15 text-danger" : "text-muted-foreground hover:bg-surface-2",
                    )}
                  >
                    reject
                  </button>
                </div>
              </div>
              <DiffViewer
                oldText={h.before}
                newText={h.after}
                className={cn("rounded-none border-0 text-[11px]", !h.accepted && "opacity-50")}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
