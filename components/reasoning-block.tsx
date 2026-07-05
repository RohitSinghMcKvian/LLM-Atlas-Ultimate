"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Brain, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Collapsible reasoning/thinking stream for models that emit it (§3.2).
 * Collapsed by default with a token + elapsed summary; expandable to read the
 * full trace. While streaming it shows a live "thinking" pulse.
 */
export function ReasoningBlock({
  text,
  streaming = false,
  defaultOpen = false,
  elapsedMs,
}: {
  text: string;
  streaming?: boolean;
  defaultOpen?: boolean;
  elapsedMs?: number;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  if (!text && !streaming) return null;

  const tokens = Math.max(1, Math.ceil(text.length / 4));
  const summary = streaming
    ? "Thinking…"
    : `Thought for ${tokens.toLocaleString()} tokens${
        elapsedMs ? ` · ${(elapsedMs / 1000).toFixed(1)}s` : ""
      }`;

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-violet/20 bg-violet/5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground/80 hover:bg-violet/10"
      >
        <Brain className={cn("size-3.5 text-violet", streaming && "animate-pulse")} />
        <span className="font-medium">{summary}</span>
        {streaming && (
          <span className="inline-flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-1 animate-pulse-dot rounded-full bg-violet/70"
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
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap border-t border-violet/15 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-muted-foreground">
              {text}
              {streaming && (
                <span className="ml-0.5 inline-block h-3 w-1 animate-caret-blink bg-violet align-text-bottom" />
              )}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
