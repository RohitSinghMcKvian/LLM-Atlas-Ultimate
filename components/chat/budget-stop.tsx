"use client";

import * as React from "react";
import { CircleSlash, Clock, PlayCircle, Repeat, Settings2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * What a build says when it stops short.
 *
 * This used to be one line of italic prose appended to the answer — "Ask again
 * to continue" — which is a dead end dressed as an instruction. The user had to
 * work out what to type, and whatever they typed restated a goal the workspace
 * already knew, so the model regularly redid finished work.
 *
 * The reason decides the control, because the reasons are not interchangeable:
 *
 *  - **rounds** — nothing is wrong, the work is mid-flight. Continue.
 *  - **cost** / **time** — the user's own ceiling was reached. Continuing is
 *    still offered, because it is their money and their choice, but the ceiling
 *    is named and the way to raise it is one click away.
 *  - **looping** / **no-progress** / **stalled** — the model was not getting
 *    anywhere. No Continue button: another identical round is the definition of
 *    not helping, and the honest ask is for a more specific instruction.
 */
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  rounds: PlayCircle,
  time: Clock,
  cost: Wallet,
  looping: Repeat,
  "no-progress": CircleSlash,
  stalled: CircleSlash,
};

/** Stops where handing the model another identical turn would not help. */
const UNRESUMABLE = new Set(["looping", "no-progress", "stalled"]);

export function BudgetStop({
  reason,
  message,
  rounds,
  maxRounds,
  spentUsd,
  maxUsd,
  busy,
  onContinue,
  onOpenSettings,
}: {
  reason: string;
  message: string;
  rounds?: number;
  maxRounds?: number;
  spentUsd?: number;
  maxUsd?: number;
  busy?: boolean;
  onContinue?: () => void;
  onOpenSettings?: () => void;
}) {
  const Icon = ICONS[reason] ?? CircleSlash;
  const resumable = !UNRESUMABLE.has(reason);
  const budgetary = reason === "cost" || reason === "time";

  return (
    <div
      className={cn(
        "my-2 rounded-xl border px-3 py-2.5",
        budgetary ? "border-amber/30 bg-amber/[0.06]" : "border-border bg-surface-2/40",
      )}
    >
      <div className="flex items-start gap-2.5">
        <Icon className={cn("mt-0.5 size-4 shrink-0", budgetary ? "text-amber" : "text-muted-foreground")} />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm text-foreground/90">{message}</p>

          {/* The numbers, in the same row as the action. A stop the user cannot
              audit is a stop they have to take on trust, and the two facts they
              actually want are how far it got and what it cost. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {rounds != null && maxRounds != null && (
              <span className="tnum text-2xs text-muted-foreground">
                {rounds}/{maxRounds} rounds
              </span>
            )}
            {spentUsd != null && (
              <span className="tnum text-2xs text-muted-foreground">
                ${spentUsd.toFixed(2)}
                {maxUsd != null && ` / $${maxUsd.toFixed(2)}`}
              </span>
            )}

            <div className="ml-auto flex items-center gap-1.5">
              {budgetary && onOpenSettings && (
                <Button variant="ghost" size="sm" onClick={onOpenSettings}>
                  <Settings2 className="size-3.5" />
                  Raise the limit
                </Button>
              )}
              {resumable && onContinue && (
                <Button variant="primary" size="sm" onClick={onContinue} disabled={busy}>
                  <PlayCircle className="size-3.5" />
                  Continue
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
