"use client";

// Conversation list rail, split out of chat-client.tsx. Pure presentation over
// the chat store — no streaming or send logic lives here.

import * as React from "react";
import { Brain, FolderGit2, MessageSquare, Pencil, Pin, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChatStore } from "@/lib/store/chat-store";
import { groupByRecency } from "@/lib/chat/history-groups";
import { cn, timeAgo } from "@/lib/utils";

// ── Sidebar ───────────────────────────────────────────────────────────────
export function HistoryRail({
  activeId,
  onNew,
  onSelect,
  onOpenProjects,
  onOpenMemory,
}: {
  activeId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onOpenProjects: () => void;
  onOpenMemory: () => void;
}) {
    const conversations = useChatStore((s) => s.conversations);
    const rename = useChatStore((s) => s.rename);
    const togglePin = useChatStore((s) => s.togglePin);
    const remove = useChatStore((s) => s.remove);
    const [q, setQ] = React.useState("");
    const [editingId, setEditingId] = React.useState<string | null>(null);
    const [draft, setDraft] = React.useState("");

    // Temporary (incognito) conversations are excluded: this rail is the chat
    // *history*, and a chat that is never saved has no place in it. The active
    // temporary thread still renders — it just isn't listed.
    const saved = conversations.filter((c) => !c.temporary);
    const filtered = saved.filter((c) =>
      c.title.toLowerCase().includes(q.toLowerCase()),
    );
    // Pinned, then by day. Two buckets was two buckets for what is often a
    // hundred rows, so everything past the last few days became one
    // undifferentiated scroll and finding a chat meant reading titles.
    const groups = React.useMemo(() => groupByRecency(filtered), [filtered]);

    const groupEl = (list: typeof conversations, heading: string) =>
      list.length > 0 && (
        <div key={heading}>
          <p className="px-2 py-1.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
            {heading}
          </p>
          {list.map((c) => (
            <div
              key={c.id}
              className={cn(
                "group/item flex items-center gap-1 rounded-lg pr-1 transition-colors",
                c.id === activeId ? "bg-surface-2/80" : "hover:bg-surface-2/50",
              )}
            >
              {editingId === c.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => {
                    rename(c.id, draft);
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      rename(c.id, draft);
                      setEditingId(null);
                    } else if (e.key === "Escape") setEditingId(null);
                  }}
                  className="m-1 h-7 flex-1 rounded-md border border-action/40 bg-surface-2 px-2 text-sm outline-none"
                />
              ) : (
                <button
                  onClick={() => onSelect(c.id)}
                  className="flex min-w-0 flex-1 items-start gap-2.5 px-2 py-2 text-left text-sm text-muted-foreground group-hover/item:text-foreground"
                >
                  <MessageSquare className="mt-0.5 size-4 shrink-0 opacity-70" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1">
                      {c.pinned && <Pin className="size-3 shrink-0 text-amber" />}
                      <span className="truncate">{c.title}</span>
                    </span>
                    <span className="text-2xs text-muted-foreground/70">
                      {timeAgo(c.updatedAt)}
                    </span>
                  </span>
                </button>
              )}
              {/* Always visible below `sm`: there is no hover on touch, so these
                  were simply unreachable on a phone. */}
              <div className="flex shrink-0 items-center transition-opacity sm:opacity-0 sm:group-hover/item:opacity-100 sm:focus-within:opacity-100">
                <RailAction title={c.pinned ? "Unpin" : "Pin"} onClick={() => togglePin(c.id)}>
                  <Pin className={cn("size-3.5", c.pinned && "text-amber")} />
                </RailAction>
                <RailAction
                  title="Rename"
                  onClick={() => {
                    setEditingId(c.id);
                    setDraft(c.title);
                  }}
                >
                  <Pencil className="size-3.5" />
                </RailAction>
                <RailAction title="Delete" onClick={() => remove(c.id)}>
                  <Trash2 className="size-3.5" />
                </RailAction>
              </div>
            </div>
          ))}
        </div>
      );

    return (
      <div className="flex h-full flex-col">
        <div className="space-y-2 p-3">
          <Button variant="secondary" className="w-full justify-start" onClick={onNew}>
            <Plus className="size-4" /> New chat
          </Button>
          <div className="flex gap-2">
            <button
              onClick={onOpenProjects}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-1.5 text-xs text-muted-foreground hover:border-action/40 hover:text-foreground"
            >
              <FolderGit2 className="size-3.5 text-action" /> Projects
            </button>
            <button
              onClick={onOpenMemory}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-1.5 text-xs text-muted-foreground hover:border-action/40 hover:text-foreground"
            >
              <Brain className="size-3.5 text-accent" /> Memory
            </button>
          </div>
        </div>
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search chats…"
              className="h-9 pl-8 text-sm"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-3">
          {saved.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No conversations yet.
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No matches.
            </p>
          ) : (
            <>{groups.map((g) => groupEl(g.items, g.bucket))}</>
          )}
        </div>
      </div>
    );
  }

export function RailAction({
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

