import { getProviderRuntime, type ProviderRuntime } from "@/lib/router";
import { BASELINE_SNAPSHOT } from "../baseline";
import type { CatalogSnapshotRecord, CatalogSourceResult } from "../snapshot";
import type { ProviderId } from "../types";
import { fetchJson } from "./fetch";
import { mergeSnapshot } from "./merge";
import { normalizeNvidia } from "./nvidia";
import { normalizeOpenRouter } from "./openrouter";
import {
  healthKey,
  probeModels,
  selectProbeTargets,
  type ProbeRunResult,
  type ProbeTarget,
  type ProbeVerdict,
  type RouteHealth,
} from "./probe";
import type { ModelDraft, NvidiaModel, OpenRouterModel } from "./types";

/**
 * Providers whose routes are worth a liveness probe.
 *
 * All operator-funded, so probing costs nothing but time. `local` is excluded:
 * it is the user's own machine, and a probe on every sync would be rude.
 */
const PROBEABLE_PROVIDERS: ProviderId[] = ["nvidia", "openrouter", "groq", "google"];

// Orchestration: fetch both provider lists, normalize, reconcile, return a new
// record. Deliberately does NOT install the result — see `lib/catalog/snapshot.ts`
// for why the pointer may only be written from a render body or a post-hydration
// effect. The caller persists and revalidates instead.

export { mergeSnapshot, ROUTE_PRIORITY, REMOVAL_GRACE_SYNCS } from "./merge";
export { normalizeOpenRouter } from "./openrouter";
export { normalizeNvidia, draftFromNvidiaId, NON_CHAT_PATTERNS, isChatCapable } from "./nvidia";
export {
  probeModels,
  selectProbeTargets,
  classifyProbeResult,
  applyVerdict,
  healthKey,
  readHealth,
  STRIKE_LIMIT,
  type RouteHealth,
  type ProbeTarget,
  type ProbeVerdict,
} from "./probe";
export { NON_CHAT_RULES, META_ROUTER_RULES, isDeniedAtlasId } from "./denylist";

/** Blended $/Mtok ceiling below which an open-weight model is served free. */
function freeOpenCeiling(): number {
  const raw = Number(process.env.ATLAS_FREE_OPEN_CEILING_PER_M ?? 0);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

interface ProviderListResult<T> {
  data: T[] | null;
  result: CatalogSourceResult;
}

async function fetchProviderModels<T>(
  provider: ProviderId,
  signal?: AbortSignal,
): Promise<ProviderListResult<T>> {
  // Reuses the router's runtime resolution verbatim, so base-URL overrides
  // (`NVIDIA_BASE_URL`, `OPENROUTER_BASE_URL`), auth, and OpenRouter's
  // attribution headers all behave exactly as they do for inference.
  const runtime = getProviderRuntime(provider);
  if (!runtime) {
    return { data: null, result: { status: "skipped", count: 0, error: "no API key configured" } };
  }

  const startedAt = Date.now();
  try {
    const body = await fetchJson<{ data?: T[] } | T[]>(
      `${runtime.baseUrl}/models`,
      runtime.headers,
      { signal },
    );
    const data = Array.isArray(body) ? body : (body.data ?? []);
    if (!Array.isArray(data) || data.length === 0) {
      return {
        data: null,
        result: {
          status: "failed",
          count: 0,
          ms: Date.now() - startedAt,
          error: "empty model list",
        },
      };
    }
    return {
      data,
      result: { status: "ok", count: data.length, ms: Date.now() - startedAt },
    };
  } catch (err) {
    return {
      data: null,
      result: {
        status: "failed",
        count: 0,
        ms: Date.now() - startedAt,
        error: err instanceof Error ? err.message : "unknown error",
      },
    };
  }
}

/**
 * Zero-cost routes probed per run.
 *
 * Bounded so one sync cannot make hundreds of inference calls or blow a
 * serverless timeout. Verdicts are cached in the record, so the catalog converges
 * over a few runs and the steady state probes almost nothing.
 */
const PROBE_BUDGET = 60;

export interface RunSyncOptions {
  previous?: CatalogSnapshotRecord | null;
  signal?: AbortSignal;
  now?: string;
  /** Override the probe budget. `0` disables probing (used by tests). */
  probeBudget?: number;
}

export interface RunSyncResult {
  record: CatalogSnapshotRecord;
  /** Whether at least one provider list was fetched successfully. */
  ok: boolean;
  /** Entries excluded as non-chat endpoints — useful when auditing a run. */
  excludedNonChat: string[];
  /** Route keys probed this run, and what each verdict was. */
  probed: Record<string, ProbeVerdict>;
  /** Providers that rate-limited the probe stage. */
  rateLimited: ProviderId[];
}

/**
 * One full catalog sync.
 *
 * Both providers are polled concurrently and independently: whichever comes back
 * contributes, and a failure is recorded in `sources` rather than thrown, because
 * `mergeSnapshot` needs to know *which* list failed to decide what it is allowed
 * to remove.
 */
export async function runSync(options: RunSyncOptions = {}): Promise<RunSyncResult> {
  const now = options.now ?? new Date().toISOString();
  const today = now.slice(0, 10);

  const [or, nv] = await Promise.all([
    fetchProviderModels<OpenRouterModel>("openrouter", options.signal),
    fetchProviderModels<NvidiaModel>("nvidia", options.signal),
  ]);

  let openrouterDrafts: ModelDraft[] | null = null;
  if (or.data) {
    openrouterDrafts = normalizeOpenRouter(or.data, {
      today,
      freeOpenCeilingPerM: freeOpenCeiling(),
    });
  }

  let nvidiaChat: NvidiaModel[] | null = null;
  let excludedNonChat: string[] = [];
  if (nv.data) {
    const normalized = normalizeNvidia(nv.data);
    nvidiaChat = normalized.chat;
    excludedNonChat = normalized.excluded;
  }

  const probed = await probeFreeRoutes({
    nvidia: nvidiaChat,
    drafts: openrouterDrafts,
    previousHealth: options.previous?.routeHealth ?? {},
    budget: options.probeBudget ?? PROBE_BUDGET,
    now,
    signal: options.signal,
  });

  const record = mergeSnapshot({
    overlay: BASELINE_SNAPSHOT.models,
    openrouter: openrouterDrafts,
    nvidia: nvidiaChat,
    previous: options.previous ?? null,
    sources: { openrouter: or.result, nvidia: nv.result },
    routeHealth: probed.health,
    now,
  });

  return {
    record,
    ok: or.result.status === "ok" || nv.result.status === "ok",
    excludedNonChat,
    probed: probed.verdicts,
    rateLimited: probed.rateLimited,
  };
}

interface ProbeStageInput {
  nvidia: NvidiaModel[] | null;
  drafts: ModelDraft[] | null;
  previousHealth: RouteHealth;
  budget: number;
  now: string;
  signal?: AbortSignal;
}

/**
 * Check liveness of every zero-cost route on a configured provider.
 *
 * Two things changed here relative to the original design, both because it was
 * measured wrong:
 *
 *   * **Cross-listed models are no longer skipped.** The old rule assumed a dead
 *     NVIDIA route was harmless because OpenRouter also served the model — but
 *     `ROUTE_PRIORITY` dials NVIDIA first and the old router aborted failover on a
 *     404, so those models were simply unreachable. 11 of them shipped that way.
 *   * **`:free` OpenRouter routes are probed too**, since they are the only
 *     OpenRouter routes a zero-credit key can serve and are therefore load-bearing
 *     for the Free tab.
 *
 * Metered routes are never probed: it would spend real money to learn something
 * the request path reports for free.
 */
async function probeFreeRoutes({
  nvidia,
  drafts,
  previousHealth,
  budget,
  now,
  signal,
}: ProbeStageInput): Promise<ProbeRunResult> {
  const empty: ProbeRunResult = { health: {}, verdicts: {}, rateLimited: [] };
  if (budget <= 0) return empty;

  const runtimes: Partial<Record<ProviderId, ProviderRuntime>> = {};
  for (const provider of PROBEABLE_PROVIDERS) {
    const runtime = getProviderRuntime(provider);
    if (runtime) runtimes[provider] = runtime;
  }

  const targets: ProbeTarget[] = [];
  const seen = new Set<string>();
  const push = (provider: ProviderId, model: string) => {
    if (!runtimes[provider]) return;
    const key = healthKey(provider, model);
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ provider, model });
  };

  for (const nv of nvidia ?? []) push("nvidia", nv.id);
  for (const d of drafts ?? []) {
    for (const r of d.model.routes) {
      // Only the zero-cost ones. `:free` is OpenRouter's marker; the other
      // providers here are operator-funded by definition.
      if (r.provider === "openrouter" && !r.model.endsWith(":free")) continue;
      push(r.provider, r.model);
    }
  }

  const selected = selectProbeTargets(targets, previousHealth, budget, Date.parse(now));
  if (selected.length === 0) return empty;

  return probeModels(selected, { runtimes, previousHealth, now, signal });
}
