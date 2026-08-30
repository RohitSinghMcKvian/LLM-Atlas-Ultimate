"use client";

import * as React from "react";
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronRight,
  Code2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Unplug,
  Wrench,
} from "lucide-react";
import { ReasoningBlock } from "@/components/reasoning-block";
import { ToolCall } from "@/components/tool-call";
import { Collapsible } from "@/components/ui/collapsible";
import { buildActivity, type ActivityEntry, type ActivityInput } from "@/lib/chat/activity";
import type { StoredToolCall } from "@/lib/chat/types";
import { cn } from "@/lib/utils";

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
 *
 * The expanded body is a flat list, and that is the second half of the same
 * idea. It used to render `ReasoningBlock` and `ToolCall` in their standalone
 * form, so a six-tool turn drew six bordered, tinted cards *inside* the one box
 * built to stop the stacking. Both now take `variant="row"` here and keep their
 * frames for the playground and the code panel, where they really do stand alone.
 */
export function ActivityTimeline({
  reasoning,
  toolCalls,
  continuations,
  recovered,
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
        recovered,
        truncated,
        artifactErrors,
        capabilityDowngrade,
        streaming,
      }),
    [
      reasoning,
      toolCalls,
      continuations,
      recovered,
      truncated,
      artifactErrors,
      capabilityDowngrade,
      streaming,
    ],
  );

  // A failure is never hidden behind a chevron.
  const [open, setOpen] = React.useState(defaultOpen || fold.hasError);
  const wasError = React.useRef(fold.hasError);
  React.useEffect(() => {
    if (fold.hasError && !wasError.current) setOpen(true);
    wasError.current = fold.hasError;
  }, [fold.hasError]);

  if (!fold.summary) return null;

  const notes = fold.entries.filter(
    (e) =>
      e.kind === "continuation" ||
      e.kind === "recovery" ||
      e.kind === "truncated" ||
      e.kind === "downgrade" ||
      e.kind === "artifact-error",
  );

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
        // 44px on touch, back to the compact row once there is a pointer.
        className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-surface-2/70 sm:min-h-0"
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

      <Collapsible open={open} className="border-t border-border/60">
        <div className="space-y-0.5 px-2 py-1.5">
          {/* The full trace and each tool's input/output keep their own
              components — they were already good; they were just never
              behind anything. */}
          {(reasoning || (streaming && !toolCalls?.length)) && (
            <ReasoningBlock
              text={reasoning ?? ""}
              streaming={!!streaming && !reasoning}
              variant="row"
            />
          )}
          {toolCalls?.map((t) => <ToolCall key={t.id} call={t} variant="row" />)}
          {notes.map((e) => (
            <NoteRow key={e.id} entry={e} />
          ))}
        </div>
      </Collapsible>
    </div>
  );
}

/** A step with no panel of its own — a resume, a retry, a cut-off answer, a runtime error. */
function NoteRow({ entry }: { entry: ActivityEntry }) {
  const Icon =
    entry.kind === "continuation"
      ? RefreshCw
      : entry.kind === "recovery"
        ? RotateCcw
        : entry.kind === "artifact-error"
          ? Code2
          : entry.kind === "downgrade"
            ? Unplug
            : AlertTriangle;
  return (
    <div
      className={cn(
        // `items-start` and the wrapping below because these labels are the one
        // place model-authored text lands in this row: an artifact's runtime
        // error is whatever the frame threw, and on one line it stretched the
        // whole card.
        "flex items-start gap-2 rounded-lg px-2 py-1.5 text-2xs",
        entry.status === "error" ? "bg-danger/10 text-danger" : "text-muted-foreground",
      )}
    >
      <Icon className="mt-0.5 size-3 shrink-0" />
      <span className="min-w-0 break-words">
        {entry.label}
        {/* No opacity step for the detail: muted-foreground already sits at 5.7:1
            and fading it to 70% drops it to 3.4:1. Weight carries the hierarchy. */}
        {entry.detail && <> · {entry.detail}</>}
      </span>
    </div>
  );
}

/** Exported for the icon map elsewhere; kept here so the vocabulary lives in one file. */
export const ACTIVITY_ICONS = { thinking: Brain, tool: Wrench, done: Check } as const;
