"use client";

import * as React from "react";
import {
  History,
  Star,
  Trash2,
  RotateCcw,
  AlertCircle,
  StickyNote,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { usePlaygroundStore } from "@/lib/store/playground-store";
import { getModelById } from "@/lib/catalog";
import { formatUsd } from "@/lib/chat/cost";
import { cn, timeAgo } from "@/lib/utils";

export function HistoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const runs = usePlaygroundStore((s) => s.runs);
  const toggleStar = usePlaygroundStore((s) => s.toggleStar);
  const setNote = usePlaygroundStore((s) => s.setNote);
  const deleteRun = usePlaygroundStore((s) => s.deleteRun);
  const clearRuns = usePlaygroundStore((s) => s.clearRuns);
  const restoreRun = usePlaygroundStore((s) => s.restoreRun);
  const [noteId, setNoteId] = React.useState<string | null>(null);
  const [noteDraft, setNoteDraft] = React.useState("");
  const [filter, setFilter] = React.useState<"all" | "starred">("all");

  const shown = filter === "starred" ? runs.filter((r) => r.starred) : runs;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4 text-cyan" /> Run history
          </DialogTitle>
          <DialogDescription>
            Every run is recorded with its full config and metrics. Restore one
            to reload its setup into the editor.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-surface-2/60 p-0.5 text-xs">
            {(["all", "starred"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-md px-2.5 py-1 capitalize",
                  filter === f && "bg-surface shadow-sm",
                )}
              >
                {f}
              </button>
            ))}
          </div>
          {runs.some((r) => !r.starred) && (
            <button
              onClick={clearRuns}
              className="ml-auto text-2xs text-muted-foreground hover:text-danger"
            >
              Clear unstarred
            </button>
          )}
        </div>

        <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {shown.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No runs yet — hit Run and they&apos;ll collect here.
            </p>
          ) : (
            shown.map((r) => {
              const m = getModelById(r.modelId);
              const met = r.metrics;
              return (
                <div
                  key={r.id}
                  className="rounded-xl border border-border bg-surface-2/40 p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{m?.name ?? r.modelId}</span>
                    {r.error && <AlertCircle className="size-3.5 text-danger" />}
                    <span className="text-2xs text-muted-foreground">
                      {timeAgo(r.createdAt)}
                    </span>
                    <div className="ml-auto flex items-center gap-0.5">
                      <IconBtn
                        title={r.starred ? "Unstar" : "Star"}
                        onClick={() => toggleStar(r.id)}
                      >
                        <Star
                          className={cn(
                            "size-3.5",
                            r.starred && "fill-amber text-amber",
                          )}
                        />
                      </IconBtn>
                      <IconBtn
                        title="Add note"
                        onClick={() => {
                          setNoteId(noteId === r.id ? null : r.id);
                          setNoteDraft(r.note ?? "");
                        }}
                      >
                        <StickyNote className="size-3.5" />
                      </IconBtn>
                      <IconBtn
                        title="Restore this config"
                        onClick={() => {
                          restoreRun(r.id);
                          onOpenChange(false);
                        }}
                      >
                        <RotateCcw className="size-3.5" />
                      </IconBtn>
                      <IconBtn title="Delete" onClick={() => deleteRun(r.id)}>
                        <Trash2 className="size-3.5" />
                      </IconBtn>
                    </div>
                  </div>

                  <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                    {r.error ? r.error : r.output || "(no output)"}
                  </p>

                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-muted-foreground/70">
                    {met.ttftMs != null && <span>TTFT {(met.ttftMs / 1000).toFixed(2)}s</span>}
                    {met.totalMs != null && <span>{(met.totalMs / 1000).toFixed(1)}s total</span>}
                    {met.tps != null && <span>{met.tps.toFixed(0)} tok/s</span>}
                    {met.completionTokens != null && (
                      <span>
                        {met.promptTokens ?? "?"} in · {met.completionTokens} out
                      </span>
                    )}
                    {met.costUsd != null && met.costUsd > 0 && (
                      <span>{formatUsd(met.costUsd)}</span>
                    )}
                  </div>

                  {r.note && noteId !== r.id && (
                    <p className="mt-1.5 rounded-lg bg-amber/10 px-2 py-1 text-2xs text-amber">
                      {r.note}
                    </p>
                  )}
                  {noteId === r.id && (
                    <input
                      autoFocus
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      onBlur={() => {
                        setNote(r.id, noteDraft.trim());
                        setNoteId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          setNote(r.id, noteDraft.trim());
                          setNoteId(null);
                        } else if (e.key === "Escape") setNoteId(null);
                      }}
                      placeholder="Add a note…"
                      className="mt-1.5 h-7 w-full rounded-lg border border-cyan/40 bg-surface px-2 text-xs outline-none"
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function IconBtn({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-surface-3 hover:text-foreground"
    >
      {children}
    </button>
  );
}
