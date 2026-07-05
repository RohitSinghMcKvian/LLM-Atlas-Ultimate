"use client";

import * as React from "react";
import { Brain, Plus, Trash2, Sparkle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useMemoryStore } from "@/lib/store/memory-store";
import { cn, timeAgo } from "@/lib/utils";

export function MemoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { items, add, update, remove, clear } = useMemoryStore();
  const [draft, setDraft] = React.useState("");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editText, setEditText] = React.useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="size-4 text-violet" /> Memory
          </DialogTitle>
          <DialogDescription>
            Facts Atlas remembers across chats and injects when relevant. Say
            &ldquo;remember …&rdquo; in a chat to add one automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) {
                add(draft, "manual");
                setDraft("");
              }
            }}
            placeholder="Add a memory… e.g. 'Prefers metric units'"
            className="h-9 flex-1 rounded-lg border border-border bg-surface-2/50 px-3 text-sm outline-none focus:border-cyan/40"
          />
          <Button
            size="sm"
            onClick={() => {
              if (draft.trim()) {
                add(draft, "manual");
                setDraft("");
              }
            }}
          >
            <Plus className="size-4" /> Add
          </Button>
        </div>

        <div className="max-h-[45vh] space-y-1.5 overflow-y-auto">
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No memories yet.
            </p>
          ) : (
            items.map((it) => (
              <div
                key={it.id}
                className="group flex items-start gap-2 rounded-lg border border-border bg-surface-2/40 px-3 py-2"
              >
                <Sparkle
                  className={cn(
                    "mt-0.5 size-3.5 shrink-0",
                    it.source === "auto" ? "text-cyan" : "text-violet",
                  )}
                />
                {editingId === it.id ? (
                  <input
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onBlur={() => {
                      if (editText.trim()) update(it.id, editText);
                      setEditingId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (editText.trim()) update(it.id, editText);
                        setEditingId(null);
                      } else if (e.key === "Escape") setEditingId(null);
                    }}
                    className="h-6 flex-1 rounded border border-cyan/40 bg-surface px-2 text-sm outline-none"
                  />
                ) : (
                  <button
                    onClick={() => {
                      setEditingId(it.id);
                      setEditText(it.content);
                    }}
                    className="min-w-0 flex-1 text-left text-sm"
                  >
                    {it.content}
                    <span className="ml-2 text-2xs text-muted-foreground/60">
                      {timeAgo(it.createdAt)}
                    </span>
                  </button>
                )}
                <button
                  onClick={() => remove(it.id)}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  title="Delete"
                >
                  <Trash2 className="size-3.5 text-muted-foreground hover:text-danger" />
                </button>
              </div>
            ))
          )}
        </div>

        {items.length > 0 && (
          <div className="flex justify-end">
            <button
              onClick={clear}
              className="text-2xs text-muted-foreground hover:text-danger"
            >
              Clear all memories
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
