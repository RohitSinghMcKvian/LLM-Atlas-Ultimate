"use client";

import * as React from "react";
import { Brain, ChevronRight } from "lucide-react";
import { Collapsible } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * Collapsible reasoning/thinking stream for models that emit it (§3.2).
 * Collapsed by default with a token + elapsed summary; expandable to read the
 * full trace. While streaming it shows a live "thinking" pulse.
 *
 * `card` is the standalone frame the playground and the code agent panel use.
 * `row` drops the frame for a list that already has one — see `ToolCall` for why
 * a tinted card nested inside `ActivityTimeline` defeated the point of it.
 */
export function ReasoningBlock({
  text,
  streaming = false,
  defaultOpen = false,
  elapsedMs,
  variant = "card",
}: {
  text: string;
  streaming?: boolean;
  defaultOpen?: boolean;
  elapsedMs?: number;
  variant?: "card" | "row";
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  if (!text && !streaming) return null;

  const row = variant === "row";
  const tokens = Math.max(1, Math.ceil(text.length / 4));
  const summary = streaming
    ? "Thinking…"
    : `Thought for ${tokens.toLocaleString()} tokens${
        elapsedMs ? ` · ${(elapsedMs / 1000).toFixed(1)}s` : ""
      }`;

  return (
    <div
      className={cn(
        "overflow-hidden",
        row ? "rounded-lg" : "my-2 rounded-xl border border-accent/20 bg-accent/5",
      )}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-2 text-left text-xs text-foreground/80",
          row
            ? "min-h-11 rounded-lg px-2 py-1.5 hover:bg-surface-2/70 sm:min-h-0"
            : "min-h-11 px-3 py-2 hover:bg-accent/10 sm:min-h-0",
        )}
      >
        <Brain
          className={cn(
            "size-3.5 shrink-0",
            row ? "text-muted-foreground" : "text-accent",
            streaming && "animate-pulse",
          )}
        />
        <span className="min-w-0 truncate font-medium">{summary}</span>
        {streaming && (
          <span className="inline-flex shrink-0 gap-0.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={cn(
                  "size-1 animate-pulse-dot rounded-full",
                  row ? "bg-muted-foreground/60" : "bg-accent/70",
                )}
                style={{ animationDelay: `${i * 0.18}s` }}
              />
            ))}
          </span>
        )}
        <ChevronRight
          className={cn(
            "ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      <Collapsible open={open}>
        <pre
          className={cn(
            "max-h-72 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground",
            row ? "px-2 pb-2 pt-1" : "border-t border-accent/15 px-3 py-2.5",
          )}
        >
          {text}
          {streaming && (
            <span
              className={cn(
                "ml-0.5 inline-block h-3 w-1 animate-caret-blink align-text-bottom",
                row ? "bg-muted-foreground" : "bg-accent",
              )}
            />
          )}
        </pre>
      </Collapsible>
    </div>
  );
}
