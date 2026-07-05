// Context engineering (Depth Spec v2 A.4): long tasks don't die. Token
// estimation, a protocol-safe compaction pass over the agent conversation,
// and the /handoff resume-brief. Pure and unit-tested.
//
// Compaction philosophy: reference, don't paste. Consumed tool outputs become
// one-line references the agent can re-read on demand; old prose is truncated;
// a terse fact block (plan state, decisions) rides at the front. Message
// COUNT and tool_call↔tool pairing are preserved so the OpenAI-compatible
// protocol stays valid.

import type { ChatMessage as RouterMsg } from "@/lib/router";
import type { TaskState } from "./types";

/** chars/4 heuristic — good enough for budget decisions, cheap everywhere. */
export function estimateTokens(input: string | RouterMsg[] | null | undefined): number {
  if (!input) return 0;
  if (typeof input === "string") return Math.ceil(input.length / 4);
  let chars = 0;
  for (const m of input) {
    if (typeof m.content === "string") chars += m.content.length;
    if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
  }
  return Math.ceil(chars / 4);
}

export interface CompactOptions {
  /** Messages at the tail kept verbatim (the current working set). */
  keepLastTurns?: number;
  /** Older tool results truncated to this many chars. */
  maxToolResultChars?: number;
  /** Older user/assistant prose truncated to this many chars. */
  maxContentChars?: number;
  /** Terse fact block (plan state, decisions) prepended as a system message. */
  factBlock?: string;
}

export interface CompactResult {
  history: RouterMsg[];
  beforeTokens: number;
  afterTokens: number;
  /** False when nothing was worth compacting (history returned as-is). */
  compacted: boolean;
}

const REF_NOTE = (name: string | undefined) =>
  `[compacted: ${name ?? "tool"} output was consumed — re-read the file or re-run the command if needed]`;

export function compactHistory(history: RouterMsg[], opts: CompactOptions = {}): CompactResult {
  const { keepLastTurns = 12, maxToolResultChars = 200, maxContentChars = 1_500 } = opts;
  const beforeTokens = estimateTokens(history);
  const cut = Math.max(0, history.length - keepLastTurns);

  const next: RouterMsg[] = history.map((m, i) => {
    if (i >= cut) return m;
    if (typeof m.content !== "string") return m;
    if (m.role === "tool" && m.content.length > maxToolResultChars) {
      return { ...m, content: `${m.content.slice(0, maxToolResultChars)}\n${REF_NOTE(m.name)}` };
    }
    if ((m.role === "user" || m.role === "assistant") && m.content.length > maxContentChars) {
      return { ...m, content: `${m.content.slice(0, maxContentChars)}\n[…compacted]` };
    }
    return m;
  });

  if (opts.factBlock?.trim()) {
    next.unshift({
      role: "system",
      content: `## Task facts (compacted context)\n${opts.factBlock.trim()}`,
    });
  }

  const afterTokens = estimateTokens(next);
  if (afterTokens >= beforeTokens && !opts.factBlock) {
    return { history, beforeTokens, afterTokens: beforeTokens, compacted: false };
  }
  return { history: next, beforeTokens, afterTokens, compacted: true };
}

/** Terse fact block for compaction: plan state the agent must not lose. */
export function taskFactBlock(state: TaskState): string {
  const lines: string[] = [`Goal: ${state.goal}`, `Phase: ${state.phase}`];
  for (const t of state.todos) lines.push(`- [${t.status}] ${t.text} (done when: ${t.acceptance})`);
  if (state.exploreSummary) lines.push(`Explore summary:\n${state.exploreSummary.slice(0, 1_000)}`);
  return lines.join("\n");
}

/**
 * /handoff (A.4): a resume-brief so a fresh session — or a different model —
 * continues cleanly. Doubles as the session-model groundwork for B.5.
 */
export function buildHandoffBrief(
  state: TaskState | null,
  extras: { changedFiles?: string[]; openQuestions?: string[]; costUsd?: number } = {},
): string {
  const lines: string[] = ["# Atlas Code — session handoff", ""];
  if (state) {
    lines.push(`**Goal:** ${state.goal}`, `**Phase reached:** ${state.phase}`, "");
    if (state.todos.length) {
      lines.push("## Plan state");
      for (const t of state.todos) {
        lines.push(`- [${t.status === "done" ? "x" : " "}] ${t.text} — done when: ${t.acceptance}`);
        if (t.strategyLog.length)
          lines.push(`  - strategies tried: ${t.strategyLog.join(" → ")}`);
      }
      lines.push("");
    }
    if (state.exploreSummary) lines.push("## Explore summary", state.exploreSummary, "");
    if (state.report) {
      lines.push("## Delivered");
      for (const f of state.report.files) lines.push(`- ${f.kind}: ${f.path}`);
      if (state.report.leftUndone.length)
        lines.push("", "## Left undone", ...state.report.leftUndone.map((l) => `- ${l}`));
      lines.push("");
    }
  }
  if (extras.changedFiles?.length)
    lines.push("## Changed files", ...extras.changedFiles.map((f) => `- ${f}`), "");
  if (extras.openQuestions?.length)
    lines.push("## Open questions", ...extras.openQuestions.map((q) => `- ${q}`), "");
  if (extras.costUsd != null) lines.push(`_Session cost so far: $${extras.costUsd.toFixed(4)}_`);
  return lines.join("\n").trim() + "\n";
}
