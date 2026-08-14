import { getModelById } from "@/lib/catalog";
import type { ChatMessage } from "./types";

/**
 * USD cost of one assistant turn from its token usage and the model's list
 * price. Free (operator-served) models still have a catalog price, so this
 * reflects the equivalent metered cost — useful for comparison even when the
 * user isn't billed. Returns 0 when tokens or the model are unknown.
 *
 * `imageTokens` is the part of `completionTokens` that a generated image is
 * made of (§P13). It is *inside* the completion total, so it is subtracted
 * before the text rate is applied — charging both would double-count it — and
 * re-priced at `imageOutputPerM`, which runs 10–20× the text rate on every
 * image model published so far.
 */
export function messageCostUsd(
  modelId: string | undefined,
  promptTokens?: number,
  completionTokens?: number,
  imageTokens?: number,
): number {
  const m = modelId ? getModelById(modelId) : undefined;
  if (!m) return 0;
  const inTok = promptTokens ?? 0;
  const outTok = completionTokens ?? 0;
  // A count larger than the completion total means the provider reported them
  // as an addition rather than a subset, or reported nonsense. Clamping keeps
  // the text portion from going negative either way.
  const imgTok = Math.min(Math.max(imageTokens ?? 0, 0), outTok);
  // Absent image pricing is not a reason to drop the tokens: they were still
  // produced, so they fall back to the text rate rather than becoming free.
  const imgRate = m.pricing.imageOutputPerM ?? m.pricing.outputPerM;
  return (
    (inTok / 1e6) * m.pricing.inputPerM +
    ((outTok - imgTok) / 1e6) * m.pricing.outputPerM +
    (imgTok / 1e6) * imgRate
  );
}

/** Total cost across the assistant turns on a path. */
export function sessionCostUsd(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    total +=
      m.costUsd ??
      messageCostUsd(m.model, m.promptTokens, m.completionTokens, m.imageTokens);
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
