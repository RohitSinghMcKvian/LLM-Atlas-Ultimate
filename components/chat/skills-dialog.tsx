"use client";

import * as React from "react";
import { AlertTriangle, Plus, RotateCcw, Sparkles, Trash2, Wrench } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  deleteSkill,
  listSkills,
  restoreBuiltinSkills,
  saveSkillMd,
  setSkillEnabled,
} from "@/lib/skills/registry";
import { isParseError, toSkillMd, type Skill } from "@/lib/skills/parse";
import { cn, timeAgo } from "@/lib/utils";

const TEMPLATE = `---
name: My skill
description: Use when … (one line telling Atlas exactly when this applies)
---

Write the instructions here.
`;

export function SkillsDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Fired after any change, so the caller can refresh its enabled count. */
  onChanged?: () => void;
}) {
  const [skills, setSkills] = React.useState<Skill[]>([]);
  const [editing, setEditing] = React.useState<{ id?: string; text: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const reload = React.useCallback(() => {
    void listSkills()
      .then(setSkills)
      .catch(() => setSkills([]));
    onChanged?.();
  }, [onChanged]);

  React.useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  async function commit() {
    if (!editing) return;
    const r = await saveSkillMd(editing.text, { id: editing.id });
    if (isParseError(r)) {
      setError(r.error);
      return;
    }
    setError(null);
    setEditing(null);
    reload();
  }

  const enabledCount = skills.filter((s) => s.enabled).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-amber" /> Skills
          </DialogTitle>
          <DialogDescription>
            Reusable instructions Atlas loads when a task matches. Only each skill&rsquo;s
            name and description stay in context — the body is fetched on demand.
          </DialogDescription>
        </DialogHeader>

        {editing ? (
          <>
            <textarea
              autoFocus
              value={editing.text}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
              spellCheck={false}
              rows={16}
              className="w-full resize-none rounded-lg border border-border bg-surface-2/50 px-3 py-2 font-mono text-xs outline-none focus:border-action/40"
            />
            {error && (
              <p className="flex items-start gap-1.5 text-2xs text-danger">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setError(null);
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={commit}>
                Save skill
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <p className="text-2xs text-muted-foreground">
                {skills.length === 0
                  ? "No skills installed."
                  : `${enabledCount} of ${skills.length} enabled and offered to the model.`}
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => void restoreBuiltinSkills().then(reload)}
                title="Reinstall the shipped skills, overwriting local edits to them"
              >
                <RotateCcw className="size-3.5" /> Restore built-ins
              </Button>
              <Button size="sm" onClick={() => setEditing({ text: TEMPLATE })}>
                <Plus className="size-4" /> New skill
              </Button>
            </div>

            <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
              {skills.map((s) => (
                <div
                  key={s.id}
                  className={cn(
                    "group rounded-lg border bg-surface-2/40 px-3 py-2",
                    s.enabled ? "border-border" : "border-border/50 opacity-60",
                  )}
                >
                  <div className="flex items-center gap-2">
                    {/* Enabling is the single most consequential control here —
                        it decides what is in every request — so it is a real
                        checkbox, not a hover-revealed menu item. */}
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={(e) => void setSkillEnabled(s.id, e.target.checked).then(reload)}
                      aria-label={`Enable ${s.name}`}
                      className="size-3.5 accent-action"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.name}</span>
                    {s.source === "builtin" && (
                      <span className="rounded bg-surface px-1.5 py-0.5 text-2xs text-muted-foreground">
                        built-in
                      </span>
                    )}
                    {s.allowedTools && (
                      <span
                        className="inline-flex items-center gap-1 text-2xs text-muted-foreground"
                        title={
                          s.allowedTools.length === 0
                            ? "This skill may use no tools"
                            : `Limited to: ${s.allowedTools.join(", ")}`
                        }
                      >
                        <Wrench className="size-3" />
                        {s.allowedTools.length === 0 ? "no tools" : s.allowedTools.length}
                      </span>
                    )}
                    <span className="text-2xs text-muted-foreground/60">
                      {timeAgo(s.updatedAt)}
                    </span>
                    <button
                      onClick={() => {
                        setError(null);
                        setEditing({ id: s.id, text: toSkillMd(s) });
                      }}
                      className="text-2xs text-muted-foreground hover:text-action"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void deleteSkill(s.id).then(reload)}
                      title="Delete"
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5 text-muted-foreground hover:text-danger" />
                    </button>
                  </div>
                  <p className="mt-1 pl-6 text-2xs text-muted-foreground">{s.description}</p>
                </div>
              ))}
            </div>

            <p className="text-2xs text-muted-foreground/70">
              A skill is instructions Atlas will follow. Only install ones you wrote or
              trust — a skill from elsewhere can tell Atlas to behave in ways you did not
              intend.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
