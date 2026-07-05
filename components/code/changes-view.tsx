"use client";

import * as React from "react";
import { FileDiff, RotateCcw, ChevronRight, Pencil, FilePlus2, Trash2 } from "lucide-react";
import { DiffViewer, diffLines, diffStat } from "@/components/diff-viewer";
import type { ChangeRecord } from "@/lib/code/tools";
import { cn, timeAgo } from "@/lib/utils";

const TOOL_ICON = {
  write_file: FilePlus2,
  edit_file: Pencil,
  delete_file: Trash2,
  editor: Pencil,
} as const;

/** Every change the agent (or the editor) made this session, with diffs. */
export function ChangesView({
  changes,
  onRevert,
  reverting,
}: {
  changes: ChangeRecord[];
  onRevert: (id: string) => void;
  reverting?: boolean;
}) {
  const [openId, setOpenId] = React.useState<string | null>(
    changes.length ? changes[changes.length - 1].id : null,
  );
  const ordered = [...changes].reverse();

  if (changes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-[#0b0d14] text-center">
        <FileDiff className="size-6 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          No changes yet — diffs appear here as files are written.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-[#0b0d14] p-3">
      <div className="space-y-2">
        {ordered.map((c) => {
          const { added, removed } = diffStat(diffLines(c.before ?? "", c.after ?? ""));
          const open = openId === c.id;
          const Icon = TOOL_ICON[c.tool];
          return (
            <div key={c.id} className="overflow-hidden rounded-xl border border-border">
              <div className="flex w-full items-center gap-2 bg-surface/60 px-3 py-2 text-left text-xs">
                <button
                  onClick={() => setOpenId(open ? null : c.id)}
                  className="flex min-w-0 flex-1 items-center gap-2"
                >
                  <ChevronRight
                    className={cn(
                      "size-3.5 shrink-0 text-muted-foreground transition-transform",
                      open && "rotate-90",
                    )}
                  />
                  <Icon className="size-3.5 shrink-0 text-cyan" />
                  <span className="truncate font-mono">{c.path}</span>
                  {c.after === null ? (
                    <span className="text-danger">deleted</span>
                  ) : (
                    <span className="shrink-0">
                      <span className="text-success">+{added}</span>{" "}
                      <span className="text-danger">-{removed}</span>
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-muted-foreground/60">
                    {c.tool === "editor" ? "manual edit" : c.tool} · {timeAgo(c.ts)}
                  </span>
                </button>
                <button
                  title={c.before === null ? "Delete the created file" : "Restore previous content"}
                  disabled={reverting}
                  onClick={() => onRevert(c.id)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-1 text-2xs text-muted-foreground hover:border-amber/50 hover:text-amber disabled:opacity-40"
                >
                  <RotateCcw className="size-3" /> Revert
                </button>
              </div>
              {open && c.after !== null && (
                <div className="max-h-96 overflow-auto border-t border-border">
                  <DiffViewer oldText={c.before ?? ""} newText={c.after} />
                </div>
              )}
              {open && c.after === null && c.before && (
                <div className="max-h-96 overflow-auto border-t border-border">
                  <DiffViewer oldText={c.before} newText="" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
