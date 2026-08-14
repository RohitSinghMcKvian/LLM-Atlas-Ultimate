"use client";

import * as React from "react";
import { Download, FileCode2, FileSpreadsheet, FileText, Loader2, Sheet } from "lucide-react";
import { readBlob } from "@/lib/chat/files/blob-repo";
import { csvToXlsx } from "@/lib/chat/files/xlsx";
import { toRelativePath } from "@/lib/chat/workspace/fs";
import type { WorkspaceSnapshot } from "@/lib/chat/workspace/types";
import type { ProducedFile } from "@/components/chat/file-chips";
import { cn } from "@/lib/utils";

/**
 * Everything the build has made, in one list.
 *
 * The workspace strip above the composer showed text files; generated binaries
 * were reachable only from the message that produced them; and artifacts lived
 * in a third place. Three lists for one question — "what have we got?" — and
 * none of them complete.
 *
 * Text files that also exist as artifacts open in Preview. A `.csv` gets a
 * one-click `.xlsx`, because a table someone can open in Excel is usually the
 * thing they actually wanted and asking the model to regenerate it in another
 * format is a whole round trip for a format conversion.
 */
export function FilesTab({
  conversationId,
  workspace,
  produced,
  artifactPaths,
  selectedPath,
  onOpenFile,
}: {
  conversationId: string | null;
  workspace: WorkspaceSnapshot;
  produced: ProducedFile[];
  /** Relative paths that have a preview. Everything else is read-only here. */
  artifactPaths: string[];
  selectedPath: string | null;
  onOpenFile: (path: string) => void;
}) {
  const files = React.useMemo(
    () =>
      workspace.files
        .map((f) => ({
          abs: f.path,
          rel: toRelativePath(f.path) ?? f.path,
          size: f.content.length,
          text: f.content,
        }))
        .sort((a, b) => a.rel.localeCompare(b.rel)),
    [workspace.files],
  );

  if (!files.length && !produced.length) {
    return (
      <p className="px-4 py-8 text-center text-2xs text-muted-foreground/70">
        Files Atlas writes — pages, scripts, spreadsheets, documents — appear here.
      </p>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-2 py-2">
      {files.length > 0 && (
        <Section title="Workspace" count={files.length}>
          {files.map((f) => (
            <WorkspaceRow
              key={f.abs}
              rel={f.rel}
              size={f.size}
              text={f.text}
              previewable={artifactPaths.includes(f.rel)}
              selected={selectedPath === f.rel}
              onOpen={() => onOpenFile(f.abs)}
            />
          ))}
        </Section>
      )}

      {produced.length > 0 && conversationId && (
        <Section title="Generated" count={produced.length}>
          {produced.map((f) => (
            <ProducedRow key={f.path} conversationId={conversationId} file={f} />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-3">
      <h3 className="mb-1 flex items-center gap-1.5 px-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground/70">
        {title}
        <span className="tnum ml-auto normal-case tracking-normal">{count}</span>
      </h3>
      <ul className="space-y-0.5">{children}</ul>
    </section>
  );
}

function iconFor(path: string) {
  if (/\.(csv|tsv|xlsx?)$/i.test(path)) return FileSpreadsheet;
  if (/\.(md|txt|pdf|docx?)$/i.test(path)) return FileText;
  return FileCode2;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function download(bytes: BlobPart, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // Revoked on a delay: revoking before the click's navigation has landed
  // cancels the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function WorkspaceRow({
  rel,
  size,
  text,
  previewable,
  selected,
  onOpen,
}: {
  rel: string;
  size: number;
  text: string;
  previewable: boolean;
  selected: boolean;
  onOpen: () => void;
}) {
  const [converting, setConverting] = React.useState(false);
  const Icon = iconFor(rel);
  const tabular = /\.(csv|tsv)$/i.test(rel);
  const name = rel.split("/").pop() ?? rel;

  async function toXlsx() {
    setConverting(true);
    try {
      const bytes = await csvToXlsx(text, name.replace(/\.[^.]+$/, ""));
      download(
        bytes as unknown as BlobPart,
        name.replace(/\.[^.]+$/, ".xlsx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
    } finally {
      setConverting(false);
    }
  }

  return (
    <li
      className={cn(
        "group/row flex items-center gap-2 rounded-lg px-1.5 py-1 text-2xs transition-colors",
        selected ? "bg-action/10" : "hover:bg-surface-2/60",
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", selected ? "text-action" : "text-muted-foreground")} />
      <button
        onClick={previewable ? onOpen : undefined}
        disabled={!previewable}
        title={previewable ? `Preview ${rel}` : rel}
        className={cn(
          "min-w-0 flex-1 truncate text-left font-mono",
          previewable ? "hover:text-action" : "cursor-default text-foreground/80",
        )}
      >
        {rel}
      </button>
      <span className="tnum shrink-0 text-muted-foreground/60">{formatSize(size)}</span>
      {tabular && (
        <button
          onClick={toXlsx}
          disabled={converting}
          title="Download as .xlsx"
          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
        >
          {converting ? <Loader2 className="size-3 animate-spin" /> : <Sheet className="size-3" />}
        </button>
      )}
      <button
        onClick={() => download(text, name, "text/plain")}
        title={`Download ${name}`}
        className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
      >
        <Download className="size-3" />
      </button>
    </li>
  );
}

function ProducedRow({
  conversationId,
  file,
}: {
  conversationId: string;
  file: ProducedFile;
}) {
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const Icon = iconFor(file.path);

  async function save() {
    setBusy(true);
    setFailed(false);
    try {
      const row = await readBlob(conversationId, file.path);
      if (!row) {
        setFailed(true);
        return;
      }
      download(
        new Uint8Array(row.bytes) as unknown as BlobPart,
        file.path.split("/").pop() ?? file.path,
        row.mime,
      );
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      className={cn(
        "group/row flex items-center gap-2 rounded-lg px-1.5 py-1 text-2xs transition-colors hover:bg-surface-2/60",
        failed && "text-danger",
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", failed ? "text-danger" : "text-accent")} />
      <span className="min-w-0 flex-1 truncate font-mono text-foreground/80">{file.path}</span>
      <span className="tnum shrink-0 text-muted-foreground/60">{formatSize(file.size)}</span>
      <button
        onClick={save}
        disabled={busy}
        title={failed ? "That file is no longer stored" : `Download ${file.path}`}
        className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
      </button>
    </li>
  );
}
