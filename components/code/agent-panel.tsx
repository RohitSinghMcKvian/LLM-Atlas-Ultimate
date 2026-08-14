"use client";

import * as React from "react";
import { useCatalogSnapshot } from "@/lib/hooks/use-catalog-snapshot";
import {
  Play,
  Pause,
  Square,
  Loader2,
  Check,
  User,
  AlertCircle,
  Trash2,
  ChevronsUpDown,
  History,
  RotateCcw,
  Info,
  Settings2,
  MessagesSquare,
  ClipboardList,
  ShieldQuestion,
  Pencil,
  Plus,
  ArrowRightLeft,
} from "lucide-react";
import { AtlasMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Markdown } from "@/components/markdown";
import { ReasoningBlock } from "@/components/reasoning-block";
import { ToolCall } from "@/components/tool-call";
import { ConfigDialog } from "@/components/code/config-dialog";
import {
  ClarifyCard,
  HypothesisRow,
  PhaseRow,
  ReportCardView,
  TaskStatusStrip,
  TodosApprovalCard,
  VerdictRow,
} from "@/components/code/task-widgets";
import { ChangeSetReview } from "@/components/code/changeset-review";
import { AtlasMdProposal } from "@/components/code/atlas-md-proposal";
import { useCodeStore, type UiEvent, type AgentMode } from "@/lib/store/code-store";
import type { TraceEvent } from "@/lib/engine/types";
import { TASK_TEMPLATES } from "@/lib/engine/templates";
import { useFlag } from "@/lib/store/flags-store";
import type { CodeSessionMeta } from "@/lib/code/sessions";
import { routableModels, getModelById, modelAccess } from "@/lib/catalog";
import { timeAgo, cn } from "@/lib/utils";

/** Models the agent can actually drive (needs native tool calling). */
export function agentModels() {
  return routableModels().filter((m) => m.capabilities.toolUse);
}

export function AgentPanel({ keyHeaders }: { keyHeaders: Record<string, string> }) {
  const {
    status,
    bootNote,
    trace,
    running,
    checkpoints,
    modelId,
    setModelId,
    mode,
    setMode,
    pendingPlan,
    approvePlan,
    discardPlan,
    pendingApproval,
    resolveApproval,
    task,
    pendingClarify,
    resolveClarify,
    pendingTodos,
    resolveTodos,
    runCostUsd,
    runTokens,
    queueSteering,
    paused,
    setPaused,
    setStopAfterStep,
    stopAfterStep,
    handoff,
    pendingChangeSet,
    resolveChangeSet,
    pendingAtlasMd,
    resolveAtlasMd,
    sessionId,
    sessions,
    openSession,
    renameSession,
    deleteSession,
    runTask,
    stop,
    clearConversation,
    restoreCheckpoint,
  } = useCodeStore();

  const [goal, setGoal] = React.useState("");
  const taskLoopOn = useFlag("taskLoop");
  const [cpOpen, setCpOpen] = React.useState(false);
  // B.4 slash-command menu: shown when input is a bare "/token" and task loop is on.
  const slashQuery = /^\/[a-z-]*$/i.test(goal.trim()) ? goal.trim().toLowerCase() : null;
  const slashMatches =
    taskLoopOn && slashQuery
      ? TASK_TEMPLATES.filter((t) => t.command.startsWith(slashQuery))
      : [];
  const [sessOpen, setSessOpen] = React.useState(false);
  const [configOpen, setConfigOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = React.useState(true);
  const snapshot = useCatalogSnapshot();


  // Default the model to the first free tool-capable one — but only once the
  // persisted store has rehydrated, so a valid saved choice never gets
  // clobbered by the pre-hydration empty value.
  React.useEffect(() => {
    const applyDefault = () => {
      const { modelId: current, setModelId: set } = useCodeStore.getState();
      const models = agentModels();
      if (!current || !models.some((m) => m.id === current)) {
        const free = models.find((m) => modelAccess(m) === "free");
        set((free ?? models[0])?.id ?? "");
      }
    };
    const p = (useCodeStore as any).persist;
    if (!p?.hasHydrated || p.hasHydrated()) {
      applyDefault();
      return;
    }
    return p.onFinishHydration(applyDefault);
    // Re-runs on a catalog swap too: the daily sync can retire the selected
    // agent model mid-session, and an agent run against a dead id just fails.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  React.useEffect(() => {
    if (atBottom)
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [trace, atBottom]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  }

  function submit() {
    const g = goal.trim();
    if (!g || status === "booting") return;
    setGoal("");
    setAtBottom(true);
    // A.6: input during a run queues as steering instead of being blocked.
    if (running) queueSteering(g);
    else runTask(g, keyHeaders);
  }

  const model = getModelById(modelId);
  const ready = status === "ready" || status === "fallback";

  return (
    <div className="flex h-full w-full flex-col bg-surface/40">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-action text-action-foreground">
          <AtlasMark size={16} />
        </span>
        <div className="min-w-0 leading-tight">
          <p className="text-sm font-semibold">Atlas Code</p>
          <p className="truncate text-2xs text-muted-foreground" title={bootNote}>
            {status === "booting" && "Booting workspace…"}
            {status === "ready" && bootNote}
            {status === "fallback" && bootNote}
            {status === "error" && `Boot failed: ${bootNote}`}
            {status === "idle" && "Starting…"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {running ? (
            <Badge variant="primary">
              <Loader2 className="size-3 animate-spin" /> working
            </Badge>
          ) : status === "booting" ? (
            <Badge variant="outline">
              <Loader2 className="size-3 animate-spin" /> boot
            </Badge>
          ) : status === "fallback" ? (
            <Badge variant="outline" className="text-amber">
              limited
            </Badge>
          ) : ready ? (
            <Badge variant="success">
              <Check className="size-3" /> ready
            </Badge>
          ) : null}
          {checkpoints.length > 0 && (
            <Popover open={cpOpen} onOpenChange={setCpOpen}>
              <PopoverTrigger asChild>
                <button
                  title="Checkpoints"
                  aria-label="Checkpoints"
                  className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                >
                  <History className="size-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-2">
                <p className="mb-1.5 px-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                  Checkpoints
                </p>
                <div className="max-h-60 space-y-0.5 overflow-y-auto">
                  {checkpoints.map((cp) => (
                    <div
                      key={cp.id}
                      className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2/60"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs">{cp.label}</p>
                        <p className="text-2xs text-muted-foreground">
                          {Object.keys(cp.files).length} files · {timeAgo(cp.ts)}
                        </p>
                      </div>
                      <button
                        title="Restore workspace to this checkpoint"
                        disabled={running}
                        onClick={() => {
                          restoreCheckpoint(cp.id);
                          setCpOpen(false);
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-1 text-2xs text-muted-foreground opacity-0 transition-opacity hover:border-action/40 hover:text-foreground group-hover:opacity-100 disabled:opacity-40"
                      >
                        <RotateCcw className="size-3" /> Restore
                      </button>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
          <Popover open={sessOpen} onOpenChange={setSessOpen}>
            <PopoverTrigger asChild>
              <button
                title="Sessions"
                aria-label="Sessions"
                className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              >
                <MessagesSquare className="size-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-2">
              <div className="mb-1.5 flex items-center justify-between px-1">
                <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                  Sessions
                </p>
                <button
                  disabled={running}
                  onClick={() => {
                    clearConversation();
                    setSessOpen(false);
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-2xs text-muted-foreground hover:border-action/40 hover:text-foreground disabled:opacity-40"
                >
                  <Plus className="size-3" /> New
                </button>
              </div>
              <div className="max-h-64 space-y-0.5 overflow-y-auto">
                {sessions.length === 0 && (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                    No saved sessions yet — conversations save automatically after each run.
                  </p>
                )}
                {sessions.map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    active={s.id === sessionId}
                    disabled={running}
                    onOpen={() => {
                      openSession(s.id);
                      setSessOpen(false);
                    }}
                    onRename={(name) => renameSession(s.id, name)}
                    onDelete={() => deleteSession(s.id)}
                  />
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <button
            title="Agent configuration (tool permissions & hooks)"
            aria-label="Agent configuration"
            onClick={() => setConfigOpen(true)}
            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
          >
            <Settings2 className="size-4" />
          </button>
          {trace.length > 0 && !running && (
            <>
              <button
                title="Handoff: seed a fresh session with a resume brief (also copied to clipboard)"
                aria-label="Handoff session"
                onClick={() => {
                  const brief = handoff();
                  navigator.clipboard?.writeText(brief).catch(() => {});
                }}
                className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              >
                <ArrowRightLeft className="size-4" />
              </button>
              <button
                title="New session (workspace untouched)"
                aria-label="New session"
                onClick={clearConversation}
                className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              >
                <Trash2 className="size-4" />
              </button>
            </>
          )}
        </div>
      </div>
      <ConfigDialog open={configOpen} onOpenChange={setConfigOpen} />

      {/* Status line: phase, progress, live spend (Part E) */}
      {running && (
        <TaskStatusStrip
          task={task}
          running={running}
          costUsd={runCostUsd}
          tokens={runTokens}
          paused={paused}
        />
      )}

      {/* Timeline */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3"
      >
        {trace.length === 0 && (
          <div className="flex flex-col items-center gap-3 pt-12 text-center">
            <div className="relative">
              <div className="absolute -inset-3 rounded-full bg-action opacity-20 blur-xl" />
              <AtlasMark size={32} className="relative" />
            </div>
            <p className="max-w-[240px] text-sm text-muted-foreground">
              A real agent in a real workspace: it reads and edits files, runs
              Node and Python, and verifies its own work.
            </p>
            <div className="space-y-1.5 text-left">
              {[
                "Add a mode() function to lib/stats.js and cover it in test.js",
                "Run the tests and fix anything that fails",
                "Use Python to compute stats on the sample data",
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => setGoal(s)}
                  className="block w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-action/40 hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {trace.map((ev) => (
          <TraceRow key={ev.seq} ev={ev} />
        ))}

        {task?.report && !running && <ReportCardView report={task.report} />}
      </div>

      {/* Clarify card (batched questions, asked once) */}
      {pendingClarify && (
        <ClarifyCard questions={pendingClarify.questions} onAnswer={resolveClarify} />
      )}

      {/* Structured plan approval (task loop, plan mode) */}
      {pendingTodos && <TodosApprovalCard todos={pendingTodos} onResolve={resolveTodos} />}

      {/* Change-set review (B.3) */}
      {pendingChangeSet && (
        <ChangeSetReview changeSet={pendingChangeSet} onResolve={resolveChangeSet} />
      )}

      {/* ATLAS.md learning proposal (B.1) */}
      {pendingAtlasMd && (
        <AtlasMdProposal additions={pendingAtlasMd.additions} onResolve={resolveAtlasMd} />
      )}

      {/* Tool-approval card (run paused on policy "ask") */}
      {pendingApproval && (
        <div role="alert" className="border-t border-amber/30 bg-amber/10 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <ShieldQuestion className="mt-0.5 size-4 shrink-0 text-amber" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">
                Agent wants to run <code>{pendingApproval.name}</code>
              </p>
              <pre className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-surface/80 p-2 font-mono text-2xs text-muted-foreground">
                {formatArgs(pendingApproval.args)}
              </pre>
              <div className="mt-2 flex gap-1.5">
                <Button size="sm" variant="primary" onClick={() => resolveApproval(true)}>
                  Allow once
                </Button>
                <Button size="sm" variant="secondary" onClick={() => resolveApproval(true, true)}>
                  Always allow
                </Button>
                <Button size="sm" variant="ghost" onClick={() => resolveApproval(false)}>
                  Deny
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Plan-approval bar */}
      {pendingPlan && !running && (
        <div className="border-t border-action/30 bg-action/5 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <ClipboardList className="size-4 shrink-0 text-action" />
            <p className="min-w-0 flex-1 text-xs">
              <span className="font-medium">Plan ready.</span>{" "}
              <span className="text-muted-foreground">
                Approve to execute it (a checkpoint is taken first), or send feedback to refine.
              </span>
            </p>
            <Button size="sm" variant="ghost" onClick={discardPlan}>
              Discard
            </Button>
            <Button size="sm" variant="primary" onClick={() => approvePlan(keyHeaders)}>
              <Play className="size-3.5" /> Approve & execute
            </Button>
          </div>
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-border p-3">
        {/* B.4 task-template slash menu */}
        {slashMatches.length > 0 && !running && (
          <div className="mb-2 overflow-hidden rounded-xl border border-border bg-surface">
            {slashMatches.map((t) => (
              <button
                key={t.id}
                onClick={() => setGoal(t.command + " ")}
                className="flex w-full items-start gap-2 border-b border-border/50 px-3 py-1.5 text-left last:border-0 hover:bg-surface-2/60"
              >
                <code className="shrink-0 text-xs text-action">{t.command}</code>
                <span className="min-w-0">
                  <span className="text-xs">{t.label}</span>
                  <span className="block truncate text-2xs text-muted-foreground">
                    {t.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="rounded-xl border border-border bg-surface-2/50 p-2.5 focus-within:border-action/40">
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            placeholder={
              running
                ? "Queue a message for the agent — it joins at the next step…  (Enter)"
                : mode === "plan"
                  ? "Describe the goal — I'll investigate and propose a plan…  (Enter)"
                  : "Delegate a coding task…  (Enter to run)"
            }
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <ModeToggle mode={mode} onChange={setMode} disabled={running} />
              <ModelPicker value={modelId} onChange={setModelId} disabled={running} />
            </div>
            {running ? (
              <div className="flex items-center gap-1.5">
                {goal.trim() && (
                  <Button variant="secondary" size="sm" onClick={submit} title="Queue message for the agent">
                    <MessagesSquare className="size-3.5" /> Queue
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPaused(!paused)}
                  title={paused ? "Resume the run" : "Pause at the next step boundary"}
                >
                  {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                  {paused ? "Resume" : "Pause"}
                </Button>
                {task && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setStopAfterStep(!stopAfterStep)}
                    title="Finish the current todo, then stop gracefully"
                    className={cn(stopAfterStep && "border-amber/50 text-amber")}
                  >
                    <Square className="size-3.5" /> {stopAfterStep ? "Stopping…" : "After step"}
                  </Button>
                )}
                <Button variant="danger" size="sm" onClick={stop}>
                  <Square className="size-3.5" /> Stop
                </Button>
              </div>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={submit}
                disabled={!goal.trim() || status === "booting" || !model}
              >
                <Play className="size-3.5" /> Run
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Pretty-print raw tool-call JSON args for the approval card. */
function formatArgs(argsJson: string): string {
  try {
    return JSON.stringify(JSON.parse(argsJson), null, 1).slice(0, 600);
  } catch {
    return argsJson.slice(0, 600) || "(no arguments)";
  }
}

function ModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: AgentMode;
  onChange: (m: AgentMode) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex h-8 shrink-0 overflow-hidden rounded-lg border border-border text-xs">
      {(["agent", "plan"] as const).map((m) => (
        <button
          key={m}
          disabled={disabled}
          onClick={() => onChange(m)}
          title={
            m === "plan"
              ? "Plan mode: read-only investigation → a plan you approve before execution"
              : "Agent mode: full tools, auto-checkpoint before each run"
          }
          className={cn(
            "px-2 capitalize transition-colors disabled:opacity-60",
            mode === m
              ? m === "plan"
                ? "bg-action/15 font-medium text-action"
                : "bg-surface-3 font-medium"
              : "text-muted-foreground hover:bg-surface-2",
          )}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

function SessionRow({
  session,
  active,
  disabled,
  onOpen,
  onRename,
  onDelete,
}: {
  session: CodeSessionMeta;
  active: boolean;
  disabled?: boolean;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(session.name);

  if (editing) {
    return (
      <div className="px-2 py-1">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onRename(name);
              setEditing(false);
            }
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={() => setEditing(false)}
          className="h-6 w-full rounded border border-border bg-surface px-1.5 text-xs outline-none focus:border-action/40"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-surface-2/60",
        active && "bg-surface-2/60",
      )}
    >
      <button disabled={disabled} onClick={onOpen} className="min-w-0 flex-1 text-left disabled:opacity-60">
        <p className="truncate text-xs">{session.name}</p>
        <p className="text-2xs text-muted-foreground">
          {session.mode} · {timeAgo(session.updatedAt)}
        </p>
      </button>
      <button
        title="Rename"
        aria-label="Rename session"
        onClick={() => {
          setName(session.name);
          setEditing(true);
        }}
        className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 hover:bg-surface-3 hover:text-foreground group-hover:opacity-100"
      >
        <Pencil className="size-3" />
      </button>
      <button
        title="Delete session"
        aria-label="Delete session"
        onClick={onDelete}
        className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 hover:bg-surface-3 hover:text-danger group-hover:opacity-100"
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  );
}

/**
 * Trace dispatcher: legacy kinds render through the pre-v2 EventRow; Depth v2
 * kinds get dedicated rows. `todo` snapshots are skipped (the live status
 * strip + plan approval card cover them without spamming the timeline).
 */
function TraceRow({ ev }: { ev: TraceEvent }) {
  switch (ev.kind) {
    case "user":
    case "assistant":
    case "tool":
    case "system": {
      // Same display rule as projectUiEvents: hide finished empty turns.
      if (ev.kind === "assistant" && !ev.streaming && !ev.text.trim() && !ev.reasoning.trim())
        return null;
      return <EventRow ev={ev as UiEvent} />;
    }
    case "phase_change":
      return <PhaseRow to={ev.to} note={ev.note} />;
    case "verdict":
      return <VerdictRow verdict={ev.verdict} />;
    case "hypothesis":
      return <HypothesisRow text={ev.text} />;
    case "steering":
      return (
        <div className="flex items-start gap-2 rounded-xl border border-border bg-surface/60 px-3 py-2 text-xs text-muted-foreground">
          <User className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <span className="font-medium text-foreground">Steering:</span> {ev.text}
          </span>
        </div>
      );
    default:
      // todo snapshots + future kinds (cost, changeset, …) stay out of the
      // timeline for now.
      return null;
  }
}

function EventRow({ ev }: { ev: UiEvent }) {
  if (ev.kind === "user") {
    return (
      <div className="flex justify-end gap-2">
        <div className="max-w-[90%] rounded-2xl bg-surface-3 px-3 py-2 text-sm">
          {ev.text}
        </div>
        <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-surface-3 text-muted-foreground">
          <User className="size-3.5" />
        </span>
      </div>
    );
  }

  if (ev.kind === "assistant") {
    return (
      <div className="text-sm">
        {(ev.reasoning || (ev.streaming && !ev.text)) && (
          <ReasoningBlock text={ev.reasoning} streaming={ev.streaming && !ev.text} />
        )}
        {ev.text && (
          <div className="rounded-2xl border border-border bg-surface/60 px-3 py-2">
            <Markdown streaming={ev.streaming}>{ev.text}</Markdown>
            {ev.streaming && (
              <span className="ml-0.5 inline-block h-3.5 w-1 animate-caret-blink bg-action align-text-bottom" />
            )}
          </div>
        )}
        {ev.completionTokens != null && !ev.streaming && (
          <p className="mt-0.5 text-2xs text-muted-foreground/60">
            {ev.promptTokens != null && `${ev.promptTokens} in · `}
            {ev.completionTokens} out
          </p>
        )}
      </div>
    );
  }

  if (ev.kind === "tool") {
    return (
      <ToolCall
        call={{
          id: ev.id,
          name: ev.display ? `${ev.name} — ${ev.display}` : ev.name,
          arguments: ev.args,
          result: ev.result,
          status:
            ev.status === "running"
              ? "running"
              : ev.status === "error"
                ? "error"
                : "done",
        }}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-xl border px-3 py-2 text-xs",
        ev.tone === "error"
          ? "border-danger/30 bg-danger/10 text-danger"
          : "border-border bg-surface/60 text-muted-foreground",
      )}
    >
      {ev.tone === "error" ? (
        <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
      ) : (
        <Info className="mt-0.5 size-3.5 shrink-0" />
      )}
      {ev.text}
    </div>
  );
}

function ModelPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const models = React.useMemo(() => agentModels(), []);
  const active = getModelById(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          disabled={disabled}
          className="inline-flex h-8 max-w-[13rem] items-center gap-1.5 rounded-lg border border-border bg-surface px-2 text-xs disabled:opacity-60"
        >
          <span className="truncate">{active?.name ?? "Pick a model"}</span>
          <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Tool-capable models…" />
          <CommandList>
            <CommandEmpty>No tool-capable model.</CommandEmpty>
            <CommandGroup>
              {models.map((m) => (
                <CommandItem
                  key={m.id}
                  value={`${m.name} ${m.provider}`}
                  onSelect={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{m.name}</span>
                  <span className="ml-auto flex items-center gap-1 text-2xs text-muted-foreground">
                    {modelAccess(m) === "free" ? (
                      <Badge variant="success" className="px-1 py-0 text-2xs">
                        free
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="px-1 py-0 text-2xs">
                        key
                      </Badge>
                    )}
                    {m.provider}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
