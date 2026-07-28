// Conversation health (Depth Spec v2 C.5): token metering and
// summarize-and-continue for long conversations.

import type { ChatMessage } from "./types";
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
  // Deliberately arithmetic rather than `estimateTokens(contents.join("\n"))`:
  // this runs on every chat render, and materializing the whole conversation
  // as one string was allocating megabytes per keystroke on long threads.
  //
  // `estimateTokens` is chars/4, and the joined length is the sum of the parts
  // plus one separator between each — so this is the same integer, exactly.
  // `health.test.ts` pins the two against each other.
  let chars = 0;
  for (const m of messages) chars += m.content.length;
  if (messages.length > 1) chars += messages.length - 1;
  const estimatedTokens = Math.ceil(chars / 4);

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
