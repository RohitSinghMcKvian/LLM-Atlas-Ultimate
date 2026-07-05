import { getModelById } from "@/lib/catalog";
import type { ChatMessage } from "./types";

/**
 * USD cost of one assistant turn from its token usage and the model's list
 * price. Free (operator-served) models still have a catalog price, so this
 * reflects the equivalent metered cost — useful for comparison even when the
 * user isn't billed. Returns 0 when tokens or the model are unknown.
 */
export function messageCostUsd(
  modelId: string | undefined,
  promptTokens?: number,
  completionTokens?: number,
): number {
  const m = modelId ? getModelById(modelId) : undefined;
  if (!m) return 0;
  const inTok = promptTokens ?? 0;
  const outTok = completionTokens ?? 0;
  return (inTok / 1e6) * m.pricing.inputPerM + (outTok / 1e6) * m.pricing.outputPerM;
}

/** Total cost across the assistant turns on a path. */
export function sessionCostUsd(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    total +=
      m.costUsd ?? messageCostUsd(m.model, m.promptTokens, m.completionTokens);
  }
  return total;
}

/** Compact currency, adaptive to tiny per-message amounts. */
export function formatUsd(n: number): string {
  if (n <= 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}
