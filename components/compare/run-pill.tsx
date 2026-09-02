"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GitCompareArrows } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  getCompareProgress,
  getCompareProgressServer,
  subscribeCompareProgress,
} from "@/lib/compare/live-pill";

/**
 * A live comparison, visible from anywhere in the workspace.
 *
 * Runs no longer stop when you leave `/compare` — which is only useful if you
 * can tell that one is still going. This is the smallest honest indicator: how
 * many lanes have answered, and a way back. It renders nothing at all when there
 * is no live run, and nothing on the Compare page itself, where the spine
 * already says everything this would.
 *
 * ### Why it does not read the runtime
 *
 * This is mounted in the Topbar, so it renders on all sixteen workspace modules.
 * Subscribing to `compareRuntime` directly — which is what it did — imported the
 * lane planner, the session store and `@/lib/catalog`, putting the whole model
 * catalog and the compare engine into the shell chunk that `/docs` parses before
 * its own page code. It reads `lib/compare/live-pill.ts` instead, a module with
 * no imports at all that the runtime pushes two integers into. Same pill, and
 * the compare engine is now fetched only by Compare.
 */
export function CompareRunPill({ className }: { className?: string }) {
  const pathname = usePathname();
  const progress = React.useSyncExternalStore(
    subscribeCompareProgress,
    getCompareProgress,
    getCompareProgressServer,
  );

  if (!progress || pathname?.startsWith("/compare")) return null;

  const { done, total } = progress;

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
