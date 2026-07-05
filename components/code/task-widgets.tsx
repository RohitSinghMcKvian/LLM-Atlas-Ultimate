"use client";

// Task-loop UI (Depth v2 A.1/A.2): phase badge, live todo panel, verdict rows,
// clarify + plan-approval cards, and the delivery report card. The trace
// timeline is the hero surface — these render its v2 event kinds.

import * as React from "react";
import {
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  ClipboardList,
  Compass,
  FileText,
  Lightbulb,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  Play,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatUsd } from "@/lib/chat/cost";
import type { Phase, ReportCard, TaskState, Todo, Verdict } from "@/lib/engine/types";
import { cn } from "@/lib/utils";

const PHASE_LABEL: Record<Phase, string> = {
  intake: "Intake",
  clarify: "Clarify",
  explore: "Explore",
  plan: "Plan",
  execute: "Execute",
  verify: "Verify",
  self_correct: "Self-correct",
  review: "Review",
  deliver: "Deliver",
  done: "Done",
  stopped: "Stopped",
};

const PHASE_TONE: Partial<Record<Phase, string>> = {
  explore: "text-cyan",
  plan: "text-cyan",
  verify: "text-amber",
  self_correct: "text-amber",
  review: "text-violet",
  done: "text-success",
  stopped: "text-muted-foreground",
};

export function PhaseBadge({ phase, running }: { phase: Phase; running: boolean }) {
  return (
    <Badge variant="outline" className={cn("gap-1", PHASE_TONE[phase])}>
      {running && phase !== "done" && phase !== "stopped" ? (
        <Loader2 className="size-3 animate-spin" />
      ) : phase === "done" ? (
        <CheckCircle2 className="size-3" />
      ) : (
        <Compass className="size-3" />
      )}
      {PHASE_LABEL[phase]}
    </Badge>
  );
}

/** Status line (Part E) while a run is live: phase, todo progress, spend. */
export function TaskStatusStrip({
  task,
  running,
  costUsd,
  tokens,
  paused,
}: {
  task: TaskState | null;
  running: boolean;
  costUsd: number;
  tokens: number;
  paused?: boolean;
}) {
  const done = task?.todos.filter((t) => t.status === "done").length ?? 0;
  return (
    <div className="flex items-center gap-2 border-b border-border bg-surface/60 px-3 py-1.5 text-2xs text-muted-foreground">
      {task ? (
        <PhaseBadge phase={task.phase} running={running} />
      ) : (
        <Badge variant="outline" className="gap-1">
          <Loader2 className="size-3 animate-spin" /> working
        </Badge>
      )}
      {paused && (
        <Badge variant="outline" className="gap-1 text-amber">
          paused
        </Badge>
      )}
      {task && task.todos.length > 0 && (
        <span className="inline-flex items-center gap-1">
          <ListChecks className="size-3" />
          {done}/{task.todos.length} todos
        </span>
      )}
      <span className="ml-auto tabular-nums">
        {tokens > 0 && `${(tokens / 1000).toFixed(1)}k tok · `}
        {formatUsd(costUsd)}
      </span>
    </div>
  );
}

const TODO_ICON: Record<Todo["status"], React.ReactNode> = {
  pending: <CircleDashed className="size-3.5 text-muted-foreground" />,
  active: <Loader2 className="size-3.5 animate-spin text-cyan" />,
  done: <CheckCircle2 className="size-3.5 text-success" />,
  failed: <XCircle className="size-3.5 text-danger" />,
  skipped: <CircleDashed className="size-3.5 text-muted-foreground/50" />,
};

export function TodoList({ todos, compact }: { todos: Todo[]; compact?: boolean }) {
  return (
    <ul className="space-y-1">
      {todos.map((t) => (
        <li key={t.id} className="flex items-start gap-2 text-xs">
          <span className="mt-0.5 shrink-0">{TODO_ICON[t.status]}</span>
          <div className="min-w-0">
            <p className={cn(t.status === "done" && "text-muted-foreground line-through")}>
              {t.text}
            </p>
            {!compact && (
              <p className="text-2xs text-muted-foreground/70">done when: {t.acceptance}</p>
            )}
            {t.attempts > 0 && (
              <p className="text-2xs text-amber">
                {t.attempts} self-correct attempt{t.attempts === 1 ? "" : "s"}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Timeline row: a structured verification verdict with expandable evidence. */
export function VerdictRow({ verdict }: { verdict: Verdict }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-1.5 text-xs",
        verdict.pass ? "border-success/25 bg-success/5" : "border-danger/30 bg-danger/10",
      )}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
      >
        {verdict.pass ? (
          <CheckCircle2 className="size-3.5 shrink-0 text-success" />
        ) : (
          <XCircle className="size-3.5 shrink-0 text-danger" />
        )}
        <span className="font-medium capitalize">{verdict.check}</span>
        <code className="truncate text-2xs text-muted-foreground">{verdict.command}</code>
        <span className="ml-auto shrink-0 text-2xs tabular-nums text-muted-foreground">
          {(verdict.durationMs / 1000).toFixed(1)}s
        </span>
        <ChevronDown className={cn("size-3 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && verdict.evidence && (
        <pre className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-surface/70 p-2 font-mono text-2xs text-muted-foreground">
          {verdict.evidence}
        </pre>
      )}
    </div>
  );
}

/** Timeline row: phase transition marker. */
export function PhaseRow({ to, note }: { to: Phase; note?: string }) {
  return (
    <div className="flex items-center gap-2 px-1 text-2xs uppercase tracking-wide text-muted-foreground/70">
      <span className="h-px flex-1 bg-border" />
      <Compass className="size-3" />
      {PHASE_LABEL[to]}
      {note ? ` — ${note}` : ""}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Timeline row: a stated debugging hypothesis / strategy. */
export function HypothesisRow({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber/30 bg-amber/5 px-3 py-2 text-xs">
      <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-amber" />
      <span>
        <span className="font-medium text-amber">Strategy:</span> {text}
      </span>
    </div>
  );
}

/** CLARIFY card: batched questions, answered once (or skipped). */
export function ClarifyCard({
  questions,
  onAnswer,
}: {
  questions: string[];
  onAnswer: (answer: string | null) => void;
}) {
  const [text, setText] = React.useState("");
  return (
    <div role="alert" className="border-t border-cyan/30 bg-cyan/5 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-cyan" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">Quick questions before building (asked once):</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
            {questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            autoFocus
            placeholder="Answers (free-form)…"
            className="mt-2 w-full resize-none rounded-lg border border-border bg-surface/80 p-2 text-xs outline-none focus:border-cyan/40"
          />
          <div className="mt-1.5 flex gap-1.5">
            <Button size="sm" variant="primary" disabled={!text.trim()} onClick={() => onAnswer(text)}>
              Answer & continue
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onAnswer(null)}>
              Skip — use safe defaults
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Structured plan approval: per-todo keep/drop, then approve. */
export function TodosApprovalCard({
  todos,
  onResolve,
}: {
  todos: Todo[];
  onResolve: (todos: Todo[] | null) => void;
}) {
  const [kept, setKept] = React.useState(todos);
  return (
    <div className="border-t border-cyan/30 bg-cyan/5 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <ClipboardList className="mt-0.5 size-4 shrink-0 text-cyan" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">
            Plan ready — {kept.length} todo{kept.length === 1 ? "" : "s"}. Drop any you don't
            want, then approve.
          </p>
          <ul className="mt-1.5 space-y-1">
            {kept.map((t) => (
              <li key={t.id} className="flex items-start gap-2 rounded-lg bg-surface/70 px-2 py-1.5 text-xs">
                <div className="min-w-0 flex-1">
                  <p>{t.text}</p>
                  <p className="text-2xs text-muted-foreground/70">done when: {t.acceptance}</p>
                </div>
                <button
                  title="Drop this todo"
                  aria-label={`Drop todo: ${t.text}`}
                  disabled={kept.length === 1}
                  onClick={() => setKept((k) => k.filter((x) => x.id !== t.id))}
                  className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-surface-3 hover:text-danger disabled:opacity-30"
                >
                  <Trash2 className="size-3" />
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-1.5">
            <Button size="sm" variant="primary" onClick={() => onResolve(kept)}>
              <Play className="size-3.5" /> Approve & execute
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onResolve(null)}>
              Discard
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** DELIVER report card: what changed, what was verified, what's left. */
export function ReportCardView({ report }: { report: ReportCard }) {
  return (
    <div className="rounded-2xl border border-success/25 bg-success/5 p-3 text-xs">
      <p className="mb-2 flex items-center gap-1.5 font-medium">
        <FileText className="size-3.5 text-success" /> Delivery report
        <span className="ml-auto text-2xs font-normal tabular-nums text-muted-foreground">
          {report.tokens > 0 && `${(report.tokens / 1000).toFixed(1)}k tok · `}
          {formatUsd(report.costUsd)}
        </span>
      </p>
      {report.files.length > 0 && (
        <section className="mb-2">
          <p className="mb-1 text-2xs uppercase tracking-wide text-muted-foreground">Files</p>
          <ul className="space-y-0.5 font-mono text-2xs">
            {report.files.map((f) => (
              <li key={f.path}>
                <span
                  className={cn(
                    "mr-1.5 inline-block w-14 text-right",
                    f.kind === "new" && "text-success",
                    f.kind === "modified" && "text-cyan",
                    f.kind === "deleted" && "text-danger",
                  )}
                >
                  {f.kind}
                </span>
                {f.path}
              </li>
            ))}
          </ul>
        </section>
      )}
      {report.verified.length > 0 && (
        <section className="mb-2">
          <p className="mb-1 text-2xs uppercase tracking-wide text-muted-foreground">Verified</p>
          <ul className="space-y-0.5">
            {report.verified.map((v) => (
              <li key={v} className="flex items-center gap-1.5">
                <CheckCircle2 className="size-3 text-success" /> {v}
              </li>
            ))}
          </ul>
        </section>
      )}
      {report.assumed.length > 0 && (
        <section className="mb-2">
          <p className="mb-1 text-2xs uppercase tracking-wide text-muted-foreground">Assumed</p>
          <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
            {report.assumed.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
      )}
      {report.leftUndone.length > 0 && (
        <section>
          <p className="mb-1 text-2xs uppercase tracking-wide text-muted-foreground">
            Left undone
          </p>
          <ul className="space-y-0.5">
            {report.leftUndone.map((l) => (
              <li key={l} className="flex items-center gap-1.5 text-danger">
                <XCircle className="size-3" /> {l}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
