"use client";

import * as React from "react";
import {
  ArrowUpRight,
  BookOpen,
  FileText,
  Github,
  GraduationCap,
  Newspaper,
  PlayCircle,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import type { Reference, RefKind } from "@/lib/learn/types";
import { cn } from "@/lib/utils";

/**
 * Further reading.
 *
 * Every entry carries a one-line reason, and that is the whole design: a bare
 * list of paper titles asks the reader to gamble an evening on a guess. The
 * note is what turns a link into a recommendation.
 */

const KIND_META: Record<
  RefKind,
  { icon: LucideIcon; label: string; tint: string }
> = {
  paper: { icon: ScrollText, label: "Paper", tint: "text-violet" },
  docs: { icon: FileText, label: "Docs", tint: "text-cyan" },
  article: { icon: Newspaper, label: "Article", tint: "text-cyan" },
  video: { icon: PlayCircle, label: "Video", tint: "text-amber" },
  course: { icon: GraduationCap, label: "Course", tint: "text-amber" },
  repo: { icon: Github, label: "Code", tint: "text-muted-foreground" },
  spec: { icon: BookOpen, label: "Spec", tint: "text-violet" },
};

/** `https://arxiv.org/abs/1706.03762` → `arxiv.org`. Shown so the target is legible. */
function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function ReferenceList({
  references,
  className,
}: {
  references: Reference[];
  className?: string;
}) {
  if (references.length === 0) return null;

  return (
    <section
      aria-labelledby="further-reading"
      className={cn(
        "not-prose overflow-hidden rounded-2xl border border-border bg-surface/50",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-border bg-gradient-primary-soft px-4 py-3">
        <span className="grid size-6 place-items-center rounded-lg bg-gradient-primary text-primary-foreground">
          <BookOpen className="size-3.5" />
        </span>
        <h2
          id="further-reading"
          className="font-display text-sm font-semibold tracking-tight"
        >
          Further reading
        </h2>
        <span className="ml-auto font-mono text-2xs tnum text-muted-foreground">
          {references.length} source{references.length === 1 ? "" : "s"}
        </span>
      </div>

      <ul className="divide-y divide-border">
        {references.map((ref) => (
          <li key={ref.href}>
            <ReferenceRow reference={ref} />
          </li>
        ))}
      </ul>

      <p className="border-t border-border bg-surface-2/30 px-4 py-2 text-[10px] leading-relaxed text-muted-foreground">
        External sources, opened in a new tab. Atlas is not affiliated with any
        of these publishers.
      </p>
    </section>
  );
}

function ReferenceRow({ reference }: { reference: Reference }) {
  const meta = KIND_META[reference.kind];
  const Icon = meta.icon;
  const host = hostOf(reference.href);

  return (
    <a
      href={reference.href}
      target="_blank"
      rel="noreferrer noopener"
      className="group flex gap-3 px-4 py-3 transition-colors hover:bg-surface-2/50"
    >
      <span
        className={cn(
          "mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-surface-2/60 transition-colors group-hover:border-border-strong",
          meta.tint,
        )}
        aria-hidden
      >
        <Icon className="size-4" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium leading-snug text-foreground group-hover:text-cyan">
            {reference.title}
          </span>
          <ArrowUpRight className="size-3 shrink-0 -translate-x-0.5 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
        </span>

        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="rounded border border-border px-1 py-px font-medium uppercase tracking-wider">
            {meta.label}
          </span>
          <span className="font-medium text-foreground/70">
            {reference.source}
          </span>
          {reference.year && (
            <>
              <span aria-hidden>·</span>
              <span className="font-mono tnum">{reference.year}</span>
            </>
          )}
          {host && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate font-mono">{host}</span>
            </>
          )}
        </span>

        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
          {reference.note}
        </span>
      </span>
    </a>
  );
}
