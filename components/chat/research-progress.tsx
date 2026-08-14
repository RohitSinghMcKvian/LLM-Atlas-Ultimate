"use client";

import * as React from "react";
import { AlertTriangle, Check, Loader2, Search, X } from "lucide-react";
import type { RoundReport } from "@/lib/research/run";
import { cn } from "@/lib/utils";

/**
 * What a research run is doing, while it does it.
 *
 * Research spends several outbound requests and takes tens of seconds, so the
 * alternative to showing this is a spinner that gives no reason to keep waiting.
 * Showing the actual queries also makes the run auditable: the user can see that
 * the counter-evidence angle was searched, and that a query failed rather than
 * quietly returning nothing.
 *
 * Purely informational — nothing here can affect the run, which is why it is safe
 * to render from state updated by a callback mid-flight.
 */
export function ResearchProgress({
  rounds,
  done,
  summary,
  warning,
  onDismiss,
}: {
  rounds: RoundReport[];
  done: boolean;
  summary?: string;
  warning?: string | null;
  onDismiss: () => void;
}) {
  if (rounds.length === 0 && done) return null;

  return (
    <div className="mx-auto mb-3 max-w-3xl rounded-xl border border-border bg-surface-2/40 px-3 py-2">
      <div className="flex items-center gap-2">
        {done ? (
          <Check className="size-3.5 shrink-0 text-action" />
        ) : (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-action" />
        )}
        <span className="text-2xs font-medium">
          {done ? "Research complete" : "Researching…"}
        </span>
        {summary && <span className="text-2xs text-muted-foreground">{summary}</span>}
        <button
          onClick={onDismiss}
          aria-label="Dismiss research progress"
          className="ml-auto text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="mt-1.5 space-y-1">
        {rounds.map((r) => (
          <div key={r.round} className="pl-5">
            {r.queries.map((q) => {
              const failed = r.failures.includes(q);
              return (
                <div key={q} className="flex items-center gap-1.5 text-2xs">
                  <Search
                    className={cn(
                      "size-3 shrink-0",
                      failed ? "text-danger" : "text-muted-foreground",
                    )}
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      failed ? "text-danger line-through" : "text-muted-foreground",
                    )}
                  >
                    {q}
                  </span>
                </div>
              );
            })}
            {/* Full-opacity muted, not `/50`: at 2xs the faded variant measures
                2.4:1 against this surface, well under the 4.5:1 minimum. */}
            <p className="pl-4.5 text-2xs text-muted-foreground">
              +{r.newSources} source{r.newSources === 1 ? "" : "s"}
            </p>
          </div>
        ))}
      </div>

      {/* Advisory only: it never suppresses or rewrites the answer. Whether thin
          grounding matters is the reader's call — they can see the question. */}
      {warning && (
        <p className="mt-1.5 flex items-start gap-1.5 pl-5 text-2xs text-amber">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          {warning}
        </p>
      )}
    </div>
  );
}
