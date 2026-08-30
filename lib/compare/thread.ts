// Per-lane conversation memory.
//
// The rule that makes a multi-turn comparison still a comparison: on a
// follow-up, lane L sees **only its own prior answers**. No other model's text
// ever enters its context. Merging the lanes into one shared history would be
// cheaper and would also destroy the thing being measured — you would be
// comparing how well each model continues a transcript it did not write.
//
// The second rule is that a session cannot grow without bound. Each lane has a
// different context window, so each folds independently, and folding reuses
// `lib/chat/compact.ts` unmodified: `planCompaction` chooses what to fold and
// `applyFold` replaces it with one synthetic turn built from a mechanical
// excerpt. No model call, so a long session costs nothing to keep going.

import { applyFold, keepRecentFor, planCompaction } from "@/lib/chat/compact";
import { estimateTokens } from "@/lib/engine/context";
import type { ChatMessage } from "@/lib/chat/types";
import { CONTEXT_SAFETY, PROMPT_OVERHEAD_TOKENS } from "./lanes";
import { orderedTurns, type CompareSession } from "./session";
import type { CompareRun } from "./types";

/** The parts of a model this module reads. */
export interface ThreadModel {
  contextWindow: number;
  maxOutput?: number;
}

/**
 * One lane's own history, oldest first.
 *
 * The newest turn is excluded: it is the question being asked, and the caller
 * appends it. Turns where the lane produced nothing — it failed, was blocked,
 * or had not joined yet — contribute neither a question nor an answer, because
 * a user turn with no reply teaches the model that questions can be ignored.
 */
export function laneHistory(
  session: CompareSession,
  runs: CompareRun[],
  laneId: string,
): ChatMessage[] {
  const turns = orderedTurns(session, runs);
  const out: ChatMessage[] = [];

  for (const run of turns) {
    const lane = run.lanes.find((l) => l.id === laneId);
    const answer = lane?.text.trim();
    if (!answer) continue;

    const question = (run.brief?.task ?? run.config.question).trim();
    if (!question) continue;

    out.push({
      id: `${run.id}:q`,
      role: "user",
      content: question,
      parentId: null,
      createdAt: run.createdAt,
    });
    out.push({
      id: `${run.id}:${laneId}`,
      role: "assistant",
      content: answer,
      parentId: null,
      createdAt: run.updatedAt,
      model: lane?.modelId,
    });
  }

  return out;
}

/**
 * The turn a lane first answered on, or -1 if it never has.
 *
 * Derived from the runs rather than stored on the session, so the two cannot
 * disagree. Drives the "joined at turn 3 and has not seen the earlier turns"
 * note — a lane added late is not broken, but it is not comparable either, and
 * the card has to say so.
 */
export function laneJoinedAt(session: CompareSession, runs: CompareRun[], laneId: string): number {
  const turns = orderedTurns(session, runs);
  for (let i = 0; i < turns.length; i++) {
    const lane = turns[i].lanes.find((l) => l.id === laneId);
    if (lane?.text.trim()) return i;
  }
  return -1;
}

export interface FittedHistory {
  messages: ChatMessage[];
  /** Turns replaced by the synthetic summary. 0 when nothing folded. */
  foldedCount: number;
  /** Tokens the fitted history costs. */
  tokens: number;
}

/**
 * Fit a lane's history into what is left of its context window.
 *
 * The budget is the window minus the answer it is about to produce, minus the
 * evidence pack it carries, minus the prompt scaffolding — the same arithmetic
 * `lanes.ts` uses to decide `ContextFit`, kept consistent by importing the same
 * two constants rather than restating them.
 *
 * Folding is applied whole, not incrementally: `planCompaction` already keeps a
 * recent tail sized to the model's window, and re-folding a fold produces
 * summaries of summaries.
 */
export function fitLaneHistory(
  history: ChatMessage[],
  model: ThreadModel | undefined,
  reservedTokens: number,
): FittedHistory {
  const raw = estimateTokens(historyText(history));
  if (history.length === 0) return { messages: history, foldedCount: 0, tokens: 0 };

  const window = Math.floor((model?.contextWindow ?? 0) * CONTEXT_SAFETY);
  const budget = window - reservedTokens - PROMPT_OVERHEAD_TOKENS;

  // No window information, or it already fits: send it as-is.
  if (window <= 0 || raw <= budget) {
    return { messages: history, foldedCount: 0, tokens: raw };
  }

  const plan = planCompaction(history, keepRecentFor(model?.contextWindow));
  if (!plan) {
    // Too few turns to fold and still over budget. The oldest exchange goes
    // rather than the request being rejected outright by the provider; losing
    // the start of a conversation beats losing the whole turn.
    const trimmed = dropOldestExchange(history);
    if (trimmed.length === history.length) {
      return { messages: history, foldedCount: 0, tokens: raw };
    }
    const fitted = fitLaneHistory(trimmed, model, reservedTokens);
    return { ...fitted, foldedCount: fitted.foldedCount + 1 };
  }

  const foldIds = new Set(plan.foldIds);
  const marked = history.map((m) => (foldIds.has(m.id) ? { ...m, folded: true } : m));
  const folded = applyFold(marked, null);
  return {
    messages: folded,
    foldedCount: plan.foldedCount,
    tokens: estimateTokens(historyText(folded)),
  };
}

/** Drop the oldest question-and-answer pair. */
function dropOldestExchange(history: ChatMessage[]): ChatMessage[] {
  const firstUser = history.findIndex((m) => m.role === "user");
  if (firstUser === -1) return history.slice(1);
  const nextUser = history.findIndex((m, i) => i > firstUser && m.role === "user");
  return nextUser === -1 ? [] : history.slice(nextUser);
}

function historyText(history: ChatMessage[]): string {
  return history.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
}

/**
 * How full a lane's window is, for the context meter.
 *
 * Reported as a fraction of the *usable* window rather than the raw one,
 * because the raw number would show comfortable headroom right up to the point
 * the provider rejects the request.
 */
export interface ContextUse {
  used: number;
  usable: number;
  /** 0-1. Above 1 means the lane must fold before it can answer. */
  fraction: number;
}

export function contextUse(
  history: ChatMessage[],
  model: ThreadModel | undefined,
  reservedTokens: number,
): ContextUse {
  const usable = Math.max(
    0,
    Math.floor((model?.contextWindow ?? 0) * CONTEXT_SAFETY) - reservedTokens - PROMPT_OVERHEAD_TOKENS,
  );
  const used = estimateTokens(historyText(history));
  return { used, usable, fraction: usable > 0 ? used / usable : 0 };
}

/** Above this the meter warns: the next turn or two will start folding. */
export const CONTEXT_WARN_AT = 0.75;

/** One line for the lane card. */
export function describeContext(use: ContextUse, foldedCount: number): string | null {
  if (foldedCount > 0) {
    return `Summarised ${foldedCount} earlier turn${foldedCount === 1 ? "" : "s"} to fit its window.`;
  }
  if (use.usable > 0 && use.fraction >= CONTEXT_WARN_AT) {
    return `${Math.round(use.fraction * 100)}% of this model's window is the conversation so far.`;
  }
  return null;
}
