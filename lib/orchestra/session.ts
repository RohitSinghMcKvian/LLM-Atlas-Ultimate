"use client";

import { postSSE } from "@/lib/sse-client";
import { runToolLoop, type LoopMessage, type WireEvent } from "@/lib/chat/tool-loop";
import { executeTool, toolDefsFor, type ToolAvailability, type ToolResult } from "@/lib/chat/tools";
import type { SubagentTask, SubagentTurnState } from "@/lib/chat/subagent";
import { messageCostUsd } from "@/lib/chat/cost";
import { needsApproval, classify } from "@/lib/tools/spec";
import type { ToolDef } from "@/lib/router";
import type { WebSource } from "@/lib/chat/types";
import { atlasGraph } from "@/lib/graph/atlas-graph";
import { retrieveGraph, type GraphContext } from "@/lib/graph/retrieve";
import type { AtlasToolPorts } from "@/lib/tools/atlas";
import { allowedRoles, type AgentRole } from "@/lib/orchestra/roles";
import { runAgents, finishRun, mergeOutcomes, type AgentTask, type OrchestraPorts } from "@/lib/orchestra/run";
import { startRun, type OrchestraRun } from "@/lib/orchestra/trace";

/**
 * One agent turn, outside the chat page.
 *
 * The Ask Atlas panel is on every workspace screen and voice mode is its own
 * surface, and neither can mount `ChatClient` - it is 3,948 lines, it owns a
 * conversation tree, an artifact panel and a workspace filesystem, and none of
 * that belongs in a summonable side panel. So the turn itself lives here, built
 * from the same parts the chat page uses rather than reimplementing them:
 * `runToolLoop` drives the rounds, `toolDefsFor` decides what is offered,
 * `executeTool` runs it, `postSSE` carries the stream.
 *
 * Migrating `streamInto` onto this is explicitly *not* part of it. That refactor
 * deserves its own change with the existing chat tests as its safety net, and
 * doing it here would put a 3,948-line file in the blast radius of a new panel.
 *
 * This is also the only place `spawn_subagents` is wired to `lib/orchestra/run.ts`
 * rather than to a hardcoded `MAX_AGENTS = 3` read-only fan-out: `chat-client.tsx`
 * keeps its own existing implementation (untouched, per the constraint above), and
 * a typed, budget-derived, traced fan-out was built and tested in P18 with no
 * caller anywhere in the running app — see `SELF-AUDIT.md` §P18.4/§P18.6. Giving
 * it one here is what makes the Agents and Log rail tabs show anything real.
 *
 * Everything that touches the world is a parameter, so the loop is testable with
 * fakes - the same seam `TaskPorts` uses in `lib/engine/ports.ts`.
 */

export interface SessionTurn {
  role: "user" | "assistant";
  content: string;
}

export interface SessionRequest {
  modelId: string;
  question: string;
  /** Prior turns, oldest first. */
  history?: readonly SessionTurn[];
  /** What is on screen where the question was asked. */
  surface?: string;
  /** Extra system guidance, e.g. the voice-mode block. */
  systemExtra?: string;
  availability?: Partial<ToolAvailability>;
  atlas?: AtlasToolPorts;
  openRouterKey?: string;
  signal?: AbortSignal;
  /**
   * Total the turn's own fan-out may spend, in USD. `spawn_subagents` is only
   * offered when at least one read-only role has a tool to use — see
   * `orchestraRoles` — so a caller that never wants the dock spending on its
   * own initiative can pass 0.
   */
  subagentsBudgetUsd?: number;
}

export interface SessionCallbacks {
  onDelta?: (text: string) => void;
  onGraph?: (context: GraphContext | null) => void;
  onToolCall?: (name: string) => void;
  onSources?: (sources: WebSource[]) => void;
  /**
   * `code` is `RouterError["code"]` when the failure originated there (e.g.
   * `"no_provider_configured"`, `"key_required"`) and absent otherwise — it
   * already survives the SSE stream into `runToolLoop`'s own callback
   * (`lib/chat/tool-loop.ts`); this just stops flattening it back to a string
   * here, so a caller can offer a fix instead of only displaying prose.
   */
  onError?: (message: string, code?: string) => void;
  /** A fan-out started, progressed, or finished. Mirrors into `useGraphStore.setRun`. */
  onRun?: (run: OrchestraRun) => void;
  /**
   * Approve one write/spend tool call before it runs — `spawn_subagents` is
   * classed `spend` (`lib/tools/spec.ts`), and this surface has no composer
   * toggle or connector dialog the way `chat-client.tsx` does.
   *
   * Absent means every such call is refused rather than silently allowed:
   * "read freely, act behind approval" was a foundational decision for this
   * whole feature, and a surface with no way to ask has to fail closed, not
   * open, the moment it offers something that can spend.
   */
  onApproval?: (info: { name: string; title: string }) => Promise<boolean> | boolean;
}

export interface SessionResult {
  content: string;
  sources: WebSource[];
  graph: GraphContext | null;
  rounds: number;
  errored: boolean;
  stoppedBy?: string;
  /** The fan-out this turn ran, if `spawn_subagents` was actually called. */
  run: OrchestraRun | null;
}

/**
 * The base instructions.
 *
 * Short on purpose: this surface answers questions about Atlas from Atlas's own
 * data, and a long prompt here would start competing with the chat page's own,
 * which is assembled by `buildSystemPrompt` from the user's real preferences.
 */
export const SESSION_SYSTEM = [
  "You are Atlas, answering from inside the LLM Atlas workspace.",
  "Answer from the tools and the retrieved facts, never from recollection about models,",
  "prices or benchmarks - the catalog changes weekly and your memory of it is wrong.",
  "Cite retrieved facts by their [n] markers. If nothing was retrieved, say so plainly",
  "rather than filling the gap.",
  "Be brief. This panel is narrow and sits beside whatever the person is actually doing.",
].join(" ");

const DEFAULT_AVAILABILITY: ToolAvailability = {
  webSearch: false,
  hasProject: false,
  memory: false,
  hasSkills: false,
  github: false,
  hasArtifact: false,
  buildMode: false,
  codeExecution: false,
  hasFoldedContext: false,
  subagents: false,
  atlasTools: true,
};

/** How many tool rounds a panel turn may take. Lower than a build, on purpose. */
export const MAX_SESSION_ROUNDS = 4;

/**
 * Default ceiling on what one turn's `spawn_subagents` call may spend in total.
 *
 * There is no running `BuildBudget` here the way there is in a build - the dock
 * answers one question at a time - so this is a flat allowance rather than a
 * remaining balance. Comfortably above `PARENT_HEADROOM_USD` (0.3) in
 * `lib/chat/subagent.ts`, which the shared `spawn_subagents` tool checks before
 * this module is ever asked to run anything.
 */
export const DEFAULT_ORCHESTRA_BUDGET_USD = 0.5;

/**
 * Which roles a fan-out could actually use this turn, and under what name.
 *
 * `spawn_subagents` is only worth offering when at least one read-only role has
 * a tool to reach - `atlas_graph` and `atlas_catalog` are on by default, so the
 * common case clears this immediately, but a turn with every optional surface
 * off should not offer a tool that can only ever come back empty.
 */
function orchestraRoles(offeredToolNames: readonly string[]): AgentRole[] {
  return allowedRoles(offeredToolNames, false);
}

/**
 * Run one tool call, refusing it first if it needs approval this surface
 * cannot yet grant on its own. Shared by the outer turn and by every
 * sub-agent's own loop, so a write/spend tool can never reach `executeTool`
 * from either path without clearing the same gate.
 */
async function runGuardedTool(
  name: string,
  args: string,
  execCtx: Parameters<typeof executeTool>[2],
  cb: SessionCallbacks,
): Promise<ToolResult> {
  if (needsApproval(name)) {
    const { title } = classify(name);
    const ok = (await cb.onApproval?.({ name, title })) ?? false;
    if (!ok) {
      return {
        content: `"${title}" needs approval before it can run, and it was not approved this turn.`,
        isError: true,
      };
    }
  }
  return executeTool(name, args, execCtx);
}

export async function runSessionTurn(
  req: SessionRequest,
  cb: SessionCallbacks = {},
): Promise<SessionResult> {
  const graph = atlasGraph();
  // Retrieval before the first token, exactly as the chat path does it: the
  // model should never have to ask for facts that were already available.
  const context = retrieveGraph(graph, req.question);
  cb.onGraph?.(context);

  const availability: ToolAvailability = { ...DEFAULT_AVAILABILITY, ...req.availability };
  const offeredToolNames = toolDefsFor(availability).map((t) => t.function.name);
  const roles = orchestraRoles(offeredToolNames);
  // A role can only narrow what the turn already offers (`toolsFor` in
  // `lib/orchestra/roles.ts` intersects), so `roles` is never wider than
  // `offeredToolNames` - offering the tool at all is safe the moment one role
  // clears that intersection.
  availability.subagents = roles.length > 0;
  const tools: ToolDef[] = toolDefsFor(availability);

  const subagentTurn: SubagentTurnState = { calls: 0, agents: 0 };
  const budgetUsd = req.subagentsBudgetUsd ?? DEFAULT_ORCHESTRA_BUDGET_USD;
  let run: OrchestraRun = startRun(
    typeof crypto !== "undefined" ? crypto.randomUUID() : `run-${Date.now()}`,
    "dock",
    req.question,
  );

  const runOneAgent: OrchestraPorts["runAgent"] = async ({ task, role, tools: allowedNames, maxUsd, maxRounds, signal, onEvent }) => {
    const scoped = tools.filter((t) => allowedNames.includes(t.function.name));
    let spentUsd = 0;
    const agentResult = await runToolLoop(
      [
        { role: "system", content: role.prompt },
        { role: "user", content: task.instruction },
      ],
      {
        toolDefs: scoped,
        maxRounds,
        stream: (msgs, toolDefs) =>
          postSSE<WireEvent>(
            "/api/v1/router/chat",
            { modelId: req.modelId, messages: msgs, tools: toolDefs },
            signal,
            req.openRouterKey ? { "x-openrouter-key": req.openRouterKey } : undefined,
          ),
        runTool: async (name, args) => {
          onEvent?.("tool_call", name);
          return runGuardedTool(name, args, { signal, atlas: req.atlas }, cb);
        },
        // Withheld once this agent's own share is spent, rather than aborted
        // outright: the loop's own final-round rule then still lets it answer
        // with whatever it already found, instead of ending with nothing.
        shouldStop: () => (spentUsd >= maxUsd ? { reason: "budget", message: "Sub-agent budget reached." } : null),
      },
      {
        onUsage: (u) => {
          spentUsd += messageCostUsd(req.modelId, u.promptTokens, u.completionTokens, u.imageTokens);
        },
      },
    );
    return { report: agentResult.content || "(no report)", spentUsd };
  };

  const spawnSubagents = async (tasks: SubagentTask[]) => {
    const agentTasks: AgentTask[] = tasks.map((t, i) => ({
      id: typeof crypto !== "undefined" ? crypto.randomUUID() : `agent-${Date.now()}-${i}`,
      role: roles[i % roles.length].id,
      title: t.title,
      instruction: t.instruction,
    }));
    const result = await runAgents(run, agentTasks, {
      runAgent: runOneAgent,
      availableTools: offeredToolNames,
      budgetUsd,
      signal: req.signal,
      onRun: (r) => {
        run = r;
        cb.onRun?.(r);
      },
    });
    run = finishRun(run, result);
    cb.onRun?.(run);
    return { content: mergeOutcomes(result.outcomes), sources: [] };
  };

  const system = [
    SESSION_SYSTEM,
    req.surface ? `The person is looking at: ${req.surface}` : "",
    req.systemExtra ?? "",
    context?.text ?? "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const messages: LoopMessage[] = [
    { role: "system", content: system },
    ...(req.history ?? []).map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: req.question },
  ];

  const sources: WebSource[] = [...(context?.sources ?? [])];

  const result = await runToolLoop(
    messages,
    {
      toolDefs: tools,
      maxRounds: MAX_SESSION_ROUNDS,
      stream: (msgs, toolDefs) =>
        postSSE<WireEvent>(
          "/api/v1/router/chat",
          { modelId: req.modelId, messages: msgs, tools: toolDefs },
          req.signal,
          req.openRouterKey ? { "x-openrouter-key": req.openRouterKey } : undefined,
        ),
      runTool: async (name, args) => {
        cb.onToolCall?.(name);
        return runGuardedTool(
          name,
          args,
          {
            signal: req.signal,
            atlas: req.atlas,
            spawnSubagents,
            subagentTurn,
            subagentHeadroomUsd: budgetUsd,
          },
          cb,
        );
      },
    },
    {
      onText: (text) => cb.onDelta?.(text),
      onSources: (found) => {
        sources.push(...found);
        cb.onSources?.(found);
      },
      onError: (e) => cb.onError?.(e.message, e.code),
    },
  );

  return {
    content: result.content,
    sources,
    graph: context,
    rounds: result.rounds,
    errored: result.errored,
    stoppedBy: result.stoppedBy,
    run: subagentTurn.calls > 0 ? run : null,
  };
}
