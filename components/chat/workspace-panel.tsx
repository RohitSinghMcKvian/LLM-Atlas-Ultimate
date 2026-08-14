"use client";

import * as React from "react";
import { CircleDashed, CircleDot, CircleCheck, CircleAlert, FileCode2, Hammer } from "lucide-react";
import { cn } from "@/lib/utils";
import { toRelativePath } from "@/lib/chat/workspace/fs";
import type { TaskStatus, WorkspaceSnapshot } from "@/lib/chat/workspace/types";

/**
 * The build, made visible.
 *
 * Everything here is already in the model's system prompt on every turn. Showing
 * it is not decoration: a persistent workspace the user cannot see is a
 * conversation that quietly acquires state, and the first time they notice is
 * when the model refers to a file they have no way to open. This is the surface
 * that makes "it remembers the build" a claim they can check.
 *
 * Collapsed to a summary line until opened, because most conversations are not
 * builds and the panel should cost nothing when there is nothing in it.
 */

const STATUS_ICON: Record<TaskStatus, React.ComponentType<{ className?: string }>> = {
  pending: CircleDashed,
  active: CircleDot,
  done: CircleCheck,
  blocked: CircleAlert,
};

const STATUS_TONE: Record<TaskStatus, string> = {
  pending: "text-muted-foreground",
  active: "text-action",
  done: "text-emerald-400",
  blocked: "text-danger",
};

export function WorkspacePanel({
  snapshot,
  onOpenFile,
}: {
  snapshot: WorkspaceSnapshot;
  /** Show one workspace file in the artifact panel. */
  onOpenFile?: (path: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const { goal, files, tasks } = snapshot;

  if (!goal && files.length === 0 && tasks.length === 0) return null;

  const done = tasks.filter((t) => t.status === "done").length;
  const sortedTasks = [...tasks].sort((a, b) => a.order - b.order);
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

  return (
    <div className="mx-auto w-full max-w-3xl px-4">
      <div className="rounded-xl border border-border bg-surface-2/40">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Hammer className="size-3.5 shrink-0 text-action" />
          <span className="truncate font-medium text-foreground">
            {goal || "Build workspace"}
          </span>
          <span className="ml-auto shrink-0 tabular-nums">
            {tasks.length > 0 && `${done}/${tasks.length} steps · `}
            {files.length} file{files.length === 1 ? "" : "s"}
          </span>
        </button>

        {open && (
          <div className="space-y-3 border-t border-border px-3 py-2.5">
            {sortedTasks.length > 0 && (
              <ol className="space-y-1">
                {sortedTasks.map((t) => {
                  const Icon = STATUS_ICON[t.status];
                  return (
                    <li key={t.id} className="flex items-start gap-2 text-xs">
                      <Icon className={cn("mt-0.5 size-3.5 shrink-0", STATUS_TONE[t.status])} />
                      <span
                        className={cn(
                          "min-w-0",
                          t.status === "done" && "text-muted-foreground line-through",
                        )}
                      >
                        {t.title}
                        {t.note && (
                          <span className="text-muted-foreground"> — {t.note}</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}

            {sortedFiles.length > 0 && (
              <ul className="space-y-0.5">
                {sortedFiles.map((f) => {
                  const lines = f.content === "" ? 0 : f.content.split("\n").length;
                  return (
                    <li key={f.path}>
                      <button
                        onClick={() => onOpenFile?.(f.path)}
                        disabled={!onOpenFile}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs",
                          onOpenFile && "transition-colors hover:bg-surface-3/60 hover:text-action",
                        )}
                      >
                        <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate font-mono">{toRelativePath(f.path)}</span>
                        <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                          {lines}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
