import { fanOut } from "@/lib/engine/orchestrator";
import { ROLES, toolsFor, type AgentRole, type RoleId } from "./roles";
import { append, endRun, type OrchestraRun } from "./trace";

/**
 * Running a fan-out of typed sub-agents.
 *
 * Built on `fanOut` from `lib/engine/orchestrator.ts` rather than a second
 * concurrency primitive: it already does bounded parallelism with per-job error
 * capture and an abort signal, and it is already tested.
 *
 * What this adds is the part `lib/chat/subagent.ts` deliberately did not have:
 * a *budget-derived* agent cap instead of a hardcoded three, a role that decides
 * which tools an agent gets, and a trace that survives the turn.
 *
 * Pure of React and of storage. Everything that touches the world arrives
 * through `OrchestraPorts`, so the whole loop is testable with fakes - the same
 * seam `TaskPorts` uses in `lib/engine/ports.ts`.
 */

export interface AgentTask {
  id: string;
  role: RoleId;
  title: string;
  instruction: string;
}

export interface AgentOutcome {
  id: string;
  role: RoleId;
  title: string;
  report: string;
  /** USD this agent charged. */
  spentUsd: number;
  ok: boolean;
  error?: string;
}

export interface OrchestraPorts {
  /**
   * Run one sub-agent turn to completion and return its report.
   *
   * The only seam that reaches a model. Given the tools the role is allowed and
   * a dollar ceiling it must not exceed.
   */
  runAgent: (args: {
    task: AgentTask;
    role: AgentRole;
    tools: string[];
    maxUsd: number;
    maxRounds: number;
    signal?: AbortSignal;
    onEvent?: (kind: "tool_call" | "tool_result" | "source" | "graph_hit", text: string) => void;
  }) => Promise<{ report: string; spentUsd: number }>;
  /** Tools the turn itself permits. A role can only narrow this. */
  availableTools: readonly string[];
  /** Remaining budget for the whole fan-out, in USD. */
  budgetUsd: number;
  signal?: AbortSignal;
  /** Called after every trace append, so a UI can follow along. */
  onRun?: (run: OrchestraRun) => void;
  now?: () => number;
}

/**
 * Floor below which an agent cannot do anything useful.
 *
 * A sub-agent with two cents cannot complete a single round of a tool loop on
 * most models; spawning it produces an empty report and charges for the attempt.
 * Better to run fewer agents with a real budget each.
 */
export const MIN_AGENT_USD = 0.05;

/** Hard ceiling regardless of budget - beyond this, a fan-out is unreadable. */
export const MAX_AGENTS = 6;

export const DEFAULT_CONCURRENCY = 3;

/**
 * How many agents this budget can actually support.
 *
 * This replaces `MAX_AGENTS = 3` in `lib/chat/subagent.ts`. A constant is wrong
 * in both directions: three agents on a two-cent budget all fail, and three is
 * an arbitrary cap on a run the user has funded for twenty.
 */
export function agentCapacity(budgetUsd: number): number {
  if (budgetUsd < MIN_AGENT_USD) return 0;
  return Math.max(1, Math.min(MAX_AGENTS, Math.floor(budgetUsd / MIN_AGENT_USD)));
}

/**
 * Split a budget across roles by their declared share.
 *
 * Shares are normalised over the roles actually running, so dropping the
 * builder from a read-only run gives its share back to the others rather than
 * leaving 30% of the budget unspent.
 */
export function budgetFor(tasks: readonly AgentTask[], budgetUsd: number): Map<string, number> {
  const shares = tasks.map((t) => ROLES[t.role]?.budgetShare ?? 0.2);
  const total = shares.reduce((s, v) => s + v, 0) || 1;
  const out = new Map<string, number>();
  tasks.forEach((t, i) => out.set(t.id, (budgetUsd * shares[i]) / total));
  return out;
}

export interface OrchestraResult {
  run: OrchestraRun;
  outcomes: AgentOutcome[];
  /** Why the fan-out stopped short, if it did. */
  stoppedBy?: "budget" | "aborted";
}

export async function runAgents(
  run: OrchestraRun,
  tasks: readonly AgentTask[],
  ports: OrchestraPorts,
): Promise<OrchestraResult> {
  const now = ports.now ?? Date.now;
  let current = run;
  const emit = (event: Parameters<typeof append>[1]) => {
    current = append(current, event, now());
    ports.onRun?.(current);
  };

  const capacity = agentCapacity(ports.budgetUsd);
  if (capacity === 0) {
    emit({
      kind: "error",
      text: `Not enough budget left to run a sub-agent (need at least $${MIN_AGENT_USD}).`,
    });
    return { run: current, outcomes: [], stoppedBy: "budget" };
  }

  const admitted = tasks.slice(0, capacity);
  if (admitted.length < tasks.length) {
    emit({
      kind: "error",
      text: `Budget supports ${admitted.length} of ${tasks.length} agents. Running the first ${admitted.length}.`,
    });
  }

  const budgets = budgetFor(admitted, ports.budgetUsd);

  const results = await fanOut(
    admitted.map((task) => ({
      id: task.id,
      run: async () => {
        const role = ROLES[task.role];
        const tools = toolsFor(role, ports.availableTools);
        emit({
          kind: "agent_start",
          agentId: task.id,
          role: task.role,
          text: task.title,
          data: { tools: tools.join(",") || "none" },
        });

        const outcome = await ports.runAgent({
          task,
          role,
          tools,
          maxUsd: budgets.get(task.id) ?? MIN_AGENT_USD,
          maxRounds: role.maxRounds,
          signal: ports.signal,
          onEvent: (kind, text) => emit({ kind, agentId: task.id, role: task.role, text }),
        });

        emit({
          kind: "spend",
          agentId: task.id,
          role: task.role,
          text: `${role.label} spent $${outcome.spentUsd.toFixed(4)}`,
          data: { usd: outcome.spentUsd },
        });
        emit({ kind: "agent_end", agentId: task.id, role: task.role, text: "done" });
        return outcome;
      },
    })),
    DEFAULT_CONCURRENCY,
    ports.signal,
  );

  const outcomes: AgentOutcome[] = results.map((r, i) => {
    const task = admitted[i];
    if (r.ok && r.value) {
      return {
        id: task.id,
        role: task.role,
        title: task.title,
        report: r.value.report,
        spentUsd: r.value.spentUsd,
        ok: true,
      };
    }
    // A failed agent costs one angle, not the run - the same rule
    // `lib/research/run.ts` applies to a failed search.
    const reason = r.error ?? "the agent returned nothing";
    emit({ kind: "error", agentId: task.id, role: task.role, text: reason });
    emit({ kind: "agent_end", agentId: task.id, role: task.role, text: "failed" });
    return {
      id: task.id,
      role: task.role,
      title: task.title,
      report: "",
      spentUsd: 0,
      ok: false,
      error: reason,
    };
  });

  const aborted = ports.signal?.aborted === true;
  return {
    run: current,
    outcomes,
    stoppedBy: aborted ? "aborted" : admitted.length < tasks.length ? "budget" : undefined,
  };
}

/**
 * Merge reports into one block for the parent turn.
 *
 * A failed agent is named rather than omitted. Silently dropping it lets the
 * parent conclude the question was fully investigated when one angle was never
 * looked at, which is the worse of the two failures.
 */
export function mergeOutcomes(outcomes: readonly AgentOutcome[], clip = 3_000): string {
  if (outcomes.length === 0) return "";
  const lines = ["<agent_reports>"];
  for (const o of outcomes) {
    const role = ROLES[o.role]?.label ?? o.role;
    if (!o.ok) {
      lines.push(`[${role}] ${o.title}: FAILED - ${o.error ?? "no report"}. This angle was not covered.`);
      continue;
    }
    const body = o.report.length > clip ? `${o.report.slice(0, clip)}\n(report truncated)` : o.report;
    lines.push(`[${role}] ${o.title}:\n${body}`);
  }
  lines.push("</agent_reports>");
  return lines.join("\n\n");
}

/** Close a run out, recording why it ended. */
export function finishRun(
  run: OrchestraRun,
  result: Pick<OrchestraResult, "outcomes" | "stoppedBy">,
  now = Date.now(),
): OrchestraRun {
  if (result.stoppedBy === "aborted") return endRun(run, "stopped", "Stopped by the user.", now);
  const failed = result.outcomes.filter((o) => !o.ok).length;
  if (failed > 0 && failed === result.outcomes.length) {
    return endRun(run, "failed", "Every agent failed.", now);
  }
  const suffix = failed > 0 ? ` (${failed} failed)` : "";
  return endRun(run, "done", `${result.outcomes.length - failed} agent(s) reported${suffix}.`, now);
}
