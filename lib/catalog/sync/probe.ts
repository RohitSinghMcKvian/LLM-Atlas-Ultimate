import type { ProviderRuntime } from "@/lib/router";
import type { ProviderId } from "../types";

// Liveness probing for zero-cost routes.
//
// A provider's `/v1/models` is a *catalogue*, not an availability list. NVIDIA
// NIM is the worst offender: probing all 41 routes the catalog had published,
// **11 answered `404 Function not found` and 7 hung past 25 s** — and one of the
// hangers, `meta/llama-3.3-70b-instruct`, hangs for 55 s under a direct curl.
// Publishing those fills the picker with entries that fail the moment a user
// selects one, which is worse than not offering them.
//
// So a zero-cost route has to earn its place with a one-token request. Three
// constraints shape this:
//
//   * **Budgeted.** A sync must not make ~100 inference calls or blow a
//     serverless timeout, so the stage is bounded by wall clock *and* count, and
//     verdicts are cached in the snapshot record.
//   * **Sticky but not permanent.** A definitive 404 retires a route at once. A
//     timeout or 5xx is ambiguous — it takes `STRIKE_LIMIT` consecutive failures,
//     which across daily syncs means ≥24 h apart, so a blip cannot retire a
//     working model.
//   * **Never metered.** Only routes that cost nothing are probed. Probing a paid
//     OpenRouter model would spend real money for information the request path
//     gets for free (a 402/404 at use time).
//
// Note what is deliberately *not* here any more: the old rule "models NIM and
// OpenRouter both list are never probed". Its premise was that the OpenRouter
// route keeps working anyway — but `ROUTE_PRIORITY` dials NVIDIA first, and the
// old router aborted failover on a 404, so those models were unreachable. That
// exclusion is exactly why 11 dead routes shipped.

/** Consecutive ambiguous failures before a route is treated as dead. */
export const STRIKE_LIMIT = 2;

export type ProbeReason = "ok" | "not_found" | "timeout" | "server_error" | "network";

export interface RouteHealthEntry {
  ok: boolean;
  checkedAt: string;
  /** Consecutive ambiguous failures. Retires the route at `STRIKE_LIMIT`. */
  strikes?: number;
  /** Why the last probe landed where it did. Surfaced in the sync report. */
  reason?: ProbeReason;
}

export type RouteHealth = Record<string, RouteHealthEntry>;

/** One route to check. */
export interface ProbeTarget {
  provider: ProviderId;
  /** The provider-side model id. */
  model: string;
}

/**
 * Health key for a route.
 *
 * Provider-scoped, because the same model id is served by several providers once
 * Groq and Google are configured (`llama-3.3-70b-versatile` vs
 * `meta/llama-3.3-70b-instruct` differ, but `openai/gpt-oss-20b` does not) and a
 * bare id would let one provider's verdict retire another's route.
 */
export function healthKey(provider: ProviderId, model: string): string {
  return `${provider}:${model}`;
}

/**
 * Look up a verdict, tolerating the pre-migration bare-id keys.
 *
 * Records written before route health became provider-scoped keyed NVIDIA
 * verdicts by the bare model id. Accepting both means an existing snapshot keeps
 * its accumulated verdicts instead of re-probing everything once.
 */
export function readHealth(
  health: RouteHealth,
  provider: ProviderId,
  model: string,
): RouteHealthEntry | undefined {
  return health[healthKey(provider, model)] ?? health[model];
}

/** How long a verdict stands before it is worth re-checking. */
const RECHECK_MS = {
  // A route that worked a month ago is a weak claim, and several of the models
  // that now hang presumably passed once.
  ok: 7 * 86_400_000,
  failed: 7 * 86_400_000,
};

export function isVerdictFresh(entry: RouteHealthEntry | undefined, now: number): boolean {
  if (!entry) return false;
  const age = now - Date.parse(entry.checkedAt);
  if (!Number.isFinite(age)) return false;
  // A route that is still passing but carries strikes is *unresolved*, so it is
  // never "fresh" — it must be probed again next run to either clear the strike or
  // earn the next one. Without this the first ambiguous result froze the entry as
  // fresh-and-ok for a week, the strike count never reached STRIKE_LIMIT, and a
  // permanently hanging route stayed published. That is exactly how
  // `meta/llama-3.3-70b-instruct` (55 s hang) survived in the Free tab.
  //
  // A *retired* route (`ok: false`) is settled and only worth an occasional
  // re-check, in case the provider brings it back.
  if (entry.ok && (entry.strikes ?? 0) > 0) return false;
  return age < (entry.ok ? RECHECK_MS.ok : RECHECK_MS.failed);
}

export interface ProbeBudget {
  /** Wall-clock ceiling for the whole probe stage. */
  ms: number;
  /** Hard cap on probes regardless of speed. */
  max: number;
  /** Per-probe timeout. Doubles as a latency SLO — see the note in the plan. */
  timeoutMs: number;
  concurrency: number;
}

export const DEFAULT_BUDGET: ProbeBudget = {
  ms: 25_000,
  max: 60,
  timeoutMs: 10_000,
  concurrency: 8,
};

/**
 * Routes worth spending a probe on this run.
 *
 * Ordered so that a provider with **no cached verdicts at all** goes first. That
 * is what makes adding `GROQ_API_KEY` converge in a single run instead of
 * starving behind a queue of stale NVIDIA rechecks.
 */
export function selectProbeTargets(
  candidates: readonly ProbeTarget[],
  health: RouteHealth,
  budget: number,
  now = Date.now(),
): ProbeTarget[] {
  const stale = candidates.filter(
    (t) => !isVerdictFresh(readHealth(health, t.provider, t.model), now),
  );

  const known = new Set<ProviderId>();
  for (const t of candidates) {
    if (readHealth(health, t.provider, t.model)) known.add(t.provider);
  }

  const rank = (t: ProbeTarget): number => {
    // Unknown provider first, then never-checked ids, then longest-stale.
    if (!known.has(t.provider)) return -2;
    const entry = readHealth(health, t.provider, t.model);
    if (!entry) return -1;
    return Date.parse(entry.checkedAt) || 0;
  };

  return [...stale].sort((a, b) => rank(a) - rank(b)).slice(0, Math.max(0, budget));
}

export type ProbeVerdict = "ok" | "dead" | "inconclusive" | "rate_limited";

export type ProbeResult = { status: number } | { error: "timeout" | "network" };

/**
 * What one probe response means. Pure, so every branch is testable without a
 * network.
 *
 * A 401/403 is the *key* being wrong, never the model — it must not blame the
 * route (see `applyVerdict`, which writes nothing for it).
 */
export function classifyProbeResult(r: ProbeResult): ProbeVerdict {
  if ("error" in r) return "inconclusive";
  const { status } = r;
  if (status >= 200 && status < 300) return "ok";
  if (status === 404 || status === 400 || status === 422) return "dead";
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "rate_limited"; // write nothing
  return "inconclusive";
}

/**
 * Fold a verdict into the stored entry, or return `null` to write nothing.
 *
 * `null` for `rate_limited` (and for auth failures, which classify the same way)
 * because neither says anything about the model. Everything else *is* written —
 * including an inconclusive timeout, which is the fix for the old behaviour where
 * a hang cached no verdict at all and the 7 hanging models were re-probed
 * forever without ever being retired.
 */
export function applyVerdict(
  prev: RouteHealthEntry | undefined,
  verdict: ProbeVerdict,
  now: string,
  reason: ProbeReason = "ok",
): RouteHealthEntry | null {
  switch (verdict) {
    case "ok":
      return { ok: true, checkedAt: now, strikes: 0, reason: "ok" };
    case "dead":
      return { ok: false, checkedAt: now, strikes: STRIKE_LIMIT, reason: "not_found" };
    case "rate_limited":
      return null;
    case "inconclusive": {
      const strikes = (prev?.strikes ?? 0) + 1;
      return {
        ok: strikes < STRIKE_LIMIT ? (prev?.ok ?? true) : false,
        checkedAt: now,
        strikes,
        reason,
      };
    }
  }
}

export interface ProbeOptions {
  /** Runtime per provider. A target whose provider is absent is skipped. */
  runtimes: Partial<Record<ProviderId, ProviderRuntime>>;
  /** Existing verdicts, so an inconclusive result can accumulate a strike. */
  previousHealth?: RouteHealth;
  budget?: Partial<ProbeBudget>;
  now?: string;
  signal?: AbortSignal;
}

/** Ask for a single token and see what the provider says. */
async function probeOne(
  target: ProbeTarget,
  runtime: ProviderRuntime,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  try {
    const res = await fetch(`${runtime.baseUrl}/chat/completions`, {
      method: "POST",
      headers: runtime.headers,
      body: JSON.stringify({
        model: target.model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
        stream: false,
      }),
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
    });
    // Drain so the connection can be reused for the next probe.
    await res.arrayBuffer().catch(() => undefined);
    return { status: res.status };
  } catch (e) {
    const name = (e as Error).name;
    return { error: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
}

export interface ProbeRunResult {
  /** Entries to merge into the record. Omits anything that must not be written. */
  health: RouteHealth;
  /** Per-key verdict for this run, for the sync report. */
  verdicts: Record<string, ProbeVerdict>;
  /** Providers that rate-limited and were abandoned for the rest of the run. */
  rateLimited: ProviderId[];
}

/**
 * Probe `targets` with bounded concurrency, wall clock and count.
 *
 * A 429 abandons the rest of that provider for the run: it is cheap to detect,
 * and one rate-limited provider must not eat the whole budget while another goes
 * unchecked.
 */
export async function probeModels(
  targets: readonly ProbeTarget[],
  options: ProbeOptions,
): Promise<ProbeRunResult> {
  const budget = { ...DEFAULT_BUDGET, ...options.budget };
  const now = options.now ?? new Date().toISOString();
  const deadline = Date.now() + budget.ms;

  const queue = targets.slice(0, budget.max);
  const health: RouteHealth = {};
  const verdicts: Record<string, ProbeVerdict> = {};
  const rateLimited = new Set<ProviderId>();
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      if (options.signal?.aborted) return;
      if (Date.now() >= deadline) return;
      const target = queue[cursor++];
      if (!target) return;
      if (rateLimited.has(target.provider)) continue;

      const runtime = options.runtimes[target.provider];
      if (!runtime) continue;

      const result = await probeOne(target, runtime, budget.timeoutMs, options.signal);
      const verdict = classifyProbeResult(result);
      const key = healthKey(target.provider, target.model);
      verdicts[key] = verdict;

      if (verdict === "rate_limited") {
        rateLimited.add(target.provider);
        continue;
      }

      const reason: ProbeReason =
        verdict === "ok"
          ? "ok"
          : verdict === "dead"
            ? "not_found"
            : "error" in result
              ? result.error
              : "server_error";

      const entry = applyVerdict(
        readHealth(options.previousHealth ?? {}, target.provider, target.model),
        verdict,
        now,
        reason,
      );
      if (entry) health[key] = entry;
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(budget.concurrency, queue.length) }, worker),
  );

  return { health, verdicts, rateLimited: [...rateLimited] };
}
