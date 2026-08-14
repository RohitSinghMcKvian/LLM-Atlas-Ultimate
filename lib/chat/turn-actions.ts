/**
 * What a past turn actually did, in a line the model can read.
 *
 * `toRouterMessages` sends assistant turns as `{role, content}` and nothing else
 * — `toolCalls`, `sources` and `attachments` are all dropped. So across turns
 * the model cannot see what it previously did: its entire durable memory of a
 * build is the ≤2400-character workspace block, which lists paths and line
 * counts. Ask it to "add a footer to the page you made" three turns later and it
 * has no record of having made one.
 *
 * Replaying the real `tool_calls` and `role:"tool"` messages would fix that and
 * cost too much: ids have to stay unique across turns, providers vary in whether
 * they accept historical tool traffic at all (a rejection is a whole failed
 * turn), and it re-inflates exactly what `transcript-trim.ts` deflates. A
 * separate system block would detach the actions from the turn that took them,
 * which is the one thing the model needs.
 *
 * So: a short bracketed appendix on the assistant message's own content. It
 * costs only its own characters, no provider can reject it, and it rides the
 * existing persistence because `toolCalls` are already stored on the message.
 *
 * Rendering reuses `run-model.ts`'s already-tested helpers, so the wire text and
 * the Run panel describe the same run in the same words.
 */

import { detailFor, resultFailed } from "./run-model";
import type { StoredToolCall } from "./types";

export interface ActionsBudget {
  /** Characters for one rendered call. */
  perCall: number;
  /** Characters for one turn's whole appendix. */
  perTurn: number;
  /** How many recent assistant turns carry one at all. */
  turns: number;
  /** Characters across every appendix in the request. */
  total: number;
}

/**
 * Six turns is roughly "this conversation's working memory"; older actions are
 * in the workspace block and the fold summary, which is what those are for.
 * 2000 characters total is under 1% of a 128k window — the point is to be cheap
 * enough that it never has to be weighed against anything.
 */
export const ACTIONS_BUDGET: ActionsBudget = {
  perCall: 120,
  perTurn: 400,
  turns: 6,
  total: 2_000,
};

/** Past-tense verbs, matching the Run panel's own vocabulary. */
const VERBS: Record<string, string> = {
  web_search: "searched",
  search_past_chats: "searched past chats for",
  recall_context: "recalled",
  memory: "used memory",
  skill: "loaded skill",
  github: "read GitHub",
  artifact: "edited the artifact",
  read_project_file: "read",
  list_project_files: "listed project files",
  workspace: "wrote",
  tasks: "updated the plan",
  run_python: "ran Python",
};

function verbFor(name: string): string {
  const known = VERBS[name];
  if (known) return known;
  const mcp = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(name);
  if (mcp) return `called ${mcp[2]} on ${mcp[1]}`;
  return `ran ${name}`;
}

/** One call, rendered. Detail comes from the same field the Run panel shows. */
export function renderCall(call: StoredToolCall, perCall: number): string {
  const verb = verbFor(call.name);
  const detail = detailFor(call);
  const failed = resultFailed(call.result);
  // A failure is worth its characters: without it the model reads the line as a
  // record of having done the thing, and does not retry.
  const status = failed ? " (failed)" : "";
  const text = detail ? `${verb} ${detail}${status}` : `${verb}${status}`;
  return text.length > perCall ? `${text.slice(0, perCall - 1)}…` : text;
}

/** Consecutive identical calls collapse: `×3 read /workspace/app.js`. */
function collapse(rendered: string[]): string[] {
  const out: string[] = [];
  for (const item of rendered) {
    const last = out[out.length - 1];
    const bare = last?.replace(/^×\d+ /, "");
    if (bare === item) {
      const n = Number(/^×(\d+) /.exec(last!)?.[1] ?? 1) + 1;
      out[out.length - 1] = `×${n} ${item}`;
    } else {
      out.push(item);
    }
  }
  return out;
}

/** One turn's appendix, or "" when the turn called nothing. */
export function summarizeTurnActions(
  calls: StoredToolCall[],
  budget: ActionsBudget = ACTIONS_BUDGET,
): string {
  if (!calls.length) return "";
  const parts = collapse(calls.map((c) => renderCall(c, budget.perCall)));

  let body = "";
  for (const part of parts) {
    const next = body ? `${body}; ${part}` : part;
    if (next.length > budget.perTurn) {
      body = body ? `${body}; …` : part.slice(0, budget.perTurn);
      break;
    }
    body = next;
  }
  return `[Actions this turn: ${body}]`;
}

/** Append the appendix to a turn's content, or return it unchanged. */
export function appendActions(
  content: string,
  calls: StoredToolCall[],
  budget: ActionsBudget = ACTIONS_BUDGET,
): string {
  const line = summarizeTurnActions(calls, budget);
  if (!line) return content;
  return content ? `${content}\n\n${line}` : line;
}

/**
 * Which of a conversation's assistant turns get an appendix, within the total.
 *
 * Newest first, oldest dropped: the recent actions are the ones a follow-up is
 * about, and the older ones are already represented in the workspace block and
 * the fold summary.
 */
export function budgetActions(
  turns: { id: string; calls: StoredToolCall[] }[],
  budget: ActionsBudget = ACTIONS_BUDGET,
): Map<string, string> {
  const out = new Map<string, string>();
  let total = 0;
  const recent = turns.slice(-budget.turns);
  for (let i = recent.length - 1; i >= 0; i--) {
    const { id, calls } = recent[i];
    const line = summarizeTurnActions(calls, budget);
    if (!line) continue;
    if (total + line.length > budget.total) break;
    out.set(id, line);
    total += line.length;
  }
  return out;
}
