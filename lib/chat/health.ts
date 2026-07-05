// Conversation health (Depth Spec v2 C.5): token metering and
// summarize-and-continue for long conversations.

import type { ChatMessage } from "./types";
import { estimateTokens } from "@/lib/engine/context";
import { getModelById } from "@/lib/catalog";

export interface ConversationHealth {
  estimatedTokens: number;
  contextWindow: number;
  usage: number;
  status: "ok" | "warning" | "critical";
}

export function measureHealth(
  messages: ChatMessage[],
  modelId: string,
): ConversationHealth {
  const text = messages.map((m) => m.content).join("\n");
  const estimatedTokens = estimateTokens(text);
  const model = getModelById(modelId);
  const contextWindow = model?.contextWindow ?? 128_000;
  const usage = estimatedTokens / contextWindow;
  const status = usage >= 0.8 ? "critical" : usage >= 0.6 ? "warning" : "ok";
  return { estimatedTokens, contextWindow, usage, status };
}

export function shouldSuggestSummarize(health: ConversationHealth): boolean {
  return health.usage >= 0.6;
}

export function buildContinuationSummary(messages: ChatMessage[]): string {
  const pinned = messages.filter((m) => m.pinned);
  const recent = messages.slice(-6);
  const parts: string[] = [];

  if (pinned.length) {
    parts.push("## Pinned context (preserved verbatim)");
    for (const m of pinned) {
      parts.push(`[${m.role}]: ${m.content}`);
    }
  }

  parts.push("## Conversation summary");
  const earlier = messages.slice(0, -6);
  if (earlier.length) {
    const topics = earlier
      .filter((m) => m.role === "user")
      .map((m) => m.content.slice(0, 100))
      .slice(-5);
    parts.push(`Topics discussed: ${topics.join("; ")}`);
  }

  parts.push("## Recent messages (verbatim)");
  for (const m of recent) {
    const prefix = m.role === "user" ? "User" : "Assistant";
    parts.push(`${prefix}: ${m.content.slice(0, 1500)}`);
  }

  return parts.join("\n\n");
}
