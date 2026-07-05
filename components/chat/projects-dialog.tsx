"use client";

import * as React from "react";
import { FolderGit2, Plus, Trash2, FileText, Upload, ChevronLeft, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useProjectsStore, type Project } from "@/lib/store/projects-store";
import { parseAttachment } from "@/lib/chat/attachments";
import { cn } from "@/lib/utils";

export function ProjectsDialog({
  open,
  onOpenChange,
  activeProjectId,
  onAssign,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  activeProjectId: string | null;
  /** Assign (or clear) the current conversation's project. */
  onAssign: (projectId: string | null) => void;
}) {
  const { projects, create, remove } = useProjectsStore();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const editing = projects.find((p) => p.id === editingId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {editing && (
              <button onClick={() => setEditingId(null)} title="Back">
                <ChevronLeft className="size-4" />
              </button>
            )}
            <FolderGit2 className="size-4 text-cyan" />
            {editing ? editing.name : "Projects"}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "Instructions and files here are added to every chat in this project."
              : "Group chats and give them shared instructions and knowledge."}
          </DialogDescription>
        </DialogHeader>

        {editing ? (
          <ProjectEditor project={editing} />
        ) : (
          <ProjectList
            projects={projects}
            activeProjectId={activeProjectId}
            onOpen={setEditingId}
            onCreate={() => {
              const id = create("New project");
              setEditingId(id);
            }}
            onAssign={onAssign}
            onDelete={(id) => {
              if (activeProjectId === id) onAssign(null);
              remove(id);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProjectList({
  projects,
  activeProjectId,
  onOpen,
  onCreate,
  onAssign,
  onDelete,
}: {
  projects: Project[];
  activeProjectId: string | null;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onAssign: (id: string | null) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Button variant="secondary" className="w-full justify-start" onClick={onCreate}>
        <Plus className="size-4" /> New project
      </Button>

      {activeProjectId && (
        <button
          onClick={() => onAssign(null)}
          className="w-full rounded-lg border border-dashed border-border px-3 py-2 text-left text-xs text-muted-foreground hover:border-border-strong"
        >
          This chat is in a project — remove it from the project
        </button>
      )}

      <div className="max-h-[45vh] space-y-1.5 overflow-y-auto">
        {projects.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No projects yet.
          </p>
        ) : (
          projects.map((p) => (
            <div
              key={p.id}
              className={cn(
                "group flex items-center gap-2 rounded-lg border px-3 py-2",
                activeProjectId === p.id
                  ? "border-cyan/50 bg-cyan/5"
                  : "border-border bg-surface-2/40",
              )}
            >
              <button onClick={() => onOpen(p.id)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  {p.name}
                  {activeProjectId === p.id && <Check className="size-3.5 text-cyan" />}
                </div>
                <div className="text-2xs text-muted-foreground">
                  {p.files.length} file{p.files.length === 1 ? "" : "s"}
                  {p.instructions ? " · has instructions" : ""}
                </div>
              </button>
              {activeProjectId !== p.id && (
                <button
                  onClick={() => onAssign(p.id)}
                  className="rounded-md border border-border px-2 py-1 text-2xs hover:border-cyan/40"
                >
                  Use here
                </button>
              )}
              <button onClick={() => onDelete(p.id)} title="Delete project">
                <Trash2 className="size-3.5 text-muted-foreground hover:text-danger" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ProjectEditor({ project }: { project: Project }) {
  const { update, addFile, removeFile } = useProjectsStore();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  async function onFiles(list: FileList | null) {
    if (!list) return;
    setBusy(true);
    for (const f of Array.from(list)) {
      const att = await parseAttachment(f);
      const text = att.text ?? "";
      if (text) addFile(project.id, att.name, text);
    }
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Project name</label>
        <input
          value={project.name}
          onChange={(e) => update(project.id, { name: e.target.value })}
          className="h-9 w-full rounded-lg border border-border bg-surface-2/50 px-3 text-sm outline-none focus:border-cyan/40"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Instructions</label>
        <textarea
          value={project.instructions}
          onChange={(e) => update(project.id, { instructions: e.target.value })}
          rows={4}
          placeholder="Shared context for every chat in this project…"
          className="w-full resize-none rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-sm outline-none focus:border-cyan/40"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">
            Knowledge files
          </label>
          <button
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1 text-2xs text-cyan hover:underline"
          >
            <Upload className="size-3" /> {busy ? "Parsing…" : "Add files"}
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              onFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        {project.files.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-2xs text-muted-foreground">
            Add PDFs, docs, code, or text as shared context.
          </p>
        ) : (
          <div className="space-y-1">
            {project.files.map((f) => (
              <div
                key={f.id}
                className="group flex items-center gap-2 rounded-lg border border-border bg-surface-2/40 px-3 py-1.5 text-sm"
              >
                <FileText className="size-3.5 shrink-0 text-cyan" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-2xs text-muted-foreground">
                  {(f.text.length / 1000).toFixed(1)}k chars
                </span>
                <button onClick={() => removeFile(project.id, f.id)} title="Remove">
                  <Trash2 className="size-3.5 text-muted-foreground hover:text-danger" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
