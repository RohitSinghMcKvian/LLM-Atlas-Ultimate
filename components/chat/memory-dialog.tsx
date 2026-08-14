"use client";

import * as React from "react";
import { Brain, FileText, Plus, RefreshCw, Trash2, Sparkle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useMemoryStore } from "@/lib/store/memory-store";
import { MEMORY_CATEGORIES, categoryOf, type MemoryCategory } from "@/lib/chat/memory";
import { deleteMemoryFile, listMemoryFiles } from "@/lib/chat/memory-repo";
import { clearPastChatIndex, indexedConversationCount } from "@/lib/chat/chat-index";
import type { MemoryFile } from "@/lib/chat/memory-fs";
import { cn, timeAgo } from "@/lib/utils";

type Tab = "facts" | "files";

export function MemoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const {
    items,
    summary,
    add,
    update,
    setCategory,
    remove,
    clearCategory,
    clear,
    setSummary,
    regenerateSummary,
  } = useMemoryStore();
  const [tab, setTab] = React.useState<Tab>("facts");
  const [draft, setDraft] = React.useState("");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editText, setEditText] = React.useState("");
  const [files, setFiles] = React.useState<MemoryFile[]>([]);
  const [indexedChats, setIndexedChats] = React.useState(0);

  // Memory files and the past-chat index live in IndexedDB, not in the store, so
  // they're loaded when the dialog opens rather than subscribed to.
  const reloadFiles = React.useCallback(() => {
    void listMemoryFiles().then(setFiles).catch(() => setFiles([]));
    void indexedConversationCount().then(setIndexedChats).catch(() => setIndexedChats(0));
  }, []);

  React.useEffect(() => {
    if (open) reloadFiles();
  }, [open, reloadFiles]);

  const grouped = React.useMemo(() => {
    const map = new Map<MemoryCategory, typeof items>();
    for (const it of items) {
      const c = categoryOf(it);
      map.set(c, [...(map.get(c) ?? []), it]);
    }
    return map;
  }, [items]);

  function commitDraft() {
    if (!draft.trim()) return;
    add(draft, "manual");
    setDraft("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="size-4 text-accent" /> Memory
          </DialogTitle>
          <DialogDescription>
            What Atlas remembers across chats. Say &ldquo;remember …&rdquo; in a chat to add
            a fact; Atlas keeps its own notes as files.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-0.5 rounded-lg bg-surface-2 p-0.5 text-xs">
          {(
            [
              ["facts", `Facts${items.length ? ` (${items.length})` : ""}`],
              ["files", `Notes${files.length ? ` (${files.length})` : ""}`],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex-1 rounded-md py-1.5 transition-colors",
                tab === id ? "bg-surface font-medium shadow-sm" : "text-muted-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "facts" ? (
          <>
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && commitDraft()}
                placeholder="Add a memory… e.g. 'Prefers metric units'"
                className="h-9 flex-1 rounded-lg border border-border bg-surface-2/50 px-3 text-sm outline-none focus:border-action/40"
              />
              <Button size="sm" onClick={commitDraft}>
                <Plus className="size-4" /> Add
              </Button>
            </div>

            <div className="max-h-[38vh] space-y-3 overflow-y-auto">
              {items.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No memories yet.
                </p>
              ) : (
                MEMORY_CATEGORIES.map((cat) => {
                  const list = grouped.get(cat.id);
                  if (!list?.length) return null;
                  return (
                    <section key={cat.id}>
                      <header className="mb-1 flex items-baseline gap-2 px-1">
                        <h3 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                          {cat.label}
                        </h3>
                        <span className="text-2xs text-muted-foreground/50">{cat.hint}</span>
                        <button
                          onClick={() => clearCategory(cat.id)}
                          className="ml-auto text-2xs text-muted-foreground/60 hover:text-danger"
                        >
                          Clear
                        </button>
                      </header>
                      <div className="space-y-1.5">
                        {list.map((it) => (
                          <div
                            key={it.id}
                            className="group flex items-start gap-2 rounded-lg border border-border bg-surface-2/40 px-3 py-2"
                          >
                            <Sparkle
                              className={cn(
                                "mt-0.5 size-3.5 shrink-0",
                                it.source === "auto" ? "text-action" : "text-accent",
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
                                className="h-6 flex-1 rounded border border-action/40 bg-surface px-2 text-sm outline-none"
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
                            {/* Recategorising is how a wrong auto-classification
                                gets fixed, so it lives on the row itself. */}
                            <select
                              value={categoryOf(it)}
                              onChange={(e) => setCategory(it.id, e.target.value as MemoryCategory)}
                              aria-label="Category"
                              className="rounded border border-border bg-surface px-1 py-0.5 text-2xs text-muted-foreground opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                            >
                              {MEMORY_CATEGORIES.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.label}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => remove(it.id)}
                              title="Delete"
                              className="opacity-0 transition-opacity group-hover:opacity-100"
                            >
                              <Trash2 className="size-3.5 text-muted-foreground hover:text-danger" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>
                  );
                })
              )}
            </div>

            <div className="space-y-1.5 border-t border-border pt-3">
              <div className="flex items-center gap-2">
                <h3 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                  Summary
                </h3>
                <span className="text-2xs text-muted-foreground/50">
                  Sent with every chat
                </span>
                <button
                  onClick={regenerateSummary}
                  disabled={items.length === 0}
                  title="Rewrite from the facts above — this replaces your edits"
                  className="ml-auto inline-flex items-center gap-1 text-2xs text-muted-foreground hover:text-action disabled:opacity-40"
                >
                  <RefreshCw className="size-3" /> Regenerate
                </button>
              </div>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={3}
                placeholder="Optional. A short description of what Atlas should keep in mind about you."
                className="w-full resize-none rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-sm outline-none focus:border-action/40"
              />
            </div>

            {(items.length > 0 || summary) && (
              <div className="flex justify-end">
                <button
                  onClick={clear}
                  className="text-2xs text-muted-foreground hover:text-danger"
                >
                  Clear all memories
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="max-h-[45vh] space-y-1.5 overflow-y-auto">
              {files.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No notes yet. Atlas writes these itself when something is worth keeping.
                </p>
              ) : (
                files
                  .slice()
                  .sort((a, b) => a.path.localeCompare(b.path))
                  .map((f) => (
                    <details
                      key={f.path}
                      className="group rounded-lg border border-border bg-surface-2/40"
                    >
                      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
                        <FileText className="size-3.5 shrink-0 text-action" />
                        <span className="min-w-0 flex-1 truncate">{f.path}</span>
                        <span className="text-2xs text-muted-foreground/60">
                          {timeAgo(f.updatedAt)}
                        </span>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            void deleteMemoryFile(f.path).then(reloadFiles);
                          }}
                          title="Delete note"
                        >
                          <Trash2 className="size-3.5 text-muted-foreground hover:text-danger" />
                        </button>
                      </summary>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-t border-border px-3 py-2 text-2xs text-muted-foreground">
                        {f.text}
                      </pre>
                    </details>
                  ))
              )}
            </div>

            <div className="space-y-1.5 border-t border-border pt-3 text-2xs text-muted-foreground">
              <p>
                {indexedChats === 0
                  ? "No past conversations are indexed for search."
                  : `${indexedChats} conversation${indexedChats === 1 ? "" : "s"} indexed for past-chat search.`}
              </p>
              {indexedChats > 0 && (
                <button
                  onClick={() => void clearPastChatIndex().then(reloadFiles)}
                  className="hover:text-danger"
                >
                  Clear past-chat search index
                </button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
