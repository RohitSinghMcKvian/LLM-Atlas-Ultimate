"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Wrench, Check, Loader2, AlertTriangle } from "lucide-react";
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
export function ToolCall({ call, defaultOpen = false }: { call: ToolCallView; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const status = call.status ?? (call.result !== undefined ? "done" : "calling");

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-cyan/20 bg-cyan/5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-cyan/10"
      >
        <Wrench className="size-3.5 text-cyan" />
        <span className="font-medium text-foreground">{call.name || "tool"}</span>
        <StatusPill status={status} />
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
            className="border-t border-cyan/15"
          >
            <div className="space-y-2 px-3 py-2.5">
              <Field label="Input">{pretty(call.arguments) || "—"}</Field>
              {call.result !== undefined && (
                <Field label="Result">{pretty(call.result)}</Field>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <pre className="max-h-56 overflow-auto rounded-lg bg-[#0b0d14] p-2.5 font-mono text-[12px] leading-relaxed text-foreground/90">
        {children}
      </pre>
    </div>
  );
}

function StatusPill({ status }: { status: ToolStatus }) {
  if (status === "done")
    return (
      <span className="inline-flex items-center gap-1 text-2xs text-success">
        <Check className="size-3" /> done
      </span>
    );
  if (status === "error")
    return (
      <span className="inline-flex items-center gap-1 text-2xs text-danger">
        <AlertTriangle className="size-3" /> error
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-2xs text-cyan">
      <Loader2 className="size-3 animate-spin" />
      {status === "running" ? "running" : "calling"}
    </span>
  );
}
