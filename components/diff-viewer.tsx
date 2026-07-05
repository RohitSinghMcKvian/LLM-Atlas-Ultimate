"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { diffLines, diffStat, type DiffLine } from "@/lib/diff";

// Re-exported for existing importers (the pure logic now lives in lib/diff.ts).
export { diffLines, diffStat };
export type { DiffLine };

/**
 * Shared unified diff viewer (§7). Given two strings (or precomputed lines),
 * renders an add/del/context view with line-number gutters. Used by Chat
 * artifact versioning; consumed by Playground and Code in later phases.
 */
export function DiffViewer({
  oldText,
  newText,
  lines: providedLines,
  className,
}: {
  oldText?: string;
  newText?: string;
  lines?: DiffLine[];
  className?: string;
}) {
  const lines = React.useMemo(
    () => providedLines ?? diffLines(oldText ?? "", newText ?? ""),
    [providedLines, oldText, newText],
  );

  return (
    <div
      className={cn(
        "overflow-auto rounded-xl border border-border bg-[#0b0d14] font-mono text-[12.5px] leading-relaxed",
        className,
      )}
    >
      {lines.map((l, idx) => (
        <div
          key={idx}
          className={cn(
            "flex whitespace-pre",
            l.type === "add" && "bg-success/10",
            l.type === "del" && "bg-danger/10",
          )}
        >
          <span className="w-10 shrink-0 select-none border-r border-border/50 px-1.5 text-right text-muted-foreground/40">
            {l.oldNo ?? ""}
          </span>
          <span className="w-10 shrink-0 select-none border-r border-border/50 px-1.5 text-right text-muted-foreground/40">
            {l.newNo ?? ""}
          </span>
          <span
            className={cn(
              "w-5 shrink-0 select-none px-1 text-center",
              l.type === "add" && "text-success",
              l.type === "del" && "text-danger",
              l.type === "ctx" && "text-transparent",
            )}
          >
            {l.type === "add" ? "+" : l.type === "del" ? "-" : " "}
          </span>
          <span
            className={cn(
              "flex-1 px-2",
              l.type === "add" && "text-success",
              l.type === "del" && "text-danger",
              l.type === "ctx" && "text-foreground/80",
            )}
          >
            {l.text || " "}
          </span>
        </div>
      ))}
    </div>
  );
}
