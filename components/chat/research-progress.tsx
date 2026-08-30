"use client";

import * as React from "react";
import { AlertTriangle, Check, ChevronRight, Loader2, Search, X } from "lucide-react";
import { Collapsible } from "@/components/ui/collapsible";
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
  // Folds once the run is over, for the same reason the plan panel does: this
  // sits directly above the composer, and a finished list of queries is a record
  // rather than something to watch. A warning keeps it open — it is the one thing
  // here the reader is meant to act on.
  const [open, setOpen] = React.useState(true);
  const wasDone = React.useRef(done);
  React.useEffect(() => {
    if (done && !wasDone.current) setOpen(false);
    wasDone.current = done;
  }, [done]);
  React.useEffect(() => {
    if (warning) setOpen(true);
  }, [warning]);
  const foldable = done;
  const shown = !foldable || open;

  if (rounds.length === 0 && done) return null;

  return (
    <div className="mx-auto mb-3 max-w-3xl rounded-xl border border-border bg-surface-2/40 px-3 py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => foldable && setOpen((v) => !v)}
          aria-expanded={foldable ? shown : undefined}
          disabled={!foldable}
          className={cn(
            "flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg text-left sm:min-h-0",
            foldable && "-mx-1 px-1 hover:bg-surface-2/60",
          )}
        >
          {done ? (
            <Check className="size-3.5 shrink-0 text-action" />
          ) : (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-action" />
          )}
          <span className="shrink-0 text-2xs font-medium">
            {done ? "Research complete" : "Researching…"}
          </span>
          {summary && (
            <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">{summary}</span>
          )}
          {foldable && (
            <ChevronRight
              className={cn(
                "ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform",
                shown && "rotate-90",
              )}
            />
          )}
        </button>
        <button
          onClick={onDismiss}
          aria-label="Dismiss research progress"
          className="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2/60 hover:text-foreground sm:size-6"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <Collapsible open={shown}>
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
          <span className="min-w-0 break-words">{warning}</span>
        </p>
      )}
      </Collapsible>
    </div>
  );
}
