import { z } from "zod";
import { getModelById, freeModels } from "@/lib/catalog";
import {
  apiMonthlyCost,
  breakEvenRequestsPerDay,
  selfHostEstimate,
  tokensPerMonth,
  DEFAULT_SELFHOST,
  DEFAULT_WORKLOAD,
  type SelfHostAssumptions,
  type Workload,
} from "@/lib/cost/engine";
import { formatUsd } from "@/lib/chat/cost";

/**
 * The cost engine, as a tool.
 *
 * `lib/cost/engine.ts` is already pure - the whole Cost module is `useMemo`
 * over these functions - so this is a schema and a renderer over them and
 * nothing else. That matters more here than anywhere: a second implementation
 * of the pricing arithmetic would eventually disagree with the page the user is
 * looking at, and there is no way to tell which of two dollar figures is the
 * real one.
 *
 * Everything is local arithmetic over the catalog, so it costs nothing, works
 * offline, and runs without a prompt.
 */

export const costToolSchema = z.object({
  command: z
    .enum(["estimate", "selfhost", "breakeven"])
    .describe(
      "estimate: monthly API cost for models at a workload. selfhost: monthly cost of running your own GPUs. breakeven: the request volume where self-hosting gets cheaper.",
    ),
  model_ids: z
    .array(z.string().max(120))
    .max(6)
    .optional()
    .describe("Catalog model ids to price. Required for `estimate`."),
  requests_per_day: z.number().min(0).max(100_000_000).optional(),
  avg_input_tokens: z.number().min(0).max(2_000_000).optional(),
  avg_output_tokens: z.number().min(0).max(2_000_000).optional(),
  cached_ratio: z.number().min(0).max(1).optional().describe("Share of input served from cache."),
  gpu_hourly: z.number().min(0).max(1000).optional().describe("For `selfhost`: $ per GPU-hour."),
  gpu_count: z.number().int().min(1).max(1024).optional(),
  throughput_tps: z.number().min(1).max(1_000_000).optional(),
  utilization: z.number().min(0.01).max(1).optional(),
});

export type CostToolInput = z.output<typeof costToolSchema>;

export interface CostToolResult {
  content: string;
  isError?: boolean;
}

export function workloadFrom(input: CostToolInput): Workload {
  return {
    requestsPerDay: input.requests_per_day ?? DEFAULT_WORKLOAD.requestsPerDay,
    avgInputTokens: input.avg_input_tokens ?? DEFAULT_WORKLOAD.avgInputTokens,
    avgOutputTokens: input.avg_output_tokens ?? DEFAULT_WORKLOAD.avgOutputTokens,
    cachedRatio: input.cached_ratio ?? DEFAULT_WORKLOAD.cachedRatio,
    peakFactor: DEFAULT_WORKLOAD.peakFactor,
  };
}

export function selfHostFrom(input: CostToolInput): SelfHostAssumptions {
  return {
    gpuHourly: input.gpu_hourly ?? DEFAULT_SELFHOST.gpuHourly,
    gpuCount: input.gpu_count ?? DEFAULT_SELFHOST.gpuCount,
    throughputTps: input.throughput_tps ?? DEFAULT_SELFHOST.throughputTps,
    utilization: input.utilization ?? DEFAULT_SELFHOST.utilization,
    overhead: DEFAULT_SELFHOST.overhead,
  };
}

export function runCostTool(input: CostToolInput): CostToolResult {
  const workload = workloadFrom(input);
  switch (input.command) {
    case "estimate":
      return estimate(input, workload);
    case "selfhost":
      return selfhost(input, workload);
    case "breakeven":
      return breakeven(input, workload);
  }
}

/**
 * Every answer restates the assumptions it used.
 *
 * A monthly figure with no workload attached is worse than no figure: it reads
 * as authoritative, it is quoted back, and the defaults it silently used are
 * invisible. So the assumptions travel with the number, every time.
 */
function describeWorkload(w: Workload): string {
  const { total } = tokensPerMonth(w);
  return `At ${w.requestsPerDay.toLocaleString()} requests/day, ${w.avgInputTokens} in / ${w.avgOutputTokens} out per request (${(w.cachedRatio * 100).toFixed(0)}% cached) - ${Math.round(total / 1_000_000).toLocaleString()}M tokens/month.`;
}

function estimate(input: CostToolInput, w: Workload): CostToolResult {
  const ids = input.model_ids ?? [];
  if (ids.length === 0) return { content: "`estimate` needs at least one model id.", isError: true };

  const rows: string[] = [describeWorkload(w), ""];
  for (const id of ids) {
    const m = getModelById(id);
    if (!m) {
      rows.push(`${id}: not in the catalog.`);
      continue;
    }
    const c = apiMonthlyCost(m, w);
    rows.push(
      `${m.name}: ${formatUsd(c.total)}/month (${formatUsd(c.input)} in + ${formatUsd(c.output)} out)` +
        `, ${formatUsd(c.perRequest)}/request` +
        (c.cacheSavings > 0 ? `, saving ${formatUsd(c.cacheSavings)} from cache` : ""),
    );
  }
  return { content: rows.join("\n") };
}

function selfhost(input: CostToolInput, w: Workload): CostToolResult {
  const a = selfHostFrom(input);
  const r = selfHostEstimate(a, w);
  return {
    content: [
      describeWorkload(w),
      `${a.gpuCount} GPU(s) at $${a.gpuHourly}/hour, ${a.throughputTps} tok/s at ${(a.utilization * 100).toFixed(0)}% utilisation.`,
      `Monthly: ${formatUsd(r.monthly)}.`,
      `Capacity: ${Math.round(r.capacityTokens / 1_000_000).toLocaleString()}M output tokens/month - ${r.saturated ? "NOT enough for this workload" : "enough for this workload"}.`,
      `Effective rate: ${formatUsd(r.costPerMtok)} per 1M output tokens at full capacity.`,
    ].join("\n"),
  };
}

function breakeven(input: CostToolInput, w: Workload): CostToolResult {
  const a = selfHostFrom(input);
  // Compared against the cheapest open-licence model, matching how the Cost
  // page frames it: self-hosting only ever competes with a model you are
  // allowed to host, so pricing it against a proprietary API is meaningless.
  const candidates = (input.model_ids ?? []).map(getModelById).filter(Boolean);
  const cheapest =
    candidates.length > 0
      ? candidates.sort(
          (x, y) => apiMonthlyCost(x!, w).total - apiMonthlyCost(y!, w).total,
        )[0]!
      : freeModels()
          .filter((m) => m.license === "open")
          .sort((x, y) => x.pricing.inputPerM - y.pricing.inputPerM)[0];

  if (!cheapest) {
    return {
      content: "No open-licence model is available to compare against, so there is no break-even.",
    };
  }

  const rpd = breakEvenRequestsPerDay(cheapest, w, selfHostEstimate(a, w).monthly);
  const monthly = selfHostEstimate(a, w).monthly;
  if (!Number.isFinite(rpd) || rpd <= 0) {
    return {
      content: `Against ${cheapest.name} at ${formatUsd(apiMonthlyCost(cheapest, w).total)}/month, self-hosting at ${formatUsd(monthly)}/month never breaks even at this shape of request.`,
    };
  }
  return {
    content: [
      describeWorkload(w),
      `Self-host: ${formatUsd(monthly)}/month for ${a.gpuCount} GPU(s).`,
      `Against ${cheapest.name}, self-hosting is cheaper above about ${Math.round(rpd).toLocaleString()} requests/day.`,
    ].join("\n"),
  };
}
