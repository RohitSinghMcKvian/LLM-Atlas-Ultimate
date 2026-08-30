"use client";

import * as React from "react";
import { GitCompareArrows, Pencil, Pin, Plus, Search, Trash2, VenetianMask } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RailAction } from "@/components/chat/history-rail";
import { groupByRecency } from "@/lib/chat/history-groups";
import { BAND_RGB } from "@/lib/compare/bands";
import { describeSession, type CompareSession } from "@/lib/compare/session";
import { bandFor } from "@/lib/compare/lanes";
import { cn, timeAgo } from "@/lib/utils";

/**
 * Past comparison sessions.
 *
 * Structurally a copy of `components/chat/history-rail.tsx`, down to the class
 * names, because two rails in one product that look almost the same are worse
 * than two that look identical. `RailAction` and `groupByRecency` are imported
 * from there rather than re-declared — `groupByRecency` is generic over
 * `{ id, updatedAt, pinned? }` and `CompareSession` satisfies it unchanged.
 *
 * Three differences, each earning its place:
 *
 *   * a second line with the turn count and the lane swatches, so you can tell
 *     two sessions on the same topic apart without opening either;
 *   * a temporary session is never listed, because it was never written;
 *   * delete confirms, unlike chat's, because a session is many turns and much
 *     more money than one conversation.
 */

export interface SessionRailProps {
  sessions: CompareSession[];
  activeId: string | null;
  onNew: (incognito: boolean) => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
  footer?: React.ReactNode;
}

export function SessionRail({
  sessions,
  activeId,
  onNew,
  onSelect,
  onRename,
  onTogglePin,
  onDelete,
  footer,
}: SessionRailProps) {
  const [q, setQ] = React.useState("");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const [confirmId, setConfirmId] = React.useState<string | null>(null);

  // A temporary session has no place in the history: it was never saved, and
  // listing it would be the interface contradicting its own promise.
  const saved = React.useMemo(() => sessions.filter((s) => !s.incognito), [sessions]);
  const filtered = React.useMemo(
    () => saved.filter((s) => s.title.toLowerCase().includes(q.toLowerCase())),
    [saved, q],
  );
  const groups = React.useMemo(() => groupByRecency(filtered), [filtered]);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 p-3">
        <Button variant="secondary" className="w-full justify-start" onClick={() => onNew(false)}>
          <Plus className="size-4" /> New comparison
        </Button>
        <button
          onClick={() => onNew(true)}
          title="Start a session that is never written to this device"
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-1.5 text-xs text-muted-foreground transition-colors hover:border-accent/50 hover:text-foreground"
        >
          <VenetianMask className="size-3.5 text-accent" /> Temporary session
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 pl-8 text-sm"
            placeholder="Search comparisons…"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-3">
        {saved.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            No comparisons yet.
          </p>
        )}
        {saved.length > 0 && filtered.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">No matches.</p>
        )}

        {groups.map((group) => (
          <div key={group.bucket}>
            <p className="px-2 py-1.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
              {group.bucket}
            </p>
            {group.items.map((s) => {
              const editing = editingId === s.id;
              return (
                <div
                  key={s.id}
                  className={cn(
                    "group/item flex items-center gap-1 rounded-lg pr-1 transition-colors",
                    activeId === s.id ? "bg-surface-2/80" : "hover:bg-surface-2/50",
                  )}
                >
                  {editing ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => {
                        onRename(s.id, draft);
                        setEditingId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          onRename(s.id, draft);
                          setEditingId(null);
                        }
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="m-1 h-7 flex-1 rounded-md border border-action/40 bg-surface-2 px-2 text-sm outline-none"
                    />
                  ) : (
                    <button
                      onClick={() => onSelect(s.id)}
                      className="flex min-w-0 flex-1 items-start gap-2.5 px-2 py-2 text-left text-sm text-muted-foreground group-hover/item:text-foreground"
                    >
                      <GitCompareArrows className="mt-0.5 size-4 shrink-0 opacity-70" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1">
                          {s.pinned && <Pin className="size-3 shrink-0 text-amber" />}
                          <span className="truncate">{s.title}</span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5">
                          <span className="flex shrink-0 items-center gap-0.5" aria-hidden>
                            {s.modelIds.slice(0, 6).map((id, i) => (
                              <span
                                key={id}
                                className="size-1.5 rounded-[2px]"
                                style={{ backgroundColor: BAND_RGB[bandFor(i)] }}
                              />
                            ))}
                          </span>
                          <span className="truncate text-2xs text-muted-foreground/70">
                            {describeSession(s)} · {timeAgo(s.updatedAt)}
                          </span>
                        </span>
                      </span>
                    </button>
                  )}

                  <div className="flex shrink-0 items-center transition-opacity sm:opacity-0 sm:group-hover/item:opacity-100 sm:focus-within:opacity-100">
                    <RailAction title={s.pinned ? "Unpin" : "Pin"} onClick={() => onTogglePin(s.id)}>
                      <Pin className="size-3.5" />
                    </RailAction>
                    <RailAction
                      title="Rename"
                      onClick={() => {
                        setEditingId(s.id);
                        setDraft(s.title);
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </RailAction>
                    <RailAction
                      title={confirmId === s.id ? "Click again to delete" : "Delete"}
                      onClick={() => {
                        // Two clicks, unlike chat's rail: a session is every turn
                        // and everything they cost, and there is no undo.
                        if (confirmId === s.id) {
                          onDelete(s.id);
                          setConfirmId(null);
                        } else {
                          setConfirmId(s.id);
                        }
                      }}
                    >
                      <Trash2 className={cn("size-3.5", confirmId === s.id && "text-danger")} />
                    </RailAction>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {footer && <div className="border-t border-border p-2">{footer}</div>}
    </div>
  );
}
