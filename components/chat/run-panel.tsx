"use client";

import * as React from "react";
import {
  AlertTriangle,
  Brain,
  ChevronRight,
  CircleDot,
  Clock,
  ExternalLink,
  FileDiff,
  Globe,
  ListChecks,
  Loader2,
  Square,
  Terminal,
  Users,
  Wrench,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Collapsible } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { BudgetStop } from "@/components/chat/budget-stop";
import { buildRun, type RunStep } from "@/lib/chat/run-model";
import { formatUsd } from "@/lib/chat/cost";
import type { StoredToolCall } from "@/lib/chat/types";
import type { WorkspaceSnapshot, WorkspaceTask } from "@/lib/chat/workspace/types";
import { usePrefersReducedMotion } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils";

/**
 * What the agent is doing, while it is doing it.
 *
 * `activity-timeline.tsx` folds a finished turn into one line, and that is right
 * for a transcript: process available, not imposed. It is wrong for a run in
 * flight. A twenty-round build takes minutes, and for every one of them the reply
 * bubble shows three dots — so a build that is working is indistinguishable from
 * one that has hung, and the honest report at the end arrives long after the user
 * has concluded it failed.
 *
 * Four things, top to bottom: the numbers, the plan, the steps, the outcome. The
 * numbers come first because this is also the disclosure surface for a mode that
 * can spend money the user did not explicitly authorise.
 *
 * All logic is in `lib/chat/run-model.ts` — `vitest.config.ts` only reaches
 * `lib/**`, so anything decided in this file is untestable by construction.
 */
export function RunPanel({
  toolCalls,
  reasoning,
  progress,
  rounds,
  maxRounds,
  spentUsd,
  maxUsd,
  contextChars,
  contextWindow,
  workspace,
  streaming,
  elapsedMs,
  onStop,
  summary,
  stop,
  onContinueRun,
  onOpenSettings,
}: {
  /**
   * The run as fields, not as a `RunInput` object.
   *
   * The object was rebuilt by the caller every time the message list changed —
   * every 48ms while streaming — so this memo never once hit and `buildRun` ran
   * twenty times a second for the whole of a twenty-round build.
   */
  toolCalls?: StoredToolCall[];
  reasoning?: string;
  progress: Record<string, string>;
  rounds: number;
  maxRounds: number;
  spentUsd: number;
  maxUsd: number;
  /** Characters on the wire this round, after trimming. 0 between turns. */
  contextChars: number;
  /** The model's window, in tokens. Absent means the meter is not shown. */
  contextWindow?: number;
  workspace: WorkspaceSnapshot;
  streaming: boolean;
  elapsedMs: number;
  onStop?: () => void;
  /** One line on what the finished run produced. */
  summary?: string;
  /**
   * The budget stop, as data.
   *
   * Passed as facts rather than as a rendered strip: an element is a new object
   * every render and would defeat the memo on the mount above it. The panel
   * builds the same `BudgetStop` the transcript uses, so the rail and the bubble
   * offer one control from one set of facts — and the user watching the meters
   * fill finds Continue where they were already looking.
   */
  stop?: { reason: string; message: string; spentUsd?: number };
  onContinueRun?: () => void;
  onOpenSettings?: () => void;
}) {
  const run = React.useMemo(
    () =>
      buildRun({
        toolCalls,
        reasoning,
        progress,
        streaming,
        rounds,
        maxRounds,
        spentUsd,
        maxUsd,
        stoppedBy: stop?.message,
      }),
    [toolCalls, reasoning, progress, streaming, rounds, maxRounds, spentUsd, maxUsd, stop?.message],
  );
  const reduced = usePrefersReducedMotion();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = React.useState(true);

  /**
   * Park CSS animation when the panel is off screen.
   *
   * `constellation.tsx` parks its RAF loop with an IntersectionObserver for the
   * same reason; a shimmering connector in a scrolled-away rail is the same waste
   * in a different mechanism. `data-parked` is read by one rule in globals.css.
   */
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        el.toggleAttribute("data-parked", !entry.isIntersecting);
      },
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Follow the newest step unless the user has scrolled up to read an older one.
  // The same rule the thread uses, and for the same reason: auto-scrolling away
  // from something someone is reading is worse than not auto-scrolling.
  React.useEffect(() => {
    if (atBottom) bottomRef.current?.scrollIntoView({ block: "end", behavior: reduced ? "auto" : "smooth" });
  }, [run.steps.length, atBottom, reduced]);

  const tasks = workspace.tasks;
  const hasMeters = run.meters.maxRounds > 0;

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      {/* ── Meters ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 space-y-2 border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2 text-2xs text-muted-foreground">
          {streaming ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-action" />
          ) : (
            <CircleDot className="size-3.5 shrink-0 text-muted-foreground/60" />
          )}
          <span className="min-w-0 flex-1 truncate text-foreground/90">
            {run.headline || (streaming ? "Working…" : "Idle")}
          </span>
          {elapsedMs > 0 && (
            <span className="tnum shrink-0">{Math.max(1, Math.round(elapsedMs / 1000))}s</span>
          )}
          {streaming && onStop && (
            <Button variant="ghost" size="icon-sm" onClick={onStop} aria-label="Stop">
              <Square className="size-3.5 text-danger" />
            </Button>
          )}
        </div>

        {hasMeters && (
          <div
            className={cn(
              // Two columns until there is room for three. The panel's minimum
              // is 320px and it also renders inside the mobile sheet, where
              // three columns of tabular numbers each lost half their digits.
              "grid gap-3 grid-cols-2",
              contextWindow && "sm:grid-cols-3",
            )}
          >
            <Meter
              label="rounds"
              value={`${run.meters.rounds}/${run.meters.maxRounds}`}
              ratio={run.meters.roundsRatio}
              tone="primary"
            />
            <Meter
              label="spend"
              value={`$${run.meters.spentUsd.toFixed(2)} / $${run.meters.maxUsd.toFixed(2)}`}
              ratio={run.meters.costRatio}
              tone="budget"
            />
            {/* The number that actually stops a long build. Shown only once a
                round has reported one, so an ordinary turn is unchanged. */}
            {contextWindow && (
              <Meter
                label="context"
                value={`${Math.round(contextChars / 4 / 1000)}k / ${Math.round(contextWindow / 1000)}k`}
                ratio={Math.min(1, contextChars / 4 / contextWindow)}
                tone="budget"
              />
            )}
          </div>
        )}
      </div>

      {/* ── Plan ledger ────────────────────────────────────────────────── */}
      {tasks.length > 0 && (
        <div className="shrink-0 border-b border-border px-3 py-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
            <ListChecks className="size-3.5" />
            Plan
            <span className="tnum ml-auto">
              {tasks.filter((t) => t.status === "done").length}/{tasks.length}
            </span>
          </div>
          <ol className="space-y-0.5">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ol>
        </div>
      )}

      {/* ── Step stream ────────────────────────────────────────────────── */}
      <div
        onScroll={(e) => {
          const el = e.currentTarget;
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
      >
        {run.steps.length === 0 ? (
          <p className="py-8 text-center text-2xs text-muted-foreground/70">
            Tool calls, file writes and command output appear here while Atlas works.
          </p>
        ) : (
          <ol>
            {run.steps.map((step, i) => (
              <StepRow key={step.id} step={step} last={i === run.steps.length - 1} />
            ))}
          </ol>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Outcome ────────────────────────────────────────────────────── */}
      {(summary || stop) && (
        <div className="shrink-0 border-t border-border px-3 py-2">
          {stop ? (
            <BudgetStop
              reason={stop.reason}
              message={stop.message}
              rounds={rounds || undefined}
              maxRounds={maxRounds || undefined}
              spentUsd={stop.spentUsd ?? spentUsd}
              maxUsd={maxUsd || undefined}
              busy={streaming}
              onContinue={onContinueRun}
              onOpenSettings={onOpenSettings}
            />
          ) : (
            summary && <p className="text-2xs text-muted-foreground">{summary}</p>
          )}
        </div>
      )}
    </div>
  );
}

function Meter({
  label,
  value,
  ratio,
  tone,
}: {
  label: string;
  value: string;
  ratio: number;
  tone: "primary" | "budget";
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-2xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tnum text-foreground/80">{value}</span>
      </div>
      <Progress value={ratio} tone={tone} label={label} />
    </div>
  );
}

const TASK_TONE: Record<WorkspaceTask["status"], string> = {
  active: "border-l-action text-foreground",
  done: "border-l-transparent text-muted-foreground/60 line-through decoration-muted-foreground/30",
  blocked: "border-l-amber text-amber",
  pending: "border-l-transparent text-muted-foreground",
};

function TaskRow({ task }: { task: WorkspaceTask }) {
  return (
    <li
      className={cn(
        "flex items-start gap-2 border-l-2 py-0.5 pl-2 text-2xs transition-colors",
        TASK_TONE[task.status],
        // The active step is the one thing in this list you should be able to
        // find without reading it.
        task.status === "active" && "rounded-r bg-action/[0.06]",
      )}
    >
      {/* Two lines before it gives up, and the full text on hover. A single
          truncated line at the panel's 320px minimum cut most plan steps mid-word
          with no way to read the rest. */}
      <span className="line-clamp-2 min-w-0 flex-1" title={task.title}>
        {task.title}
      </span>
      {task.note && <span className="shrink-0 text-muted-foreground/60">{task.note}</span>}
    </li>
  );
}

const STEP_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  search: Globe,
  diff: FileDiff,
  terminal: Terminal,
  tasks: ListChecks,
  subagents: Users,
  raw: Wrench,
};

function StepRow({ step, last }: { step: RunStep; last: boolean }) {
  // A failure opens itself. Everything else is a click away — the point of the
  // panel is that the run is legible at a glance, not that every byte is on
  // screen.
  const [open, setOpen] = React.useState(step.status === "error");
  const Icon = step.kind === "thinking" ? Brain : (STEP_ICON[step.body.kind] ?? Wrench);

  return (
    <li className="relative flex gap-2.5">
      {/* Gutter: a connector down the left, brightening through the step that is
          currently running. */}
      <div className="flex w-5 shrink-0 flex-col items-center">
        <span
          className={cn(
            "grid size-5 place-items-center rounded-full border",
            step.status === "error"
              ? "border-danger/40 bg-danger/10 text-danger"
              : step.status === "running"
                ? "border-action/40 bg-action/10 text-action"
                : "border-border bg-surface-2 text-muted-foreground",
          )}
        >
          {step.status === "running" ? (
            <Loader2 className="size-3 animate-spin" />
          ) : step.status === "error" ? (
            <AlertTriangle className="size-3" />
          ) : (
            <Icon className="size-3" />
          )}
        </span>
        {!last && (
          <span
            className={cn(
              "w-px flex-1",
              step.status === "running"
                ? "atlas-run-connector bg-gradient-to-b from-action to-transparent"
                : "bg-border",
            )}
          />
        )}
      </div>

      <div className="min-w-0 flex-1 pb-2">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-h-11 w-full items-center gap-1.5 rounded-md py-0.5 text-left text-2xs hover:bg-surface-2/60 sm:min-h-0"
        >
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-muted-foreground/60 transition-transform",
              open && "rotate-90",
            )}
          />
          <span
            className={cn(
              // Was `shrink-0`, which let a long label push the detail off the
              // row rather than yielding any of its own width.
              "min-w-0 shrink truncate",
              step.status === "error" ? "text-danger" : "text-foreground/90",
            )}
            title={step.label}
          >
            {step.label}
          </span>
          {step.detail && (
            <span className="min-w-0 truncate font-mono text-muted-foreground">{step.detail}</span>
          )}
        </button>

        <Collapsible open={open}>
          <StepBody step={step} />
        </Collapsible>
      </div>
    </li>
  );
}

function StepBody({ step }: { step: RunStep }) {
  const body = step.body;

  if (body.kind === "search") {
    if (!body.sources.length) {
      return <Empty>No results.</Empty>;
    }
    return (
      <ul className="mb-1.5 mt-1 space-y-1">
        {body.sources.map((s, i) => (
          <li key={s.url + i}>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group/src flex items-start gap-1.5 rounded-md px-1.5 py-1 hover:bg-surface-2/60"
            >
              <span className="tnum mt-px shrink-0 text-2xs text-muted-foreground/60">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-2xs text-foreground/90">{s.title}</span>
                <span className="block truncate text-2xs text-muted-foreground/70">
                  {hostOf(s.url)}
                </span>
              </span>
              <ExternalLink className="mt-px size-3 shrink-0 text-muted-foreground/0 group-hover/src:text-muted-foreground" />
            </a>
          </li>
        ))}
      </ul>
    );
  }

  if (body.kind === "terminal") {
    return (
      <pre
        className={cn(
          // Matches `components/tool-call.tsx` so a terminal reads the same
          // wherever it appears.
          "mb-1.5 mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-code px-2.5 py-2 font-mono text-2xs leading-relaxed",
          body.failed ? "border-danger/30 text-danger/90" : "border-border text-foreground/80",
        )}
      >
        {body.text || "…"}
      </pre>
    );
  }

  if (body.kind === "diff") {
    return (
      <div className="mb-1.5 mt-1 rounded-lg border border-border bg-surface-2/40 px-2.5 py-1.5">
        {body.path && (
          <p className="break-all font-mono text-2xs text-action">{body.path}</p>
        )}
        <p className="break-words text-2xs text-muted-foreground">{body.summary}</p>
      </div>
    );
  }

  if (body.kind === "tasks") {
    return (
      <div className="mb-1.5 mt-1 rounded-lg border border-border bg-surface-2/40 px-2.5 py-1.5 text-2xs text-muted-foreground">
        {body.summary}
      </div>
    );
  }

  // A fan-out, nested one level. Each agent carries its own spinner and its own
  // cost, because "three sub-agents are running" without saying what each is
  // spending is exactly the opacity the Run panel exists to remove.
  if (body.kind === "subagents") {
    return (
      <ul className="mb-1.5 mt-1 space-y-1">
        {body.agents.map((a, i) => (
          <li
            key={`${a.title}-${i}`}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/40 px-2.5 py-1.5"
          >
            <span className="shrink-0 text-muted-foreground">
              {a.phase === "running" ? (
                <Loader2 className="size-3 animate-spin text-action" />
              ) : a.phase === "error" ? (
                <AlertTriangle className="size-3 text-danger" />
              ) : a.phase === "done" ? (
                <Users className="size-3" />
              ) : (
                <Clock className="size-3" />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate text-2xs text-foreground/80">{a.title}</span>
            {a.note && (
              <span className="shrink-0 text-2xs text-muted-foreground/70">{a.note}</span>
            )}
            <span className="shrink-0 font-mono text-2xs text-muted-foreground">
              {a.rounds > 0 && `${a.rounds}r `}
              {formatUsd(a.spentUsd)}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  if (!body.args && !body.result) return <Empty>Nothing recorded.</Empty>;
  return (
    <div className="mb-1.5 mt-1 space-y-1">
      {body.args && body.args !== "{}" && (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-2/40 px-2.5 py-1.5 font-mono text-2xs text-muted-foreground">
          {body.args}
        </pre>
      )}
      {body.result && (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-2/40 px-2.5 py-1.5 font-mono text-2xs text-foreground/80">
          {body.result}
        </pre>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 mt-1 px-1.5 text-2xs text-muted-foreground/70">{children}</p>;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
