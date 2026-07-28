"use client";

import * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TOPIC_MAP } from "@/lib/news/topics";
import type { NewsTopic } from "@/lib/news/types";
import { cn } from "@/lib/utils";

/**
 * One topic chip, with a live count.
 *
 * The count is computed with the topic filter *ignored*, so it reads as "how
 * many stories you would see if you ticked this" rather than "how many you see
 * now" — which would be zero for every unticked chip and tell the reader nothing.
 */
export function NewsTopicChip({
  topic,
  count,
  active,
  shortcut,
  onToggle,
}: {
  topic: NewsTopic;
  count: number;
  active: boolean;
  /** The number key that toggles this chip, shown in the tooltip. */
  shortcut?: number;
  onToggle: (topic: NewsTopic) => void;
}) {
  const def = TOPIC_MAP.get(topic);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onToggle(topic)}
          aria-pressed={active}
          disabled={count === 0 && !active}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
            active
              ? "border-transparent bg-gradient-primary text-primary-foreground shadow-[0_4px_16px_-6px_rgb(var(--cyan)/0.7)]"
              : "border-border bg-surface-2 text-muted-foreground hover:border-border-strong hover:text-foreground",
            count === 0 && !active && "cursor-not-allowed opacity-40",
          )}
        >
          {def?.label ?? topic}
          <span className={cn("tnum text-2xs", active ? "opacity-80" : "text-muted-foreground/70")}>
            {count}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{def?.blurb ?? def?.label ?? topic}</p>
        {shortcut !== undefined && shortcut <= 9 && (
          <p className="mt-1 text-2xs text-muted-foreground">
            Press <kbd className="rounded bg-surface-3 px-1">{shortcut}</kbd> to toggle
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
