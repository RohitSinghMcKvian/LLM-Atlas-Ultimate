"use client";

import { postSSE } from "@/lib/sse-client";
import { runToolLoop, type LoopMessage, type WireEvent } from "@/lib/chat/tool-loop";
import { executeTool, toolDefsFor, type ToolAvailability } from "@/lib/chat/tools";
import type { ToolDef } from "@/lib/router";
import type { WebSource } from "@/lib/chat/types";
import { atlasGraph } from "@/lib/graph/atlas-graph";
import { retrieveGraph, type GraphContext } from "@/lib/graph/retrieve";
import type { AtlasToolPorts } from "@/lib/tools/atlas";

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
}

export interface SessionCallbacks {
  onDelta?: (text: string) => void;
  onGraph?: (context: GraphContext | null) => void;
  onToolCall?: (name: string) => void;
  onSources?: (sources: WebSource[]) => void;
  onError?: (message: string) => void;
}

export interface SessionResult {
  content: string;
  sources: WebSource[];
  graph: GraphContext | null;
  rounds: number;
  errored: boolean;
  stoppedBy?: string;
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
  const tools: ToolDef[] = toolDefsFor(availability);

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
        return executeTool(name, args, { signal: req.signal, atlas: req.atlas });
      },
    },
    {
      onText: (text) => cb.onDelta?.(text),
      onSources: (found) => {
        sources.push(...found);
        cb.onSources?.(found);
      },
      onError: (e) => cb.onError?.(e.message),
    },
  );

  return {
    content: result.content,
    sources,
    graph: context,
    rounds: result.rounds,
    errored: result.errored,
    stoppedBy: result.stoppedBy,
  };
}
