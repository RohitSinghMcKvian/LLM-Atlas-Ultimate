"use client";

import * as React from "react";
import { ChevronRight, Wrench, Check, Loader2, AlertTriangle } from "lucide-react";
import { Collapsible } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export type ToolStatus = "calling" | "running" | "done" | "error";

export interface ToolCallView {
  id: string;
  name: string;
  /** Raw JSON argument string. */
  arguments?: string;
  /** Result payload once the tool returns (string or JSON-serializable). */
  result?: string;
  status?: ToolStatus;
}

/**
 * `card` stands alone — the playground and the code agent panel show tool calls
 * with nothing around them, so they keep their own frame.
 *
 * `row` is for a list that already has one. Inside `ActivityTimeline` the card
 * was a bordered, `--action`-tinted box *inside* the bordered box built to stop
 * exactly that stacking, so a six-tool turn drew seven frames. It also spent the
 * one chrome hue on a passive log line: Terrain reserves `--action` for the
 * primary action and live state, and a finished tool call is neither.
 */
export type ToolCallVariant = "card" | "row";

function pretty(raw?: string): string {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/**
 * Inline, collapsible tool-call event (§3.2): name → input → result. Renders as
 * each call occurs and can be expanded to inspect arguments and output.
 */
export function ToolCall({
  call,
  defaultOpen = false,
  variant = "card",
}: {
  call: ToolCallView;
  defaultOpen?: boolean;
  variant?: ToolCallVariant;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const status = call.status ?? (call.result !== undefined ? "done" : "calling");
  const row = variant === "row";

  return (
    <div
      className={cn(
        "overflow-hidden",
        row ? "rounded-lg" : "my-2 rounded-xl border border-action/20 bg-action/5",
      )}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-2 text-left text-xs",
          // 44px on touch, tightened once a pointer is available — the same
          // split `artifact-panel.tsx` uses for its toolbar.
          row
            ? "min-h-11 rounded-lg px-2 py-1.5 hover:bg-surface-2/70 sm:min-h-0"
            : "min-h-11 px-3 py-2 hover:bg-action/10 sm:min-h-0",
        )}
      >
        <Wrench className={cn("size-3.5 shrink-0", row ? "text-muted-foreground" : "text-action")} />
        {/* `truncate` needs the `min-w-0`: without it a long
            `mcp__server__some_long_tool` pushed the status pill off the row. */}
        <span className="min-w-0 truncate font-medium text-foreground" title={call.name}>
          {call.name || "tool"}
        </span>
        <StatusPill status={status} />
        <ChevronRight
          className={cn(
            "ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      <Collapsible open={open} className={row ? undefined : "border-t border-action/15"}>
        <div className={cn("space-y-2 pb-2.5", row ? "px-2 pt-1" : "px-3 pt-2.5")}>
          <Field label="Input">{pretty(call.arguments) || "—"}</Field>
          {call.result !== undefined && <Field label="Result">{pretty(call.result)}</Field>}
        </div>
      </Collapsible>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-code p-2.5 font-mono text-xs leading-relaxed text-foreground/90">
        {children}
      </pre>
    </div>
  );
}

function StatusPill({ status }: { status: ToolStatus }) {
  if (status === "done")
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-2xs text-success">
        <Check className="size-3" /> done
      </span>
    );
  if (status === "error")
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-2xs text-danger">
        <AlertTriangle className="size-3" /> error
      </span>
    );
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-2xs text-action">
      <Loader2 className="size-3 animate-spin" />
      {status === "running" ? "running" : "calling"}
    </span>
  );
}
