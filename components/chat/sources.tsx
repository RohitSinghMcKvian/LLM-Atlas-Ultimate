"use client";

import * as React from "react";
import { Globe, ExternalLink } from "lucide-react";
import type { WebSource } from "@/lib/chat/types";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A compact, numbered citation strip rendered under a searched turn. */
export function Sources({ sources }: { sources: WebSource[] }) {
  const [open, setOpen] = React.useState(false);
  if (!sources.length) return null;
  return (
    <div className="mb-1.5 rounded-xl border border-border bg-surface-2/40 px-3 py-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-2xs font-medium text-muted-foreground hover:text-foreground"
      >
        <Globe className="size-3.5 text-cyan" />
        {sources.length} web source{sources.length === 1 ? "" : "s"}
        <span className="ml-auto">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <ol className="mt-2 space-y-1.5">
          {sources.map((s, i) => (
            <li key={i} className="flex gap-2 text-xs">
              <span className="grid size-4 shrink-0 place-items-center rounded bg-cyan/15 text-2xs font-medium text-cyan">
                {i + 1}
              </span>
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="group min-w-0 flex-1"
              >
                <span className="flex items-center gap-1 font-medium text-foreground group-hover:text-cyan">
                  <span className="truncate">{s.title}</span>
                  <ExternalLink className="size-3 shrink-0 opacity-0 group-hover:opacity-100" />
                </span>
                <span className="block truncate text-2xs text-muted-foreground">
                  {hostOf(s.url)}
                  {s.snippet ? ` — ${s.snippet}` : ""}
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
