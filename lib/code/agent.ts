"use client";

// The real Atlas Code agent loop (§6): stream a completion from the Atlas
// Router with the workspace tool belt attached; when the model requests tool
// calls, execute them browser-side against the workspace and feed the results
// back; repeat until the model answers in plain text (or we hit the iteration
// cap). The UI observes progress through a flat event callback.
//
// Phase 6 additions:
//  - mode "plan": read-only toolset + a prompt that ends in a markdown plan;
//    the caller shows it for approval before an execute run.
//  - spawn_subagent: a nested read-only agent run (depth 1) whose summary is
//    fed back as the tool result — delegated exploration without filling the
//    main context.
//  - policy + hooks: every tool call is gated (allow/ask/deny + pre-hook
//    blocks) and can trigger post-hook commands whose output the model sees.
//  - projectMemory: ATLAS.md content injected into the system prompt.

import { postSSE, SSEHttpError } from "@/lib/sse-client";
import type { ChatMessage as RouterMsg, ToolCallRequest, ToolDef } from "@/lib/router";
import {
  executeTool,
  AGENT_TOOLS,
  READONLY_TOOLS,
  SUBAGENT_TOOL,
  type ChangeRecord,
  type ToolExecution,
} from "./tools";
import {
  policyFor,
  matchPreHook,
  matchPostHooks,
  type ToolPolicy,
  type Hook,
} from "./policy";
import type { Workspace } from "./workspace";
import type { AgentRole } from "@/lib/engine/orchestrator";

export const MAX_ITERATIONS = 12;
const PLAN_ITERATIONS = 8;
const SUBAGENT_ITERATIONS = 6;
const MAX_MEMORY_CHARS = 8_000;
const MAX_HOOK_OUTPUT = 2_000;

const EXECUTE_PROMPT = `You are Atlas Code, an autonomous coding agent working in a real browser-side workspace.

Runtime: Node.js 20 via WebContainer (jsh shell — node, npm, ls, cat all work; npm install works but is slow) and Python 3 via Pyodide (run_python).

Workflow:
1. Orient: list_files, then read_file the files relevant to the task.
2. Act: prefer edit_file for surgical changes (old_string must match the file exactly — read first). Use write_file for new files or full rewrites.
3. Verify: run the code or tests with run_command (e.g. "npm test", "node index.js") after changing anything, and fix what breaks.

Rules:
- Never guess file contents; read before editing.
- Keep changes minimal and consistent with the existing style.
- run_python is a separate sandbox: workspace files are synced in before each call, but files written there do NOT persist — persist results with write_file.
- For broad exploration ("understand the codebase", "find where X happens"), delegate to spawn_subagent instead of reading everything yourself.
- Long-running servers must be started in the background with & (e.g. "node server.js &") — foreground commands are killed after 60s.
- ATLAS.md is the project's persistent memory. When the user asks you to remember a convention or decision, add it to ATLAS.md (create it if missing).
- A tool call may be denied by the user or a policy hook — respect the refusal and adapt (ask, or take an allowed route). Do not retry the same denied call.
- When the task is complete, stop calling tools and reply with a short summary (2-4 sentences) of what changed and how you verified it.`;

const PLAN_PROMPT = `You are Atlas Code in PLAN MODE. Your job is to investigate the workspace and produce an implementation plan — you must NOT modify anything (your tools are read-only).

Workflow:
1. Investigate with list_files and read_file (delegate broad exploration to spawn_subagent).
2. When you understand the task, reply with the final plan and stop calling tools.

The plan must be markdown with:
- **Goal** — one sentence.
- **Steps** — numbered, each naming the exact file(s) to create/modify and what changes.
- **Verification** — the commands that prove it works (e.g. npm test).
- **Risks** — anything that could break, if relevant.

Keep it tight and concrete; the user will approve it and you will then execute exactly this plan.`;

const SUBAGENT_PROMPT = `You are a read-only research subagent inside the Atlas Code workspace. Investigate exactly what the task asks using list_files and read_file, then reply with a concise, information-dense report (facts, file paths, relevant code excerpts). You cannot modify anything. Do not ask questions — finish with your findings.`;

/** UI-facing events emitted while the agent works. */
export type AgentUiEvent =
  | { type: "assistant_start"; id: string }
  | { type: "text"; id: string; delta: string }
  | { type: "reasoning"; id: string; delta: string }
  | { type: "assistant_done"; id: string; promptTokens?: number; completionTokens?: number }
  | { type: "tool_start"; id: string; name: string; args: string }
  | { type: "tool_progress"; id: string; note: string }
  | {
      type: "tool_done";
      id: string;
      result: string;
      isError?: boolean;
      display?: string;
      change?: ChangeRecord;
    }
  | { type: "done"; summary?: string }
  | { type: "error"; message: string; code?: string };

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export interface AgentRunOptions {
  goal: string;
  /** Prior conversation (user/assistant/tool turns) for session continuity. */
  history: RouterMsg[];
  modelId: string;
  workspace: Workspace;
  keyHeaders: Record<string, string>;
  signal: AbortSignal;
  onEvent: (ev: AgentUiEvent) => void;
  onTerminal?: (text: string) => void;
  /** "plan" = read-only investigation ending in a plan. Default "execute". */
  mode?: "execute" | "plan";
  /** Per-tool allow/ask/deny. Missing tools default to allow. */
  policy?: ToolPolicy;
  hooks?: Hook[];
  /**
   * Called when policy says "ask". Resolve true to run the call, false to
   * refuse it. Absent ⇒ "ask" behaves like "deny".
   */
  requestApproval?: (name: string, args: string) => Promise<boolean>;
  /** ATLAS.md content, injected into the system prompt when present. */
  projectMemory?: string | null;
  /** 0 = main agent (default); 1 = subagent (read-only, no nesting). */
  depth?: number;
  maxIterations?: number;

  // ── Depth v2 seams (additive; absent ⇒ pre-v2 behavior) ──────────────────
  /** Replace the built-in phase prompt (ATLAS.md is still appended). */
  systemPromptOverride?: string;
  /** Extra tool definitions appended to the toolset (e.g. set_todos). */
  extraTools?: ToolDef[];
  /**
   * Handle a tool call before the workspace executor — return a result to
   * consume it (task-loop tools), or null to fall through to executeTool.
   */
  onCustomTool?: (name: string, argsJson: string) => Promise<ToolExecution | null>;
  /**
   * Polled at the top of every iteration; returned messages are appended to
   * the conversation — the steering seam (queued user input joins the run at
   * the next loop boundary instead of killing it).
   */
  injectMessages?: () => RouterMsg[];
  /** Role registry for spawn_subagent (built-ins + .atlas/agents/*.md). */
  roles?: Record<string, AgentRole>;
  /**
   * Internal: set on depth-1 runs for mutating roles (implementer/tester).
   * Default false — subagents stay read-only.
   */
  allowMutation?: boolean;
}

function systemPrompt(opts: AgentRunOptions): string {
  const base =
    opts.systemPromptOverride ??
    ((opts.depth ?? 0) > 0
      ? SUBAGENT_PROMPT
      : opts.mode === "plan"
        ? PLAN_PROMPT
        : EXECUTE_PROMPT);
  const mem = opts.projectMemory?.trim();
  if (!mem) return base;
  return `${base}\n\n## Project memory (ATLAS.md)\n${mem.slice(0, MAX_MEMORY_CHARS)}`;
}

function toolset(opts: AgentRunOptions): ToolDef[] {
  const depth = opts.depth ?? 0;
  // Subagents: read-only unless their role explicitly allows mutation
  // (implementer/tester). Never nested spawning.
  if (depth > 0) return opts.allowMutation ? AGENT_TOOLS : READONLY_TOOLS;
  const extra = opts.extraTools ?? [];
  const base = opts.mode === "plan" ? READONLY_TOOLS : AGENT_TOOLS;
  if (policyFor(opts.policy, "spawn_subagent") === "deny") return [...base, ...extra];
  return [...base, SUBAGENT_TOOL, ...extra];
}

/** Run one gated tool call (policy → pre-hooks → approval → execute → post-hooks). */
async function runToolCall(
  opts: AgentRunOptions,
  tc: { id: string; name: string; arguments: string },
): Promise<{ result: string; isError?: boolean; display?: string; change?: ChangeRecord }> {
  const { workspace, onTerminal } = opts;

  const decision = policyFor(opts.policy, tc.name);
  if (decision === "deny") {
    return {
      result: `Tool "${tc.name}" is disabled by the user's tool policy. Use another approach.`,
      isError: true,
      display: "denied by policy",
    };
  }

  const blocked = matchPreHook(opts.hooks, tc.name, tc.arguments);
  if (blocked) {
    return {
      result: `Blocked by a user hook (pattern /${blocked.pattern}/ on ${blocked.toolMatch}). Do not retry this exact call; choose a safer approach or ask the user.`,
      isError: true,
      display: "blocked by hook",
    };
  }

  if (decision === "ask") {
    const ok = (await opts.requestApproval?.(tc.name, tc.arguments)) ?? false;
    if (opts.signal.aborted) throw new DOMException("aborted", "AbortError");
    if (!ok) {
      return {
        result: `The user declined this ${tc.name} call. Do not retry it verbatim — adjust your approach or finish with what you have.`,
        isError: true,
        display: "declined by user",
      };
    }
  }

  // Custom (task-loop) tools run before the workspace executor.
  if (opts.onCustomTool) {
    const custom = await opts.onCustomTool(tc.name, tc.arguments);
    if (custom) return custom;
  }

  // Subagent: a nested role-scoped run whose summary is the tool result.
  if (tc.name === "spawn_subagent") {
    let task = "";
    let roleId = "";
    try {
      const args = JSON.parse(tc.arguments || "{}");
      task = String(args.task ?? "");
      roleId = String(args.role ?? "").trim();
    } catch {
      /* fall through to validation */
    }
    if (!task.trim())
      return { result: "spawn_subagent requires a 'task' string.", isError: true };

    // Resolve the role (A.5). Unknown/absent role ⇒ pre-v2 read-only default.
    const role = roleId ? opts.roles?.[roleId] : undefined;
    if (roleId && !role) {
      const known = Object.keys(opts.roles ?? {}).join(", ") || "explorer";
      return {
        result: `Unknown subagent role "${roleId}". Available roles: ${known}.`,
        isError: true,
      };
    }

    let toolsUsed = 0;
    let summary = "";
    const label = role ? role.name.toLowerCase() : "subagent";
    await runAgent({
      ...opts,
      goal: task,
      history: [],
      depth: (opts.depth ?? 0) + 1,
      maxIterations: role?.maxIterations ?? SUBAGENT_ITERATIONS,
      modelId: role?.modelId ?? opts.modelId,
      systemPromptOverride: role?.prompt,
      extraTools: undefined,
      onCustomTool: undefined,
      injectMessages: undefined,
      allowMutation: role ? !role.readonly : false,
      projectMemory: opts.projectMemory,
      onTerminal: role && !role.readonly ? opts.onTerminal : undefined,
      onEvent: (ev) => {
        if (ev.type === "tool_start") {
          toolsUsed++;
          opts.onEvent({
            type: "tool_progress",
            id: tc.id,
            note: `${label} · ${toolsUsed} tool${toolsUsed === 1 ? "" : "s"} · ${ev.name}`,
          });
        } else if (ev.type === "tool_done" && ev.change) {
          // Mutating roles: bubble FS changes so diffs/reverts keep working.
          opts.onEvent(ev);
        } else if (ev.type === "done") {
          summary = ev.summary ?? "";
        } else if (ev.type === "error") {
          summary = summary || `Subagent stopped: ${ev.message}`;
        }
      },
    });
    return {
      result: summary.trim() || "Subagent finished without a report.",
      display: `${label} · ${toolsUsed} tool${toolsUsed === 1 ? "" : "s"} used`,
    };
  }

  const res = await executeTool(workspace, tc.name, tc.arguments, onTerminal);

  // Post-hooks (main agent only): run configured commands and let the model
  // see their output alongside the tool result.
  if (!res.isError && (opts.depth ?? 0) === 0) {
    let extra = "";
    for (const h of matchPostHooks(opts.hooks, tc.name)) {
      if (opts.signal.aborted) throw new DOMException("aborted", "AbortError");
      onTerminal?.(`$ ${h.run}  [hook]\n`);
      const hookRes = await workspace.exec(h.run!, onTerminal);
      const status = hookRes.timedOut ? "timed out" : `exit ${hookRes.code}`;
      extra += `\n\n[hook "${h.run}" → ${status}]\n${hookRes.output.slice(-MAX_HOOK_OUTPUT).trim()}`;
    }
    if (extra) return { ...res, result: res.result + extra };
  }

  return res;
}

/**
 * Run one agent task to completion. Returns the updated conversation history
 * (WITHOUT the system prompt) so the next task keeps context.
 */
export async function runAgent(opts: AgentRunOptions): Promise<RouterMsg[]> {
  const { goal, modelId, keyHeaders, signal, onEvent } = opts;
  const cap =
    opts.maxIterations ?? (opts.mode === "plan" ? PLAN_ITERATIONS : MAX_ITERATIONS);
  const tools = toolset(opts);

  const history: RouterMsg[] = [...opts.history, { role: "user", content: goal }];
  const messages = (): RouterMsg[] => [
    { role: "system", content: systemPrompt(opts) },
    ...history,
  ];

  try {
    for (let iter = 0; iter < cap; iter++) {
      // Steering seam: queued user messages join at the loop boundary.
      const injected = opts.injectMessages?.() ?? [];
      for (const m of injected) history.push(m);

      const asstId = uid();
      onEvent({ type: "assistant_start", id: asstId });

      let text = "";
      let usage: { promptTokens?: number; completionTokens?: number } = {};
      const toolCalls: { id: string; name: string; arguments: string }[] = [];

      for await (const ev of postSSE<any>(
        "/api/v1/router/chat",
        {
          modelId,
          messages: messages(),
          temperature: 0.2,
          maxTokens: 4096,
          tools,
          toolChoice: "auto",
        },
        signal,
        keyHeaders,
      )) {
        if (ev.type === "delta") {
          text += ev.text;
          onEvent({ type: "text", id: asstId, delta: ev.text });
        } else if (ev.type === "reasoning") {
          onEvent({ type: "reasoning", id: asstId, delta: ev.text });
        } else if (ev.type === "tool_call") {
          toolCalls.push({
            id: ev.id || `call_${iter}_${toolCalls.length}`,
            name: ev.name,
            arguments: ev.arguments ?? "",
          });
        } else if (ev.type === "usage") {
          usage = { promptTokens: ev.promptTokens, completionTokens: ev.completionTokens };
        } else if (ev.type === "error") {
          onEvent({ type: "error", message: ev.message, code: ev.code });
          return history;
        }
      }

      onEvent({ type: "assistant_done", id: asstId, ...usage });

      // Record the assistant turn (content may be empty when it went straight
      // to tools; OpenAI-compatible providers accept "").
      const asstMsg: RouterMsg = { role: "assistant", content: text };
      if (toolCalls.length) {
        asstMsg.tool_calls = toolCalls.map<ToolCallRequest>((t) => ({
          id: t.id,
          type: "function",
          function: { name: t.name, arguments: t.arguments },
        }));
      }
      history.push(asstMsg);

      // Plain text answer → the task is finished.
      if (toolCalls.length === 0) {
        onEvent({ type: "done", summary: text });
        return history;
      }

      // Execute tools sequentially (FS ops must not interleave).
      for (const tc of toolCalls) {
        if (signal.aborted) throw new DOMException("aborted", "AbortError");
        onEvent({ type: "tool_start", id: tc.id, name: tc.name, args: tc.arguments });
        const res = await runToolCall(opts, tc);
        onEvent({
          type: "tool_done",
          id: tc.id,
          result: res.result,
          isError: res.isError,
          display: res.display,
          change: res.change,
        });
        history.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tc.name,
          content: res.result,
        });
      }
    }

    onEvent({
      type: "error",
      message: `Stopped after ${cap} iterations — the task may be incomplete. Ask me to continue if needed.`,
      code: "iteration_cap",
    });
    return history;
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      onEvent({ type: "error", message: "Stopped.", code: "aborted" });
    } else if (e instanceof SSEHttpError) {
      onEvent({ type: "error", message: e.message, code: e.code ?? String(e.status) });
    } else {
      onEvent({ type: "error", message: (e as Error).message });
    }
    return history;
  }
}
