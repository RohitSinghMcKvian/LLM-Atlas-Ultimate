"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GitCompareArrows } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useCompareRun } from "./use-compare-run";

/**
 * A live comparison, visible from anywhere in the workspace.
 *
 * Runs no longer stop when you leave `/compare` — which is only useful if you
 * can tell that one is still going. This is the smallest honest indicator: how
 * many lanes have answered, and a way back. It renders nothing at all when there
 * is no live run, and nothing on the Compare page itself, where the spine
 * already says everything this would.
 */
export function CompareRunPill({ className }: { className?: string }) {
  const pathname = usePathname();
  const run = useCompareRun();

  const live = run?.lanes.some((l) => l.status === "streaming" || l.status === "queued") ?? false;
  if (!run || !live || pathname?.startsWith("/compare")) return null;

  const total = run.lanes.filter((l) => !l.blocked).length;
  const done = run.lanes.filter((l) => l.status === "done").length;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href="/compare"
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-lg border border-action/40 bg-action/10 px-2.5 text-2xs text-foreground transition-colors hover:border-action",
            className,
          )}
        >
          <span className="relative grid size-3.5 place-items-center">
            <GitCompareArrows className="size-3.5 text-action" />
          </span>
          <span className="font-mono tabular-nums">
            {done}/{total}
          </span>
          <span className="sr-only">
            A comparison is running: {done} of {total} models have answered. Open Compare.
          </span>
        </Link>
      </TooltipTrigger>
      <TooltipContent>
        Comparison running — {done} of {total} answered
      </TooltipContent>
    </Tooltip>
  );
}
