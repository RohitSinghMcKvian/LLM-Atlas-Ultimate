"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, Coins, Crown } from "lucide-react";
import { BAND_RGB } from "@/lib/compare/bands";
import { runActuals } from "@/lib/compare/cost";
import { getModelById } from "@/lib/catalog";
import type { CompareRun } from "@/lib/compare/types";
import { cn, formatUSD } from "@/lib/utils";

/**
 * Earlier turns of a session, above the one in flight.
 *
 * Collapsed to a single row each, because the value of an old turn on screen is
 * remembering what was asked and who won — not re-reading three answers. Each row
 * keeps its lane swatches in band colour, so scrolling the thread shows at a
 * glance whether one model kept winning or the lead kept changing.
 */

export interface TurnThreadProps {
  /** Earlier turns, oldest first. The current turn is rendered by the caller. */
  turns: CompareRun[];
  onOpen?: (runId: string) => void;
  onFork?: (turnIndex: number) => void;
}

export function TurnThread({ turns, onOpen, onFork }: TurnThreadProps) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  if (turns.length === 0) return null;

  return (
    <ol className="space-y-1.5" aria-label="Earlier turns">
      {turns.map((run, i) => (
        <TurnRow
          key={run.id}
          run={run}
          index={i}
          expanded={openId === run.id}
          onToggle={() => setOpenId((cur) => (cur === run.id ? null : run.id))}
          onOpen={onOpen}
          onFork={onFork}
        />
      ))}
    </ol>
  );
}

function TurnRow({
  run,
  index,
  expanded,
  onToggle,
  onOpen,
  onFork,
}: {
  run: CompareRun;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onOpen?: (runId: string) => void;
  onFork?: (turnIndex: number) => void;
}) {
  const question = run.brief?.task ?? run.config.question;
  const answered = run.lanes.filter((l) => l.text.trim().length > 0);
  const cost = runActuals(run).total;
  const keptLane = run.kept ? run.lanes.find((l) => l.id === run.kept) : undefined;
  const keptName = keptLane ? (getModelById(keptLane.modelId)?.name ?? keptLane.id) : null;

  return (
    <li className="rounded-xl border border-border bg-surface/40">
      <div className="flex items-center gap-2 px-2.5 py-2">
        <button
          onClick={onToggle}
          aria-expanded={expanded}
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          <span className="sr-only">{expanded ? "Collapse" : "Expand"} turn {index + 1}</span>
        </button>

        <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground/70">
          {index + 1}
        </span>

        <button onClick={onToggle} className="min-w-0 flex-1 truncate text-left text-sm">
          {question}
        </button>

        <span className="flex shrink-0 items-center gap-1" aria-hidden>
          {answered.map((lane) => (
            <span
              key={lane.id}
              className="size-2 rounded-[3px]"
              style={{ backgroundColor: BAND_RGB[lane.band] }}
            />
          ))}
        </span>

        {keptName && (
          <span
            className="hidden shrink-0 items-center gap-1 text-2xs text-amber sm:inline-flex"
            title={`You kept ${keptName}`}
          >
            <Crown className="size-3" />
            <span className="max-w-24 truncate">{keptName}</span>
          </span>
        )}

        {cost > 0 && (
          <span className="hidden shrink-0 items-center gap-1 font-mono text-2xs tabular-nums text-muted-foreground sm:inline-flex">
            <Coins className="size-3" />
            {formatUSD(cost, { precise: true })}
          </span>
        )}
      </div>

      {expanded && (
        <div className="space-y-2 border-t border-border px-3 py-2.5">
          {answered.length === 0 ? (
            <p className="text-2xs text-muted-foreground">No model answered this turn.</p>
          ) : (
            answered.map((lane) => (
              <div key={lane.id} className="flex gap-2">
                <span
                  aria-hidden
                  className="mt-1 h-full w-0.5 shrink-0 rounded-full"
                  style={{ backgroundColor: BAND_RGB[lane.band] }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-2xs font-medium">
                    {getModelById(lane.modelId)?.name ?? lane.id}
                  </p>
                  {/* Three lines, not the whole answer: this is a reminder of
                      what was said, and the full turn is one click away. */}
                  <p className="line-clamp-3 text-2xs text-muted-foreground">{lane.text}</p>
                </div>
              </div>
            ))
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {onOpen && (
              <RowAction onClick={() => onOpen(run.id)}>Open this turn</RowAction>
            )}
            {onFork && (
              <RowAction onClick={() => onFork(index)}>Fork from here</RowAction>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function RowAction({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-lg border border-border px-2 py-1 text-2xs text-muted-foreground",
        "transition-colors hover:border-action/40 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
