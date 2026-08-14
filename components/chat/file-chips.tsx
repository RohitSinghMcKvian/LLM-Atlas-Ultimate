"use client";

import * as React from "react";
import { Download, FileSpreadsheet, FileText, FileType, Image as ImageIcon, Loader2, Package } from "lucide-react";
import { readBlob } from "@/lib/chat/files/blob-repo";
import { cn } from "@/lib/utils";

/**
 * The files a turn produced, offered where the user is looking.
 *
 * `run_python` writes a real `.xlsx` or `.pdf` straight to IndexedDB, which is
 * what makes code execution worth having — and also what makes it invisible
 * unless something surfaces it. A spreadsheet that exists and cannot be reached
 * is the same outcome as not generating one.
 *
 * Bytes are read on click rather than held in state: a conversation may hold
 * sixteen megabytes of deliverables, and keeping those decoded in a React tree
 * to render a row of filenames would be a straightforward way to make scrolling
 * stutter.
 */
export interface ProducedFile {
  path: string;
  size: number;
  mime: string;
}

function iconFor(path: string) {
  if (/\.(xlsx?|csv|parquet)$/i.test(path)) return FileSpreadsheet;
  if (/\.(docx?|pdf|txt|md)$/i.test(path)) return FileText;
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(path)) return ImageIcon;
  if (/\.(zip|tar|gz)$/i.test(path)) return Package;
  return FileType;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FileChip({
  conversationId,
  file,
}: {
  conversationId: string;
  file: ProducedFile;
}) {
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const Icon = iconFor(file.path);

  async function download() {
    setBusy(true);
    setFailed(false);
    try {
      const row = await readBlob(conversationId, file.path);
      if (!row) {
        setFailed(true);
        return;
      }
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(row.bytes) as unknown as BlobPart], { type: row.mime }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = file.path.split("/").pop() ?? file.path;
      a.click();
      // Revoked on the next frame rather than immediately: revoking before the
      // navigation the click starts has actually landed cancels the download in
      // some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={download}
      disabled={busy}
      title={failed ? "That file is no longer stored" : `Download ${file.path}`}
      className={cn(
        "group/file inline-flex max-w-full items-center gap-2 rounded-xl border px-2.5 py-1.5 text-2xs transition-colors",
        failed
          ? "border-danger/40 text-danger"
          : "border-border bg-surface-2/60 hover:border-action/40 hover:bg-surface-2",
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", failed ? "text-danger" : "text-action")} />
      <span className="min-w-0 truncate font-medium">{file.path}</span>
      <span className="tnum shrink-0 text-muted-foreground">{formatSize(file.size)}</span>
      {busy ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
      ) : (
        <Download className="size-3.5 shrink-0 text-muted-foreground group-hover/file:text-foreground" />
      )}
    </button>
  );
}

export function FileChips({
  conversationId,
  files,
  className,
}: {
  conversationId: string;
  files: ProducedFile[];
  className?: string;
}) {
  if (!files.length) return null;
  return (
    <div className={cn("mt-2 flex flex-wrap gap-1.5", className)}>
      {files.map((f) => (
        <FileChip key={f.path} conversationId={conversationId} file={f} />
      ))}
    </div>
  );
}
