"use client";

import * as React from "react";
import { ExternalLink, FileText, Globe, Search } from "lucide-react";
import { scanMarkers } from "@/lib/compare/analysis/markers";
import { BAND_RGB } from "@/lib/compare/bands";
import type { CompareRun } from "@/lib/compare/types";
import { getModelById } from "@/lib/catalog";
import { cn } from "@/lib/utils";

/**
 * The shared evidence, and who actually used it.
 *
 * Two things worth seeing here that no per-lane view can show:
 *
 *   * **One list.** Every lane answered from these exact sources in this exact
 *     order. That is what makes the comparison fair, and showing it is how the
 *     user can believe it rather than take it on trust.
 *   * **Which lanes cited which.** A source nobody used, or a lane that cited
 *     nothing at all, is a real signal — and it is free, because
 *     `citedNumbers()` already parses the markers `formatResearchContext`
 *     numbered.
 */

export function EvidencePanel({ run }: { run: CompareRun }) {
  const pack = run.evidence;

  // Which lanes cited each source number. Recomputed from the answers rather
  // than tracked during streaming: the answer text is the only authority on
  // what a model actually cited.
  const citations = React.useMemo(() => {
    const map = new Map<number, string[]>();
    for (const lane of run.lanes) {
      if (!lane.text) continue;
      for (const n of scanMarkers(lane.text).distinct) {
        const list = map.get(n) ?? [];
        if (!list.includes(lane.id)) list.push(lane.id);
        map.set(n, list);
      }
    }
    return map;
  }, [run.lanes]);

  if (!pack || (pack.sources.length === 0 && pack.documents.length === 0)) {
    return (
      <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        {run.stages.evidence.status === "skipped"
          ? "This question needed no sources, so every model answered from what it already knows."
          : "No sources were gathered for this run."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
        <span className="uppercase tracking-legend text-muted-foreground/70">Shared evidence</span>
        <span>Every lane answered from this list, in this order.</span>
      </header>

      {pack.queriesRun.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          {pack.queriesRun.map((q) => (
            <span
              key={q}
              className="rounded-full border border-border bg-surface-2/60 px-2 py-0.5 text-2xs text-muted-foreground"
            >
              {q}
            </span>
          ))}
        </div>
      )}

      <ol className="space-y-2">
        {pack.sources.map((source, i) => {
          const n = i + 1;
          const users = citations.get(n) ?? [];
          return (
            <li
              key={source.url}
              className={cn(
                "flex gap-3 rounded-xl border border-border bg-surface/50 p-3",
                users.length === 0 && "opacity-60",
              )}
            >
              <span className="mt-0.5 shrink-0 font-mono text-2xs tabular-nums text-muted-foreground">
                [{n}]
              </span>
              <div className="min-w-0 flex-1">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium hover:text-action hover:underline"
                >
                  <span className="truncate">{source.title}</span>
                  <ExternalLink className="size-3 shrink-0 opacity-60" />
                </a>
                <p className="mt-0.5 line-clamp-2 text-2xs text-muted-foreground">{source.snippet}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1" title={citedBy(users, run)}>
                {users.length === 0 ? (
                  <span className="text-2xs text-muted-foreground/60">unused</span>
                ) : (
                  users.map((laneId) => {
                    const lane = run.lanes.find((l) => l.id === laneId);
                    if (!lane) return null;
                    return (
                      <span
                        key={laneId}
                        aria-hidden
                        className="size-2 rounded-[3px]"
                        style={{ backgroundColor: BAND_RGB[lane.band] }}
                      />
                    );
                  })
                )}
                <span className="sr-only">{citedBy(users, run)}</span>
              </div>
            </li>
          );
        })}
      </ol>

      {pack.documents.length > 0 && (
        <div className="space-y-2">
          <p className="text-2xs uppercase tracking-legend text-muted-foreground/70">Your files</p>
          {pack.documents.map((doc) => (
            <div
              key={doc.name}
              className="flex items-center gap-2 rounded-xl border border-border bg-surface/50 p-3 text-sm"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{doc.name}</span>
              <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                {doc.tokens.toLocaleString()} tokens
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
        <Globe className="size-3.5" />
        {pack.rounds} research round{pack.rounds === 1 ? "" : "s"} · {pack.queriesRun.length} searches
        {pack.stoppedBy && ` · stopped by ${pack.stoppedBy}`}
      </p>
    </div>
  );
}

function citedBy(laneIds: string[], run: CompareRun): string {
  if (laneIds.length === 0) return "No model cited this source.";
  const names = laneIds.map((id) => {
    const lane = run.lanes.find((l) => l.id === id);
    return getModelById(lane?.modelId ?? id)?.name ?? id;
  });
  return `Cited by ${names.join(", ")}.`;
}
