"use client";

import * as React from "react";
import Link from "next/link";
import { Gauge } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { bindingWindow, useQuota, type QuotaLane, type QuotaWindow } from "@/lib/hooks/use-quota";
import { cn } from "@/lib/utils";

// The free-tier readout: how much of the shared allowance is left, right now.
//
// Reports OPERATOR lanes only. A lane running on the user's own key is counted
// in their browser and is theirs to spend, so a server-side number for it would
// be a guess — see `app/api/v1/quota/route.ts`.
//
// Renders NOTHING when there is nothing true to say: no operator lane
// configured, or none with a countable allowance. A meter that always shows,
// even at "—", trains people to ignore it.

/** The lane closest to running out — the one worth putting in the topbar. */
function tightest(lanes: QuotaLane[]): { lane: QuotaLane; window: QuotaWindow } | null {
  let best: { lane: QuotaLane; window: QuotaWindow; frac: number } | null = null;
  for (const lane of lanes) {
    const window = bindingWindow(lane);
    if (!window || window.limit <= 0) continue;
    const frac = window.remaining / window.limit;
    if (!best || frac < best.frac) best = { lane, window, frac };
  }
  return best ? { lane: best.lane, window: best.window } : null;
}

function pct(w: QuotaWindow): number {
  return w.limit > 0 ? Math.min(100, Math.round((w.used / w.limit) * 100)) : 0;
}

export function QuotaMeter({ className }: { className?: string }) {
  const { lanes, durable, loading } = useQuota();

  const withQuota = React.useMemo(() => lanes.filter((l) => l.windows.length > 0), [lanes]);
  const top = React.useMemo(() => tightest(withQuota), [withQuota]);

  if (loading || !top) return null;

  const spent = top.window.remaining === 0;
  const low = !spent && top.window.remaining / top.window.limit < 0.2;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs",
          "text-muted-foreground transition-colors hover:text-foreground",
          className,
        )}
        aria-label="Free tier remaining"
      >
        <Gauge className={cn("size-3.5", spent ? "text-danger" : low ? "text-amber" : "text-accent")} />
        <span className="tabular-nums">
          {top.window.remaining.toLocaleString("en-US")} left
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span>Free tier remaining</span>
          <Link href="/vault" className="text-2xs font-normal text-action hover:underline">
            Manage keys
          </Link>
        </DropdownMenuLabel>

        <div className="space-y-2.5 px-2 pb-2">
          {withQuota.map((lane) => {
            const w = bindingWindow(lane);
            if (!w) return null;
            const out = w.remaining === 0;
            return (
              <div key={lane.id}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate font-medium">{lane.name}</span>
                  <span
                    className={cn(
                      "shrink-0 tabular-nums text-2xs",
                      out ? "text-danger" : "text-muted-foreground",
                    )}
                  >
                    {w.remaining.toLocaleString("en-US")}/{w.limit.toLocaleString("en-US")} per{" "}
                    {w.window}
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className={cn("h-full rounded-full", out ? "bg-danger" : "bg-accent")}
                    style={{ width: `${pct(w)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <p className="border-t border-border px-2 pt-2 text-2xs text-muted-foreground">
          {durable
            ? "Shared across everyone using the operator's key."
            : // Said plainly rather than hidden: without a database each server
              // instance counts alone, so the real total is at least this.
              "Counted per server instance — the real total may be higher."}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
