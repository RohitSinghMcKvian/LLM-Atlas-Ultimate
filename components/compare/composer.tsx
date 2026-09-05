"use client";

import * as React from "react";
import { AlertTriangle, Globe, Paperclip, Send, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MAX_ATTACHMENTS, admitFiles, parseAttachment } from "@/lib/chat/attachments";
import type { Attachment } from "@/lib/chat/types";
import { getModelById } from "@/lib/catalog";
import type { RouteEnv } from "@/lib/catalog/availability";
import { estimateRunCost } from "@/lib/compare/cost";
import { planLanes, type LaneModel } from "@/lib/compare/lanes";
import { BAND_RGB } from "@/lib/compare/bands";
import { MAX_LANES, type Depth } from "@/lib/compare/types";
import { cn, formatUSD } from "@/lib/utils";
import { DepthControl } from "./depth-control";
import { LanePicker } from "./lane-picker";

/**
 * Ask the question.
 *
 * The whole surface is one textarea, a row of model chips and a button — the
 * ambition of the module lives behind the Depth control, not in front of it.
 *
 * The one number that had to change is the estimate. The old one assumed every
 * model would produce exactly 500 tokens and left the synthesis pass out
 * entirely, so it under-reported a three-model run by more than it showed. This
 * prices what will actually run, including the passes that read every answer
 * back, and states it as a range because output length genuinely is not known
 * in advance.
 */

export interface ComposerProps {
  question: string;
  onQuestionChange: (q: string) => void;
  selected: string[];
  onToggleModel: (id: string) => void;
  depth: Depth;
  onDepthChange: (d: Depth) => void;
  /** Force retrieval on or off instead of letting the brief decide. */
  web: boolean | undefined;
  onWebChange: (web: boolean | undefined) => void;
  attachments: Attachment[];
  onAttachmentsChange: (next: Attachment[]) => void;
  env: RouteEnv | null;
  disabled?: boolean;
  onRun: () => void;
  /** Compact form, shown once a run is on screen. */
  collapsed?: boolean;
  /** Controls that belong to starting a session rather than to a turn. */
  beforeRun?: React.ReactNode;
}

export function Composer({
  question,
  onQuestionChange,
  selected,
  onToggleModel,
  depth,
  onDepthChange,
  web,
  onWebChange,
  attachments,
  onAttachmentsChange,
  env,
  disabled,
  onRun,
  collapsed = false,
  beforeRun,
}: ComposerProps) {
  const fileInput = React.useRef<HTMLInputElement | null>(null);
  const [rejected, setRejected] = React.useState<string[]>([]);

  const addFiles = React.useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      // The same admission rules the chat composer uses, so a file rejected here
      // is rejected there for the same stated reason.
      const { accepted, rejected: turnedAway } = admitFiles(attachments.length, Array.from(files));
      setRejected(turnedAway.map((r) => `${r.name} ${r.reason}`));
      const parsed = await Promise.all(accepted.map(parseAttachment));
      onAttachmentsChange([...attachments, ...parsed]);
    },
    [attachments, onAttachmentsChange],
  );
  const plan = React.useMemo(() => {
    if (!env) return null;
    return planLanes({ config: { question, modelIds: selected, depth }, env });
  }, [env, question, selected, depth]);

  const estimate = React.useMemo(() => {
    if (!plan) return null;
    return estimateRunCost({
      question,
      lanes: plan.lanes,
      depth,
      lookup: (id) => getModelById(id) as LaneModel | undefined,
    });
  }, [plan, question, depth]);

  const runnable = plan?.lanes.filter((l) => !l.blocked).length ?? selected.length;
  const blocked = plan?.lanes.filter((l) => l.blocked) ?? [];
  const canRun = Boolean(question.trim()) && runnable > 0 && !disabled;

  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-surface/50 shadow-glow transition-all",
        collapsed ? "p-3" : "p-4 sm:p-5",
      )}
    >
      <textarea
        value={question}
        onChange={(e) => onQuestionChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canRun) onRun();
        }}
        rows={collapsed ? 1 : 3}
        placeholder="Ask one question. Every model answers from the same evidence."
        aria-label="Question"
        className="w-full resize-none bg-transparent text-body outline-none placeholder:text-muted-foreground/60"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {selected.map((id, i) => {
          const model = getModelById(id);
          const lane = plan?.lanes.find((l) => l.id === id);
          return (
            <Badge
              key={id}
              variant="outline"
              className={cn("gap-1.5 py-1 pl-1.5", lane?.blocked && "opacity-60")}
            >
              <span
                aria-hidden
                className="size-2 rounded-[3px]"
                style={{ backgroundColor: BAND_RGB[lane?.band ?? ((i % MAX_LANES) as 0)] }}
              />
              {model?.name ?? id}
              <button
                onClick={() => onToggleModel(id)}
                disabled={disabled}
                aria-label={`Remove ${model?.name ?? id}`}
                className="opacity-70 transition-opacity hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </Badge>
          );
        })}

        <LanePicker selected={selected} onToggle={onToggleModel} disabled={disabled} />

        <button
          onClick={() => fileInput.current?.click()}
          disabled={disabled || attachments.length >= MAX_ATTACHMENTS}
          title="Attach files for every model to read"
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-action hover:text-foreground disabled:opacity-50"
        >
          <Paperclip className="size-3" /> Files
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            void addFiles(e.target.files);
            // Reset so picking the same file twice still fires a change.
            e.target.value = "";
          }}
        />

        <label className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
          <Globe className="size-3.5" />
          Web
          <Switch
            checked={web !== false}
            disabled={disabled}
            onCheckedChange={(on) => onWebChange(on ? undefined : false)}
            aria-label="Search the web for evidence"
          />
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          {beforeRun}
          <DepthControl value={depth} onChange={onDepthChange} disabled={disabled} />
          {estimate && runnable > 0 && (
            <span
              className="hidden font-mono text-2xs tabular-nums text-muted-foreground sm:inline"
              title={`Between ${formatUSD(estimate.low, { precise: true })} and ${formatUSD(
                estimate.high,
                { precise: true },
              )}, including the research, scoring and synthesis passes.`}
            >
              {runnable} lane{runnable === 1 ? "" : "s"} · ~{formatUSD(estimate.expected, { precise: true })}
            </span>
          )}
          <Button variant="primary" onClick={onRun} disabled={!canRun}>
            <Send className="size-4" /> Run compare
          </Button>
        </div>
      </div>

      {attachments.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {attachments.map((a) => (
            <span
              key={a.id}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2/60 px-2 py-1 text-2xs",
                a.failed && "border-danger/40 text-danger",
              )}
            >
              <Paperclip className="size-3 shrink-0" />
              <span className="max-w-[12rem] truncate">{a.name}</span>
              <button
                onClick={() => onAttachmentsChange(attachments.filter((x) => x.id !== a.id))}
                disabled={disabled}
                aria-label={`Remove ${a.name}`}
                className="opacity-70 transition-opacity hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {rejected.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-2xs text-amber">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span>{rejected.join("; ")}.</span>
        </p>
      )}

      {blocked.length > 0 && !collapsed && (
        <p className="mt-2.5 flex items-start gap-1.5 text-2xs text-amber">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span>
            {blocked.map((l) => getModelById(l.modelId)?.name ?? l.modelId).join(", ")}{" "}
            {blocked.length === 1 ? "cannot run here" : "cannot run here"} — {blocked[0].blocked?.message}
          </span>
        </p>
      )}

      {plan && plan.dropped.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-2xs text-muted-foreground">
          <Sparkles className="mt-px size-3.5 shrink-0" />
          A run compares at most {MAX_LANES} models. {plan.dropped.length} will be left out.
        </p>
      )}
    </div>
  );
}
