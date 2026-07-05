"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getWorkspace, isTextPath, type Workspace } from "@/lib/code/workspace";
import { runAgent } from "@/lib/code/agent";
import {
  DEFAULT_POLICY,
  DEFAULT_HOOKS,
  type ToolPolicy,
  type PolicyDecision,
  type Hook,
} from "@/lib/code/policy";
import { codeSessionsRepo, type CodeSessionMeta } from "@/lib/code/sessions";
import { getModelById } from "@/lib/catalog";
import type { ChatMessage as RouterMsg } from "@/lib/router";
import type { ChangeRecord } from "@/lib/code/tools";
import type { TermLine } from "@/components/code/terminal";
import type { ChangeSet, Hunk, LegacyUiEvent, TaskState, Todo, TraceEvent } from "@/lib/engine/types";
import { applyHunkDecisions, buildChangeSet } from "@/lib/engine/changeset";
import {
  appendTrace,
  liftUiEventsToTrace,
  patchTraceEvent,
  projectUiEvents,
  type TraceInput,
} from "@/lib/engine/trace";
import { runTaskLoop } from "@/lib/engine/task-loop";
import type { AgentPhaseResult, AgentPhaseRun, TaskPorts } from "@/lib/engine/ports";
import {
  buildHandoffBrief,
  compactHistory,
  estimateTokens,
  taskFactBlock,
} from "@/lib/engine/context";
import { mergeRoles, type AgentRole } from "@/lib/engine/orchestrator";
import { expandTemplate, matchTemplateInput } from "@/lib/engine/templates";
import { isEnabled } from "@/lib/store/flags-store";
import { messageCostUsd } from "@/lib/chat/cost";
import { postSSE } from "@/lib/sse-client";
import type { AgentUiEvent } from "@/lib/code/agent";

export type WsStatus = "idle" | "booting" | "ready" | "fallback" | "error";

/** The agent panel's working mode — plan proposes, agent executes. */
export type AgentMode = "agent" | "plan";

/**
 * Depth v2: the trace (TraceEvent[]) is the source of truth; `UiEvent` is the
 * legacy projection the components render. The shape is unchanged from pre-v2
 * (it now lives in lib/engine/types.ts).
 */
export type UiEvent = LegacyUiEvent;

export interface Checkpoint {
  id: string;
  label: string;
  ts: number;
  files: Record<string, string>;
}

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const MAX_CHECKPOINTS = 12;
const MAX_SNAPSHOT_FILE = 200_000;
const MANUAL_CMD_TIMEOUT = 300_000; // dev servers etc. get 5 minutes

interface CodeState {
  status: WsStatus;
  bootNote: string;
  wsKind: "webcontainer" | "memory" | null;

  /** Event-sourced trace — the single source of truth for the timeline. */
  trace: TraceEvent[];
  /** Projection of `trace` for the pre-v2 components (kept in lockstep). */
  events: UiEvent[];
  running: boolean;
  history: RouterMsg[];

  paths: string[];
  changedMap: Record<string, "new" | "modified">;
  activePath: string | null;
  buffer: string;
  savedBuffer: string;

  terminal: TermLine[];
  changes: ChangeRecord[];
  checkpoints: Checkpoint[];

  /** Persisted model choice for the agent (must be tool-capable). */
  modelId: string;
  setModelId: (id: string) => void;

  /** Plan mode: the agent investigates read-only and proposes; you approve. */
  mode: AgentMode;
  setMode: (m: AgentMode) => void;
  /** Awaiting approval after a plan-mode run. */
  pendingPlan: { goal: string; text: string } | null;
  approvePlan: (keyHeaders: Record<string, string>) => Promise<void>;
  discardPlan: () => void;

  /** Per-tool allow/ask/deny + user hooks (persisted). */
  toolPolicy: ToolPolicy;
  setToolDecision: (tool: string, d: PolicyDecision) => void;
  hooks: Hook[];
  setHooks: (hooks: Hook[]) => void;

  /** A tool call paused on policy "ask", awaiting the user. */
  pendingApproval: { name: string; args: string } | null;
  resolveApproval: (allow: boolean, always?: boolean) => void;

  // ── Task loop (Depth v2, flag "taskLoop") ─────────────────────────────────
  /** Live task-loop state while a v2 run is active (null otherwise). */
  task: TaskState | null;
  /** Batched clarifying questions awaiting the user (CLARIFY phase). */
  pendingClarify: { questions: string[] } | null;
  resolveClarify: (answer: string | null) => void;
  /** Structured plan awaiting approval (plan mode + taskLoop flag). */
  pendingTodos: Todo[] | null;
  resolveTodos: (todos: Todo[] | null) => void;
  /** Change set awaiting per-hunk review (B.3, flag changeSets). */
  pendingChangeSet: ChangeSet | null;
  resolveChangeSet: (hunks: Hunk[] | null) => void;
  /** Proposed ATLAS.md additions awaiting approval (B.1). */
  pendingAtlasMd: { additions: string } | null;
  resolveAtlasMd: (text: string | null) => void;
  /** Aggregate spend for the current run (status line). */
  runCostUsd: number;
  runTokens: number;
  /** Abort the run when spend exceeds this (0 = no ceiling). Persisted. */
  costCeilingUsd: number;
  setCostCeiling: (v: number) => void;

  // ── Steering & interruptibility (A.6) ─────────────────────────────────────
  /** Queue a user message into the running agent at the next loop boundary. */
  queueSteering: (text: string) => void;
  paused: boolean;
  setPaused: (v: boolean) => void;
  /** Finish the current todo, then stop gracefully. */
  stopAfterStep: boolean;
  setStopAfterStep: (v: boolean) => void;

  /** Saved agent sessions (conversation + history; not files). */
  sessionId: string | null;
  sessions: CodeSessionMeta[];
  openSession: (id: string) => Promise<void>;
  renameSession: (id: string, name: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;

  /** URL of a dev server running inside the WebContainer, when one is up. */
  previewUrl: string | null;
  dismissPreview: () => void;

  boot: () => Promise<void>;
  refreshTree: () => Promise<void>;
  selectFile: (path: string) => Promise<void>;
  setBuffer: (v: string) => void;
  saveActiveFile: () => Promise<void>;

  runTask: (goal: string, keyHeaders: Record<string, string>) => Promise<void>;
  stop: () => void;
  clearConversation: () => void;

  runManualCommand: (cmd: string) => Promise<void>;
  clearTerminal: () => void;

  /** A.4 /handoff: seed a fresh session with a resume brief; returns it. */
  handoff: () => string;

  /** C.4: seed workspace from a chat escalation payload and auto-start agent. */
  ingestEscalation: (payload: import("@/lib/chat/escalate").EscalationPayload, keyHeaders: Record<string, string>) => Promise<void>;

  revertChange: (id: string) => Promise<void>;
  snapshot: (label: string) => Promise<void>;
  restoreCheckpoint: (id: string) => Promise<void>;
}

// Module-level (non-reactive) plumbing.
let ws: Workspace | null = null;
let abortCtrl: AbortController | null = null;
let approvalResolve: ((ok: boolean) => void) | null = null;
let clarifyResolve: ((answer: string | null) => void) | null = null;
let todosResolve: ((todos: Todo[] | null) => void) | null = null;
let changeSetResolve: ((hunks: Hunk[] | null) => void) | null = null;
let atlasMdResolve: ((text: string | null) => void) | null = null;
// A.6 steering: messages queued mid-run, drained at the next loop boundary.
let steeringBuf: string[] = [];
// A.6 pause gate: resolvers released on resume.
let pauseWaiters: (() => void)[] = [];
// Cost-ceiling breach is announced once per run.
let ceilingTripped = false;

/**
 * The booted workspace lives on globalThis (it survives Fast Refresh), but
 * this module's `ws` binding does not — after HMR it resets to null while the
 * zustand state still says "ready". Always re-acquire through the singleton.
 */
async function ensureWs(): Promise<Workspace | null> {
  if (ws) return ws;
  if (!globalThis.__atlasWorkspace) return null; // never booted
  ws = (await getWorkspace()).workspace;
  return ws;
}

// Streaming text deltas coalesce here and flush into state at ~20fps.
const pending = new Map<string, { text: string; reasoning: string }>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// Terminal chunks batch the same way (npm output can be a firehose).
let termBuf = "";
let termTimer: ReturnType<typeof setTimeout> | null = null;

function recomputeChanged(changes: ChangeRecord[]): Record<string, "new" | "modified"> {
  const map: Record<string, "new" | "modified"> = {};
  for (const c of changes) {
    if (c.after === null) {
      delete map[c.path];
      continue;
    }
    // First-ever record for a path decides "new" vs "modified".
    if (!(c.path in map)) map[c.path] = c.before === null ? "new" : "modified";
  }
  return map;
}

/** Resolve once zustand's persist middleware has rehydrated from storage. */
function afterHydration(): Promise<void> {
  return new Promise((resolve) => {
    const p = (useCodeStore as any).persist;
    if (!p?.hasHydrated || p.hasHydrated()) return resolve();
    const un = p.onFinishHydration(() => {
      un?.();
      resolve();
    });
  });
}

export const useCodeStore = create<CodeState>()(
  persist(
    (set, get) => {
      /** Every trace mutation goes through here so `events` stays in lockstep. */
      const setTrace = (updater: (t: TraceEvent[]) => TraceEvent[]) =>
        set((s) => {
          const trace = updater(s.trace);
          if (trace === s.trace) return {};
          return { trace, events: projectUiEvents(trace) };
        });
      const pushTrace = (input: TraceInput) => setTrace((t) => appendTrace(t, input));

      const flushPending = () => {
        flushTimer = null;
        if (pending.size === 0) return;
        setTrace((t) =>
          t.map((e) => {
            if (e.kind !== "assistant") return e;
            const p = pending.get(e.id);
            return p ? { ...e, text: p.text, reasoning: p.reasoning } : e;
          }),
        );
      };
      const scheduleFlush = () => {
        if (flushTimer == null) flushTimer = setTimeout(flushPending, 48);
      };

      const appendTerminal = (text: string) => {
        termBuf += text;
        if (termTimer == null)
          termTimer = setTimeout(() => {
            termTimer = null;
            const chunk = termBuf;
            termBuf = "";
            if (!chunk) return;
            const lines: TermLine[] = chunk
              .split("\n")
              .filter((l, i, arr) => l.trim() !== "" || i < arr.length - 1)
              .map((text) => ({
                text,
                tone: text.startsWith("$ ") || text.startsWith(">>> ") ? ("cmd" as const) : undefined,
              }));
            set((s) => ({ terminal: [...s.terminal, ...lines].slice(-500) }));
          }, 80);
      };

      const systemNote = (text: string, tone: "info" | "error" = "info") =>
        pushTrace({ kind: "system", id: uid(), text, tone });

      /** Save the current conversation as a session (upsert; names stick). */
      const persistSession = async () => {
        const { trace, events, history, modelId, mode, sessions } = get();
        if (trace.length === 0) return;
        let id = get().sessionId;
        if (!id) {
          id = uid();
          set({ sessionId: id });
        }
        const existing = sessions.find((s) => s.id === id);
        const firstUser = events.find((e) => e.kind === "user") as
          | Extract<UiEvent, { kind: "user" }>
          | undefined;
        const meta: CodeSessionMeta = {
          id,
          name: existing?.name ?? (firstUser?.text.slice(0, 48) || "Session"),
          modelId,
          mode,
          createdAt: existing?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
        };
        try {
          await codeSessionsRepo().save(meta, { events, history, trace });
          set((s) => ({ sessions: [meta, ...s.sessions.filter((x) => x.id !== id)] }));
        } catch (e) {
          console.warn("[code] session save failed", e);
        }
      };

      return {
        status: "idle",
        bootNote: "",
        wsKind: null,
        trace: [],
        events: [],
        running: false,
        history: [],
        paths: [],
        changedMap: {},
        activePath: null,
        buffer: "",
        savedBuffer: "",
        terminal: [],
        changes: [],
        checkpoints: [],
        modelId: "",
        setModelId: (id) => set({ modelId: id }),

        mode: "agent",
        setMode: (m) => set({ mode: m }),
        pendingPlan: null,

        toolPolicy: DEFAULT_POLICY,
        setToolDecision: (tool, d) =>
          set((s) => ({ toolPolicy: { ...s.toolPolicy, [tool]: d } })),
        hooks: DEFAULT_HOOKS,
        setHooks: (hooks) => set({ hooks }),

        task: null,
        pendingClarify: null,
        pendingTodos: null,
        pendingChangeSet: null,
        pendingAtlasMd: null,
        resolveChangeSet(hunks) {
          changeSetResolve?.(hunks);
        },
        resolveAtlasMd(text) {
          atlasMdResolve?.(text);
        },
        runCostUsd: 0,
        runTokens: 0,
        costCeilingUsd: 0,
        setCostCeiling: (v) => set({ costCeilingUsd: Math.max(0, v) }),

        queueSteering(text) {
          const clean = text.trim();
          if (!clean || !get().running) return;
          steeringBuf.push(clean);
          pushTrace({ kind: "steering", id: uid(), text: clean });
        },

        paused: false,
        setPaused(v) {
          set({ paused: v });
          if (!v) {
            for (const release of pauseWaiters.splice(0)) release();
          }
        },

        stopAfterStep: false,
        setStopAfterStep: (v) => set({ stopAfterStep: v }),

        pendingApproval: null,
        resolveApproval(allow, always) {
          const pa = get().pendingApproval;
          if (!pa) return;
          if (allow && always)
            set((s) => ({ toolPolicy: { ...s.toolPolicy, [pa.name]: "allow" } }));
          set({ pendingApproval: null });
          approvalResolve?.(allow);
          approvalResolve = null;
        },

        sessionId: null,
        sessions: [],

        async openSession(id) {
          if (get().running) return;
          const loaded = await codeSessionsRepo()
            .load(id)
            .catch(() => null);
          if (!loaded) return;
          // Pre-v2 sessions have no trace — lift their events into one.
          const trace = loaded.state.trace ?? liftUiEventsToTrace(loaded.state.events);
          set({
            sessionId: id,
            trace,
            events: projectUiEvents(trace),
            history: loaded.state.history,
            mode: loaded.meta.mode === "plan" ? "plan" : "agent",
            pendingPlan: null,
            pendingApproval: null,
          });
          if (loaded.meta.modelId && getModelById(loaded.meta.modelId))
            set({ modelId: loaded.meta.modelId });
        },

        async renameSession(id, name) {
          const clean = name.trim();
          if (!clean) return;
          set((s) => ({
            sessions: s.sessions.map((m) => (m.id === id ? { ...m, name: clean } : m)),
          }));
          await codeSessionsRepo().rename(id, clean).catch(() => {});
        },

        async deleteSession(id) {
          set((s) => ({
            sessions: s.sessions.filter((m) => m.id !== id),
            // Deleting the active session detaches it; the on-screen
            // conversation stays and re-saves as a new session on next run.
            ...(s.sessionId === id ? { sessionId: null } : {}),
          }));
          await codeSessionsRepo().remove(id).catch(() => {});
        },

        previewUrl: null,
        dismissPreview: () => set({ previewUrl: null }),

        async boot() {
          if (get().status === "booting" || get().status === "ready" || get().status === "fallback")
            return;
          set({ status: "booting" });
          try {
            const { workspace, note } = await getWorkspace();
            ws = workspace;
            workspace.onServerReady((port, url) => {
              set({ previewUrl: url });
              appendTerminal(`[server ready on port ${port}] ${url}\n`);
              systemNote(`Dev server ready on port ${port} — preview available.`);
            });
            set({
              status: workspace.kind === "webcontainer" ? "ready" : "fallback",
              bootNote: note,
              wsKind: workspace.kind,
            });
            await get().refreshTree();
            const first = get().paths.includes("README.md")
              ? "README.md"
              : get().paths[0];
            if (first && !get().activePath) await get().selectFile(first);

            // Restore the last session + the saved-sessions index.
            await afterHydration();
            try {
              const repo = codeSessionsRepo();
              const [list, sid] = [await repo.list(), get().sessionId];
              set({ sessions: list });
              if (sid && get().trace.length === 0) {
                const loaded = await repo.load(sid);
                if (loaded) {
                  const trace =
                    loaded.state.trace ?? liftUiEventsToTrace(loaded.state.events);
                  set({
                    trace,
                    events: projectUiEvents(trace),
                    history: loaded.state.history,
                  });
                } else set({ sessionId: null });
              }
            } catch (e) {
              console.warn("[code] session restore failed", e);
            }
          } catch (e) {
            set({ status: "error", bootNote: (e as Error).message });
          }
        },

        async refreshTree() {
          const w = await ensureWs();
          if (!w) return;
          const files = await w.listFiles();
          set({ paths: files.map((f) => f.path) });
        },

        async selectFile(path) {
          const w = await ensureWs();
          if (!w) return;
          try {
            const content = isTextPath(path) ? await w.readFile(path) : "(binary file)";
            set({ activePath: path, buffer: content, savedBuffer: content });
          } catch (e) {
            set({
              activePath: path,
              buffer: `// failed to read ${path}: ${(e as Error).message}`,
              savedBuffer: "",
            });
          }
        },

        setBuffer(v) {
          set({ buffer: v });
        },

        async saveActiveFile() {
          const { activePath, buffer, savedBuffer } = get();
          const w = await ensureWs();
          if (!w || !activePath || buffer === savedBuffer) return;
          await w.writeFile(activePath, buffer);
          const change: ChangeRecord = {
            id: uid(),
            path: activePath,
            before: savedBuffer,
            after: buffer,
            tool: "editor",
            ts: Date.now(),
          };
          set((s) => {
            const changes = [...s.changes, change];
            return { savedBuffer: buffer, changes, changedMap: recomputeChanged(changes) };
          });
        },

        async runTask(rawGoal, keyHeaders) {
          const w = await ensureWs();
          if (!w || get().running || !rawGoal.trim()) return;
          const modelId = get().modelId;
          if (!modelId) return;
          const mode = get().mode;

          // B.4 task templates: expand a /slash command into a tuned goal.
          const tmpl = isEnabled("taskLoop") ? matchTemplateInput(rawGoal) : null;
          const goal = tmpl ? expandTemplate(tmpl.template, tmpl.arg) : rawGoal;

          // A new message supersedes an unapproved plan.
          if (get().pendingPlan) set({ pendingPlan: null });

          // ATLAS.md = persistent project memory, injected every run.
          const projectMemory = await w.readFile("ATLAS.md").catch(() => null);

          // Role registry: built-ins + user-defined .atlas/agents/*.md (A.5).
          let roles: Record<string, AgentRole> = mergeRoles([]);
          try {
            const agentFiles = (await w.listFiles())
              .map((f) => f.path)
              .filter((p) => p.startsWith(".atlas/agents/") && p.endsWith(".md"));
            const loaded = await Promise.all(
              agentFiles.map(async (path) => ({
                path,
                content: await w.readFile(path).catch(() => ""),
              })),
            );
            roles = mergeRoles(loaded.filter((f) => f.content));
          } catch {
            /* role loading is best-effort */
          }

          steeringBuf = [];
          ceilingTripped = false;
          set({
            running: true,
            runCostUsd: 0,
            runTokens: 0,
            task: null,
            paused: false,
            stopAfterStep: false,
          });
          // Show what the user typed (the raw slash command), run the expanded goal.
          pushTrace({ kind: "user", id: uid(), text: rawGoal });
          abortCtrl = new AbortController();

          /** Shared runAgent event wiring (streaming, tools, changes, cost). */
          const makeOnEvent =
            (onDone: (summary: string) => void, onError: () => void) =>
            (ev: AgentUiEvent) => {
              switch (ev.type) {
                case "assistant_start":
                  pending.set(ev.id, { text: "", reasoning: "" });
                  pushTrace({
                    kind: "assistant",
                    id: ev.id,
                    text: "",
                    reasoning: "",
                    streaming: true,
                  });
                  break;
                case "text": {
                  const p = pending.get(ev.id);
                  if (p) p.text += ev.delta;
                  scheduleFlush();
                  break;
                }
                case "reasoning": {
                  const p = pending.get(ev.id);
                  if (p) p.reasoning += ev.delta;
                  scheduleFlush();
                  break;
                }
                case "assistant_done": {
                  const p = pending.get(ev.id);
                  pending.delete(ev.id);
                  // The trace keeps empty tool-call-only turns (source of
                  // truth); projectUiEvents applies the pre-v2 display rule
                  // that hides them.
                  setTrace((t) =>
                    patchTraceEvent(t, ev.id, (e) =>
                      e.kind === "assistant"
                        ? {
                            ...e,
                            text: p?.text ?? e.text,
                            reasoning: p?.reasoning ?? e.reasoning,
                            streaming: false,
                            promptTokens: ev.promptTokens,
                            completionTokens: ev.completionTokens,
                          }
                        : e,
                    ),
                  );
                  // Live aggregate spend for the status line / report card.
                  if (ev.promptTokens || ev.completionTokens) {
                    set((s) => ({
                      runTokens:
                        s.runTokens + (ev.promptTokens ?? 0) + (ev.completionTokens ?? 0),
                      runCostUsd:
                        s.runCostUsd +
                        messageCostUsd(get().modelId, ev.promptTokens, ev.completionTokens),
                    }));
                    // Cost guard (A.5): breach the ceiling ⇒ abort the run.
                    const ceiling = get().costCeilingUsd;
                    if (ceiling > 0 && get().runCostUsd > ceiling && !ceilingTripped) {
                      ceilingTripped = true;
                      systemNote(
                        `Cost ceiling $${ceiling.toFixed(2)} exceeded (spent $${get().runCostUsd.toFixed(4)}) — stopping the run.`,
                        "error",
                      );
                      abortCtrl?.abort();
                    }
                  }
                  break;
                }
                case "tool_start":
                  pushTrace({
                    kind: "tool",
                    id: ev.id,
                    name: ev.name,
                    args: ev.args,
                    status: "running",
                  });
                  break;
                case "tool_progress":
                  setTrace((t) =>
                    patchTraceEvent(t, ev.id, (e) =>
                      e.kind === "tool" ? { ...e, display: ev.note } : e,
                    ),
                  );
                  break;
                case "tool_done":
                  setTrace((t) =>
                    patchTraceEvent(t, ev.id, (e) =>
                      e.kind === "tool"
                        ? {
                            ...e,
                            result: ev.result,
                            status: ev.isError ? "error" : "done",
                            display: ev.display,
                            change: ev.change,
                          }
                        : e,
                    ),
                  );
                  if (ev.change) {
                    set((s) => {
                      const changes = [...s.changes, ev.change!];
                      return { changes, changedMap: recomputeChanged(changes) };
                    });
                    // Refresh tree + open editor buffer after FS mutations.
                    get().refreshTree();
                    const { activePath } = get();
                    if (ev.change.path === activePath && ev.change.after !== null) {
                      set({ buffer: ev.change.after, savedBuffer: ev.change.after });
                    } else if (ev.change.after !== null) {
                      get().selectFile(ev.change.path);
                    }
                  }
                  break;
                case "done":
                  onDone(ev.summary ?? "");
                  break;
                case "error":
                  pushTrace({
                    kind: "system",
                    id: uid(),
                    text: ev.message,
                    tone: ev.code === "aborted" ? "info" : "error",
                  });
                  if (ev.code !== "aborted") onError();
                  break;
              }
            };

          /** One phase-scoped agent run — the TaskPorts.agent implementation. */
          const agentPort = async (run: AgentPhaseRun): Promise<AgentPhaseResult> => {
            let summary = "";
            let ok = true;

            // A.4 auto-compaction: when the session history nears ~70% of the
            // model's context window, summarize consumed exchanges into terse
            // references and keep the plan verbatim.
            let baseHistory = (run.history as RouterMsg[] | undefined) ?? get().history;
            if (run.history === undefined) {
              const ctxWindow = getModelById(get().modelId)?.contextWindow ?? 128_000;
              if (estimateTokens(baseHistory) > ctxWindow * 0.7) {
                const t = get().task;
                const res = compactHistory(baseHistory, {
                  factBlock: t ? taskFactBlock(t) : undefined,
                });
                if (res.compacted) {
                  baseHistory = res.history;
                  set({ history: res.history });
                  pushTrace({
                    kind: "compaction",
                    id: uid(),
                    beforeTokens: res.beforeTokens,
                    afterTokens: res.afterTokens,
                    note: "auto-compacted near context budget",
                  });
                }
              }
            }

            const history = await runAgent({
              goal: run.goal,
              history: baseHistory,
              modelId: get().modelId,
              workspace: w,
              keyHeaders,
              signal: abortCtrl!.signal,
              onTerminal: appendTerminal,
              mode: run.readonly ? "plan" : "execute",
              policy: get().toolPolicy,
              hooks: get().hooks,
              projectMemory,
              systemPromptOverride: run.systemPrompt,
              extraTools: run.extraTools,
              onCustomTool: run.onCustomTool,
              maxIterations: run.maxIterations,
              roles,
              // A.6: queued user messages join at the next model iteration.
              injectMessages: run.readonly
                ? undefined
                : () =>
                    steeringBuf
                      .splice(0)
                      .map((text) => ({
                        role: "user" as const,
                        content: `[User update mid-run — take into account]: ${text}`,
                      })),
              requestApproval: (name, args) =>
                new Promise<boolean>((resolve) => {
                  approvalResolve = resolve;
                  set({ pendingApproval: { name, args } });
                }),
              onEvent: makeOnEvent(
                (s) => (summary = s),
                () => (ok = false),
              ),
            });
            // Session continuity: runs on the session history persist it back.
            if (run.history === undefined) set({ history });
            return { summary, ok };
          };

          try {
            if (!isEnabled("taskLoop")) {
              // ── Legacy single-call path (pre-v2 behavior, unchanged) ──────
              if (mode === "agent") await get().snapshot(goal.slice(0, 60));
              const res = await agentPort({
                goal,
                phase: mode === "plan" ? "plan" : "execute",
                readonly: mode === "plan",
              });
              if (mode === "plan" && res.summary.trim())
                set({ pendingPlan: { goal, text: res.summary } });
            } else {
              // ── Task Loop (Depth v2 A.1) ──────────────────────────────────
              await get().snapshot(goal.slice(0, 60));
              const ports: TaskPorts = {
                agent: agentPort,
                llm: async (system, user, maxTokens = 600) => {
                  let text = "";
                  for await (const ev of postSSE<any>(
                    "/api/v1/router/chat",
                    {
                      modelId: get().modelId,
                      messages: [
                        { role: "system", content: system },
                        { role: "user", content: user },
                      ],
                      temperature: 0,
                      maxTokens,
                    },
                    abortCtrl!.signal,
                    keyHeaders,
                  )) {
                    if (ev.type === "delta") text += ev.text;
                    else if (ev.type === "usage")
                      set((s) => ({
                        runTokens:
                          s.runTokens + (ev.promptTokens ?? 0) + (ev.completionTokens ?? 0),
                        runCostUsd:
                          s.runCostUsd +
                          messageCostUsd(get().modelId, ev.promptTokens, ev.completionTokens),
                      }));
                  }
                  return text;
                },
                exec: async (cmd, timeoutMs) => {
                  appendTerminal(`$ ${cmd}\n`);
                  return w.exec(cmd, appendTerminal, timeoutMs);
                },
                readFile: (p) => w.readFile(p).catch(() => null),
                listPaths: async () => (await w.listFiles()).map((f) => f.path),
                changes: () =>
                  get().changes.map((c) => ({ path: c.path, before: c.before, after: c.after })),
                changeCount: () => get().changes.length,
                changesSince: (marker) => get().changes.slice(marker),
                lastCheckpointId: () => get().checkpoints[0]?.id ?? null,
                reviewChangeSet: isEnabled("changeSets")
                  ? (records, label, checkpointId, todoId) =>
                      new Promise<void>((resolve) => {
                        const cs = buildChangeSet(uid(), uid(), checkpointId, label, records, todoId);
                        if (cs.hunks.length === 0) {
                          resolve();
                          return;
                        }
                        pushTrace({
                          kind: "changeset",
                          id: uid(),
                          changeSetId: cs.id,
                          label,
                          status: "staged",
                        });
                        changeSetResolve = async (hunks) => {
                          changeSetResolve = null;
                          set({ pendingChangeSet: null });
                          try {
                            if (hunks === null) {
                              // Revert all → restore the pre-todo checkpoint.
                              if (checkpointId) await get().restoreCheckpoint(checkpointId);
                              pushTrace({
                                kind: "changeset",
                                id: uid(),
                                changeSetId: cs.id,
                                label,
                                status: "reverted",
                              });
                            } else if (hunks.some((h) => !h.accepted)) {
                              // Reverse-patch rejected hunks per file.
                              const byPath = new Map<string, Hunk[]>();
                              for (const h of hunks) {
                                const list = byPath.get(h.path) ?? [];
                                list.push(h);
                                byPath.set(h.path, list);
                              }
                              for (const [path, fileHunks] of byPath) {
                                if (fileHunks.every((h) => h.accepted)) continue;
                                const current = await w.readFile(path).catch(() => null);
                                if (current === null) continue;
                                const next = applyHunkDecisions(current, fileHunks);
                                if (next !== current) await w.writeFile(path, next);
                              }
                              await get().refreshTree();
                              pushTrace({
                                kind: "changeset",
                                id: uid(),
                                changeSetId: cs.id,
                                label,
                                status: "applied",
                              });
                            } else {
                              pushTrace({
                                kind: "changeset",
                                id: uid(),
                                changeSetId: cs.id,
                                label,
                                status: "applied",
                              });
                            }
                          } finally {
                            resolve();
                          }
                        };
                        set({ pendingChangeSet: cs });
                      })
                  : undefined,
                proposeAtlasMd: isEnabled("atlasMdLearning")
                  ? async (summary) => {
                      // A focused read-only call drafts ≤5 lines of conventions.
                      const existing = (await w.readFile("ATLAS.md").catch(() => "")) || "";
                      const draft = await (async () => {
                        let text = "";
                        for await (const ev of postSSE<any>(
                          "/api/v1/router/chat",
                          {
                            modelId: get().modelId,
                            messages: [
                              {
                                role: "system",
                                content:
                                  "You maintain ATLAS.md, a project's durable memory. Given a task summary and the current ATLAS.md, propose AT MOST 5 lines of NEW durable conventions worth remembering (build/test commands, structure, gotchas). Output ONLY the lines to append (markdown bullets), or exactly 'NONE' if nothing durable was learned. Never repeat what ATLAS.md already says.",
                              },
                              {
                                role: "user",
                                content: `Task summary:\n${summary}\n\nCurrent ATLAS.md:\n${existing.slice(0, 4000) || "(empty)"}`,
                              },
                            ],
                            temperature: 0,
                            maxTokens: 300,
                          },
                          abortCtrl!.signal,
                          keyHeaders,
                        )) {
                          if (ev.type === "delta") text += ev.text;
                        }
                        return text.trim();
                      })();
                      if (!draft || /^none$/i.test(draft)) return false;
                      return new Promise<boolean>((resolve) => {
                        atlasMdResolve = async (edited) => {
                          atlasMdResolve = null;
                          set({ pendingAtlasMd: null });
                          if (edited?.trim()) {
                            const next =
                              existing.trim()
                                ? `${existing.trim()}\n${edited.trim()}\n`
                                : `# ATLAS.md — project memory\n\n${edited.trim()}\n`;
                            await w.writeFile("ATLAS.md", next).catch(() => {});
                            await get().refreshTree();
                            systemNote("Saved durable conventions to ATLAS.md.");
                            resolve(true);
                          } else {
                            resolve(false);
                          }
                        };
                        set({ pendingAtlasMd: { additions: draft } });
                      });
                    }
                  : undefined,
                snapshot: (label) => get().snapshot(label),
                trace: (input) => pushTrace(input),
                // Ask-mode plan approval only when the user chose plan mode.
                approvePlan:
                  mode === "plan"
                    ? (todos) =>
                        new Promise<Todo[] | null>((resolve) => {
                          todosResolve = (v) => {
                            todosResolve = null;
                            set({ pendingTodos: null });
                            resolve(v);
                          };
                          set({ pendingTodos: todos });
                        })
                    : undefined,
                clarify: (questions) =>
                  new Promise<string | null>((resolve) => {
                    clarifyResolve = (v) => {
                      clarifyResolve = null;
                      set({ pendingClarify: null });
                      resolve(v);
                    };
                    set({ pendingClarify: { questions } });
                  }),
                smoke: async () => {
                  const url = get().previewUrl;
                  if (!url) return null;
                  const started = Date.now();
                  const res = await w.exec(
                    `node -e "fetch('${url}').then(r=>{console.log('HTTP',r.status);process.exit(r.ok?0:1)}).catch(e=>{console.error(String(e));process.exit(1)})"`,
                    undefined,
                    20_000,
                  );
                  return {
                    check: "smoke",
                    command: `GET ${url}`,
                    pass: !res.timedOut && res.code === 0,
                    evidence: res.output.slice(-500).trim() || "(no output)",
                    durationMs: Date.now() - started,
                    ts: started,
                  };
                },
                usage: () => ({ costUsd: get().runCostUsd, tokens: get().runTokens }),
                drainSteering: () => steeringBuf.splice(0),
                gate: () =>
                  get().paused
                    ? new Promise<void>((resolve) => pauseWaiters.push(resolve))
                    : Promise.resolve(),
                shouldStopAfterStep: () => {
                  if (!get().stopAfterStep) return false;
                  set({ stopAfterStep: false });
                  return true;
                },
                hasCheckpoints: () => get().checkpoints.length > 0,
                uid,
              };
              await runTaskLoop({
                taskId: uid(),
                goal,
                ports,
                signal: abortCtrl.signal,
                onState: (t) => set({ task: t }),
              });
            }
          } finally {
            if (flushTimer != null) {
              clearTimeout(flushTimer);
              flushPending();
            }
            set({
              running: false,
              pendingApproval: null,
              pendingClarify: null,
              pendingTodos: null,
              pendingChangeSet: null,
              pendingAtlasMd: null,
            });
            approvalResolve = null;
            clarifyResolve = null;
            todosResolve = null;
            changeSetResolve = null;
            atlasMdResolve = null;
            abortCtrl = null;
            await persistSession();
          }
        },

        resolveClarify(answer) {
          clarifyResolve?.(answer);
        },

        resolveTodos(todos) {
          todosResolve?.(todos);
        },

        async approvePlan(keyHeaders) {
          const plan = get().pendingPlan;
          if (!plan || get().running) return;
          // Approval flips to execute mode — the plan is already in history,
          // so the agent picks it up from conversation context.
          set({ pendingPlan: null, mode: "agent" });
          await get().runTask(
            "The plan is approved. Execute it now, step by step, verifying as you go.",
            keyHeaders,
          );
        },

        discardPlan() {
          if (!get().pendingPlan) return;
          set({ pendingPlan: null });
          systemNote("Plan discarded. Refine the goal and plan again, or switch to Agent mode.");
        },

        stop() {
          // Unblock paused gates first so the loop can observe the abort.
          if (approvalResolve) {
            approvalResolve(false);
            approvalResolve = null;
          }
          clarifyResolve?.(null);
          todosResolve?.(null);
          changeSetResolve?.(null);
          atlasMdResolve?.(null);
          // Release a paused loop so it can observe the abort.
          for (const release of pauseWaiters.splice(0)) release();
          set({
            pendingApproval: null,
            pendingClarify: null,
            pendingTodos: null,
            pendingChangeSet: null,
            pendingAtlasMd: null,
            paused: false,
          });
          abortCtrl?.abort();
          ws?.killActive();
          set({ running: false });
        },

        clearConversation() {
          // Start fresh: the previous session stays saved and listed.
          set({
            trace: [],
            events: [],
            history: [],
            sessionId: null,
            pendingPlan: null,
            task: null,
          });
        },

        handoff() {
          // A.4 /handoff: emit a resume-brief and start a fresh session seeded
          // with it, so a new context (or another model) continues cleanly.
          const { task, changes, runCostUsd } = get();
          const brief = buildHandoffBrief(task, {
            changedFiles: [...new Set(changes.map((c) => c.path))],
            costUsd: runCostUsd || undefined,
          });
          get().clearConversation();
          set({
            history: [
              {
                role: "user",
                content: `Resume from this handoff brief (produced by the previous session):\n\n${brief}`,
              },
              {
                role: "assistant",
                content:
                  "Understood — I have the handoff brief and will continue from that state.",
              },
            ] as RouterMsg[],
          });
          systemNote("Session handed off — resume brief seeded into a fresh session.");
          return brief;
        },

        async ingestEscalation(payload, keyHeaders) {
          const w = await ensureWs();
          if (!w) return;
          for (const art of payload.artifacts) {
            await w.writeFile(art.filename, art.content).catch(() => {});
          }
          for (const att of payload.attachments) {
            if (att.text) await w.writeFile(att.name, att.text).catch(() => {});
          }
          await get().refreshTree();
          const goal = [
            payload.brief,
            payload.conversationSummary ? `\n\nConversation context:\n${payload.conversationSummary}` : "",
          ].join("");
          systemNote(`Escalated from Chat — ${payload.artifacts.length} artifact(s) seeded.`);
          await get().runTask(goal, keyHeaders);
        },

        async runManualCommand(cmd) {
          const w = await ensureWs();
          if (!w || !cmd.trim()) return;
          appendTerminal(`$ ${cmd}\n`);
          const res = await w.exec(cmd, appendTerminal, MANUAL_CMD_TIMEOUT);
          appendTerminal(
            res.timedOut
              ? `[timed out]\n`
              : res.code !== 0
                ? `[exit ${res.code}]\n`
                : "",
          );
          await get().refreshTree();
          const { activePath } = get();
          if (activePath) {
            // A command may have rewritten the open file (e.g. a formatter).
            try {
              const content = await w.readFile(activePath);
              if (content !== get().savedBuffer)
                set({ buffer: content, savedBuffer: content });
            } catch {
              /* file may have been deleted */
            }
          }
        },

        clearTerminal() {
          set({ terminal: [] });
        },

        async revertChange(id) {
          const w = await ensureWs();
          if (!w) return;
          const change = get().changes.find((c) => c.id === id);
          if (!change) return;
          if (change.before === null) await w.deleteFile(change.path).catch(() => {});
          else await w.writeFile(change.path, change.before);
          set((s) => {
            const changes = s.changes.filter((c) => c.id !== id);
            return { changes, changedMap: recomputeChanged(changes) };
          });
          await get().refreshTree();
          if (get().activePath === change.path) {
            if (change.before === null) set({ activePath: null, buffer: "", savedBuffer: "" });
            else set({ buffer: change.before, savedBuffer: change.before });
          }
        },

        async snapshot(label) {
          const w = await ensureWs();
          if (!w) return;
          const entries = await w.listFiles();
          const files: Record<string, string> = {};
          for (const e of entries) {
            if (!isTextPath(e.path) || e.size > MAX_SNAPSHOT_FILE) continue;
            try {
              files[e.path] = await w.readFile(e.path);
            } catch {
              /* skip unreadable */
            }
          }
          const cp: Checkpoint = { id: uid(), label: label || "checkpoint", ts: Date.now(), files };
          set((s) => ({ checkpoints: [cp, ...s.checkpoints].slice(0, MAX_CHECKPOINTS) }));
        },

        async restoreCheckpoint(id) {
          // Note: callable during a task-loop run (change-set revert-all fires
          // at a safe loop boundary). The UI restore button is separately
          // disabled while running.
          const w = await ensureWs();
          if (!w) return;
          const cp = get().checkpoints.find((c) => c.id === id);
          if (!cp) return;
          const current = await w.listFiles();
          for (const e of current) {
            if (!(e.path in cp.files) && isTextPath(e.path)) {
              await w.deleteFile(e.path).catch(() => {});
            }
          }
          for (const [path, content] of Object.entries(cp.files)) {
            await w.writeFile(path, content);
          }
          set({ changes: [], changedMap: {} });
          systemNote(`Workspace restored to checkpoint "${cp.label}"`);
          await get().refreshTree();
          const { activePath } = get();
          if (activePath) {
            if (cp.files[activePath] !== undefined) {
              set({ buffer: cp.files[activePath], savedBuffer: cp.files[activePath] });
            } else {
              set({ activePath: null, buffer: "", savedBuffer: "" });
            }
          }
        },
      };
    },
    {
      name: "atlas-code",
      partialize: (s) => ({
        modelId: s.modelId,
        mode: s.mode,
        toolPolicy: s.toolPolicy,
        hooks: s.hooks,
        sessionId: s.sessionId,
        costCeilingUsd: s.costCeilingUsd,
      }),
    },
  ),
);
