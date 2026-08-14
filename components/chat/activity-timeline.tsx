"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronRight,
  Code2,
  Loader2,
  RefreshCw,
  Sparkles,
  Unplug,
  Wrench,
} from "lucide-react";
import { ReasoningBlock } from "@/components/reasoning-block";
import { ToolCall } from "@/components/tool-call";
import { buildActivity, type ActivityEntry, type ActivityInput } from "@/lib/chat/activity";
import type { StoredToolCall } from "@/lib/chat/types";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/lib/hooks/use-media-query";

/**
 * One row for everything the assistant did on a turn.
 *
 * Before this, a turn stacked a reasoning card plus one bordered card per tool
 * call plus a research panel plus a plan panel — each separately collapsible,
 * all of them open, all of them above the answer. Every individual box was
 * reasonable; together they buried the thing the user asked for.
 *
 * The rule here is that process is available, not imposed: collapsed to a single
 * summary line by default, expandable to the full detail, and *never* collapsed
 * over a failure — an errored step opens the row and says what broke.
 */
export function ActivityTimeline({
  reasoning,
  toolCalls,
  continuations,
  truncated,
  artifactErrors,
  capabilityDowngrade,
  streaming,
  defaultOpen = false,
}: ActivityInput & {
  toolCalls?: StoredToolCall[];
  /** The user's "show detailed activity" preference. */
  defaultOpen?: boolean;
}) {
  const fold = React.useMemo(
    () =>
      buildActivity({
        reasoning,
        toolCalls,
        continuations,
        truncated,
        artifactErrors,
        capabilityDowngrade,
        streaming,
      }),
    [reasoning, toolCalls, continuations, truncated, artifactErrors, capabilityDowngrade, streaming],
  );

  // A failure is never hidden behind a chevron.
  const [open, setOpen] = React.useState(defaultOpen || fold.hasError);
  const wasError = React.useRef(fold.hasError);
  React.useEffect(() => {
    if (fold.hasError && !wasError.current) setOpen(true);
    wasError.current = fold.hasError;
  }, [fold.hasError]);

  const reduced = usePrefersReducedMotion();

  if (!fold.summary) return null;

  return (
    <div
      className={cn(
        "my-2 overflow-hidden rounded-xl border bg-surface-2/40",
        fold.hasError ? "border-danger/25" : "border-border",
      )}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-surface-2/70"
      >
        {streaming ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-action" />
        ) : fold.hasError ? (
          <AlertTriangle className="size-3.5 shrink-0 text-danger" />
        ) : (
          <Sparkles className="size-3.5 shrink-0 text-action" />
        )}
        <span className={cn("min-w-0 flex-1 truncate", fold.hasError && "text-danger")}>
          {fold.summary}
        </span>
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={reduced ? { height: "auto", opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="border-t border-border/60"
          >
            <div className="space-y-1 px-3 py-2">
              {/* The full trace and each tool's input/output keep their own
                  components — they were already good; they were just never
                  behind anything. */}
              {(reasoning || (streaming && !toolCalls?.length)) && (
                <ReasoningBlock text={reasoning ?? ""} streaming={!!streaming && !reasoning} />
              )}
              {toolCalls?.map((t) => <ToolCall key={t.id} call={t} />)}
              {fold.entries
                .filter(
                  (e) =>
                    e.kind === "continuation" ||
                    e.kind === "truncated" ||
                    e.kind === "downgrade" ||
                    e.kind === "artifact-error",
                )
                .map((e) => (
                  <NoteRow key={e.id} entry={e} />
                ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A step with no panel of its own — a resume, a cut-off answer, a runtime error. */
function NoteRow({ entry }: { entry: ActivityEntry }) {
  const Icon =
    entry.kind === "continuation"
      ? RefreshCw
      : entry.kind === "artifact-error"
        ? Code2
        : entry.kind === "downgrade"
          ? Unplug
          : AlertTriangle;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg px-2 py-1.5 text-2xs",
        entry.status === "error" ? "bg-danger/10 text-danger" : "text-muted-foreground",
      )}
    >
      <Icon className="size-3 shrink-0" />
      <span>{entry.label}</span>
      {/* No opacity step for the detail: muted-foreground already sits at 5.7:1
          and fading it to 70% drops it to 3.4:1. Weight carries the hierarchy. */}
      {entry.detail && <span>· {entry.detail}</span>}
    </div>
  );
}

/** Exported for the icon map elsewhere; kept here so the vocabulary lives in one file. */
export const ACTIVITY_ICONS = { thinking: Brain, tool: Wrench, done: Check } as const;
