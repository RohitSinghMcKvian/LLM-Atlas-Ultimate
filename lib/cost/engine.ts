import type { CatalogModel } from "@/lib/catalog/types";

export interface Workload {
  /** Requests per day. */
  requestsPerDay: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  /** Fraction of input tokens served from cache (0–1). */
  cachedRatio: number;
  /** Peak concurrency factor (informational; affects self-host sizing). */
  peakFactor: number;
}

export interface SelfHostAssumptions {
  /** $ per GPU-hour. */
  gpuHourly: number;
  gpuCount: number;
  /** Output tokens/sec across the deployment. */
  throughputTps: number;
  /** Utilization 0–1. */
  utilization: number;
  /** Ops/infra overhead multiplier (e.g. 0.25 = +25%). */
  overhead: number;
}

const DAYS = 30;
const HOURS_PER_MONTH = 730;

export function tokensPerMonth(w: Workload) {
  const inTok = w.requestsPerDay * DAYS * w.avgInputTokens;
  const outTok = w.requestsPerDay * DAYS * w.avgOutputTokens;
  return { inTok, outTok, total: inTok + outTok };
}

export interface ApiCost {
  input: number;
  output: number;
  total: number;
  perRequest: number;
  per1kRequests: number;
  cacheSavings: number;
}

/** Monthly API cost for a model at the given workload (incl. cache savings). */
export function apiMonthlyCost(model: CatalogModel, w: Workload): ApiCost {
  const { inTok, outTok } = tokensPerMonth(w);
  const p = model.pricing;
  const cachedPrice = p.cachedInputPerM ?? p.inputPerM;

  const blendedInputPrice =
    w.cachedRatio * cachedPrice + (1 - w.cachedRatio) * p.inputPerM;
  const input = (inTok / 1e6) * blendedInputPrice;
  const output = (outTok / 1e6) * p.outputPerM;
  const total = input + output;

  const fullInput = (inTok / 1e6) * p.inputPerM;
  const cacheSavings = Math.max(0, fullInput - input);

  const reqMonth = w.requestsPerDay * DAYS || 1;
  return {
    input,
    output,
    total,
    perRequest: total / reqMonth,
    per1kRequests: (total / reqMonth) * 1000,
    cacheSavings,
  };
}

/** Monthly self-hosting TCO for open-weight deployment (model-agnostic infra). */
export function selfHostMonthly(a: SelfHostAssumptions): number {
  const compute = a.gpuHourly * a.gpuCount * HOURS_PER_MONTH;
  return compute * (1 + a.overhead);
}

/** Output token capacity per month for the self-host deployment. */
export function selfHostCapacityTokens(a: SelfHostAssumptions): number {
  return a.throughputTps * 3600 * HOURS_PER_MONTH * a.utilization;
}

export interface SelfHostResult {
  monthly: number;
  capacityTokens: number;
  demandTokens: number;
  saturated: boolean;
  costPerMtok: number;
}

export function selfHostEstimate(
  a: SelfHostAssumptions,
  w: Workload,
): SelfHostResult {
  const monthly = selfHostMonthly(a);
  const capacityTokens = selfHostCapacityTokens(a);
  const { outTok } = tokensPerMonth(w);
  return {
    monthly,
    capacityTokens,
    demandTokens: outTok,
    saturated: outTok > capacityTokens,
    costPerMtok: capacityTokens > 0 ? (monthly / capacityTokens) * 1e6 : 0,
  };
}

/**
 * Break-even requests/day: the volume at which a fixed self-host cost equals
 * the linear API cost for `model` at the current token profile.
 */
export function breakEvenRequestsPerDay(
  model: CatalogModel,
  w: Workload,
  selfHostCost: number,
): number {
  const api = apiMonthlyCost(model, w);
  if (api.perRequest <= 0) return Infinity;
  return selfHostCost / DAYS / api.perRequest;
}

/** A coarse "intelligence" score for the cost-vs-capability frontier axis. */
export function capabilityScore(model: CatalogModel, benchmarkKey: string): number | undefined {
  return model.benchmarks.find((b) => b.key === benchmarkKey)?.score;
}

export const DEFAULT_WORKLOAD: Workload = {
  requestsPerDay: 50000,
  avgInputTokens: 1200,
  avgOutputTokens: 400,
  cachedRatio: 0.3,
  peakFactor: 3,
};

export const DEFAULT_SELFHOST: SelfHostAssumptions = {
  gpuHourly: 2.5,
  gpuCount: 2,
  throughputTps: 110,
  utilization: 0.5,
  overhead: 0.25,
};
