// Atlas Router — a unified, OpenAI-compatible inference gateway.
// Server-only. Free routes prefer the operator's env keys; metered ones run on
// the USER's own key for that provider, passed per-request and never persisted
// or logged. A user key can stand in for a missing operator key on any
// provider, which is what makes someone's own free Groq or Z.ai tier usable.
import { PROVIDERS, PROVIDER_LIST, getModelById } from "@/lib/catalog";
import { modelAvailability, type RouteEnv } from "@/lib/catalog/availability";
import type { CatalogModel, ProviderId, ModelRoute } from "@/lib/catalog/types";
import { MAX_IMAGES_PER_TURN, readImages, type GeneratedImage } from "./images";
import { userKeyProviders, type UserKeys } from "./user-keys";
import {
  buildAnthropicBody,
  endpointFor,
  newFrameState,
  normalizeFrame,
  protocolHeaders,
  type WireProtocol,
} from "./protocol";
import { rejectsTools } from "@/lib/chat/tool-support";
import { dropExhausted, recordSpend as recordLaneSpend } from "@/lib/quota";

/** A single part of a multimodal message (vision). */
export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  /** Plain text, or multimodal parts for vision-capable models. */
  content: string | ChatContentPart[];
  /** Assistant turns that requested tools carry the calls here. */
  tool_calls?: ToolCallRequest[];
  /** Tool-result turns reference the call they answer. */
  tool_call_id?: string;
  /** Optional name (tool messages / named function results). */
  name?: string;
}

/** An OpenAI-compatible tool (function) definition offered to the model. */
export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/** A tool call the model asked for, as carried on an assistant message. */
export interface ToolCallRequest {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** A normalized tool call surfaced from the stream. */
export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON argument string (may be empty until fully streamed). */
  arguments: string;
}

/** Token accounting normalized across providers. */
export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /**
   * The subset of `completionTokens` that a generated image is made of (§P13).
   *
   * A subset, not an addition — providers count image tokens inside the
   * completion total — so a consumer must subtract before pricing the rest, or
   * it charges those tokens twice.
   */
  imageTokens?: number;
}

/**
 * The typed event stream every inference call produces (§3.1). Content and
 * reasoning arrive as separate token streams; tool calls and usage are
 * normalized across providers. Fetch/routing failures throw `RouterError`
 * instead of emitting an event — the API layer converts those to `error`
 * frames on the wire.
 */
export type RouterEvent =
  | { type: "token"; text: string }
  | { type: "reasoning"; text: string }
  /** An image the model produced, as a data: or https: URL. */
  | { type: "image"; image: GeneratedImage }
  | { type: "tool_call"; call: ToolCall }
  | { type: "usage"; usage: Usage }
  | { type: "done"; finishReason?: string }
  /** The provider that actually served the request — may differ from the
   *  caller's pre-flight resolveRoute() when a free model fell through to a
   *  backup provider after a 429/5xx from the first-choice one. */
  | { type: "provider"; provider: ProviderId }
  /**
   * The request was retried with something removed because the route rejected
   * it. Emitted before the first token so the caller can both tell the user and
   * remember the fact — sending `tools` to a route that has already refused them
   * costs a round trip on every subsequent turn.
   */
  | { type: "capability"; capability: "tools"; supported: false };

/**
 * User-supplied keys, forwarded from the browser for a single request.
 * SECURITY: never persist these, never log them, never echo them in responses.
 *
 * Defined in `./user-keys` because the browser has to build the headers this
 * type describes, and that module is importable from both sides. Re-exported
 * here so the ~20 existing `from "@/lib/router"` imports keep working.
 */
export type { UserKeys } from "./user-keys";

export interface ProviderRuntime {
  id: ProviderId;
  baseUrl: string;
  apiKey?: string;
  headers: Record<string, string>;
  /** Wire shape this upstream speaks. See `./protocol`. */
  protocol: WireProtocol;
  /**
   * Whose allowance this attempt spends.
   *
   * The quota ledger meters `"operator"` only: when the user brought their own
   * key the quota is theirs, and the operator's counters have no authority over
   * it. `runtimeFor` decides which key is preferred; this records the outcome so
   * nothing downstream has to re-derive it from `userKeys` and get it wrong.
   */
  credential: "operator" | "user";
}

export interface ResolvedRoute {
  model: CatalogModel;
  route: ModelRoute;
  runtime: ProviderRuntime;
}

/** One attempted upstream call, recorded so the final error can explain itself. */
export interface RouteAttempt {
  provider: ProviderId;
  /** The provider-side model id we asked for. */
  routeModel: string;
  status?: number;
  error?: "timeout" | "network" | "stalled";
  /** First ~200 chars of the upstream body, credentials scrubbed. */
  detail?: string;
  ms: number;
}

export class RouterError extends Error {
  code:
    | "no_provider_configured"
    | "model_not_found"
    | "no_route"
    | "key_required"
    | "upstream_error"
    /** Every route answered 402 — the key has no credit. */
    | "no_credit"
    /** Every route answered 404 — the provider no longer serves it. */
    | "route_dead"
    /** Every route answered 401/403 — the key that carried them is bad. */
    | "provider_key_invalid"
    /** Every route answered 429 — free tiers cap requests per minute. */
    | "rate_limited"
    /**
     * Every free route's allowance is already spent for this window, so none
     * was attempted. Distinct from `rate_limited`, which is the provider
     * refusing after the fact — this one never left the building.
     */
    | "quota_exhausted"
    /** Every route hung. */
    | "all_routes_timed_out"
    /** Mixed failures across every route. */
    | "all_routes_failed";
  status: number;
  /** Populated when the failure happened after routing, one entry per try. */
  attempts?: RouteAttempt[];
  /**
   * How long until the request could succeed, when that is knowable. Lets the
   * client say *when* rather than only *no*.
   */
  retryAfterMs?: number;
  constructor(
    code: RouterError["code"],
    message: string,
    status = 400,
    attempts?: RouteAttempt[],
  ) {
    super(message);
    this.code = code;
    this.status = status;
    if (attempts?.length) this.attempts = attempts;
  }
}

/**
 * Strip anything that looks like a credential out of an upstream error body.
 * Provider errors sometimes echo the request; a key must never reach a client
 * or a log.
 */
function scrubSecrets(text: string): string {
  // One pattern per credential shape that can reach an upstream. Any provider's
  // key can now arrive as a user credential, so this list tracks `PROVIDERS`:
  // adding a provider without adding its key shape here means a rejected key can
  // be echoed back inside a provider's own error body.
  return text
    .replace(/nvapi-[A-Za-z0-9_-]{8,}/g, "nvapi-***")
    .replace(/sk-or-v1-[A-Za-z0-9]{8,}/g, "sk-or-v1-***")
    .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, "sk-ant-***")
    // Covers OpenAI, DeepSeek and DashScope, which all use a bare `sk-` prefix.
    // Hyphens and underscores are in the class so a segmented key (`sk-ant-…`,
    // `sk-or-v1-…`) is matched whole rather than truncated at the first dash.
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "sk-***")
    .replace(/gsk_[A-Za-z0-9]{16,}/g, "gsk_***")
    .replace(/xai-[A-Za-z0-9]{16,}/g, "xai-***")
    .replace(/csk-[A-Za-z0-9_-]{16,}/g, "csk-***")
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer ***");
}

/**
 * Build a runtime for a provider, or null if it isn't configured.
 * A per-request user key (BYOK) takes precedence over the operator env key for
 * any provider — which is what lets someone bring their own free-tier Groq or
 * Z.ai key and not depend on what the operator chose to fund.
 */
export function getProviderRuntime(
  id: ProviderId,
  userKeys?: UserKeys,
): ProviderRuntime | null {
  const meta = PROVIDERS[id];
  const baseUrl =
    process.env[`${id.toUpperCase()}_BASE_URL`] || meta.defaultBaseUrl;
  let apiKey = meta.apiKeyEnv ? process.env[meta.apiKeyEnv] : undefined;

  // BYOK: the user's own key for this provider (when present) replaces the
  // operator's. `runtimeFor` decides *whether* to prefer it; this just makes it
  // available for every provider rather than OpenRouter alone.
  const userKey = userKeys?.[id];
  if (userKey) apiKey = userKey;

  // Local is only considered available when a base URL is explicitly provided.
  if (id === "local") {
    if (!process.env.LOCAL_BASE_URL) return null;
  } else if (!apiKey) {
    return null;
  }

  const protocol: WireProtocol = meta.protocol ?? "openai";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Anthropic authenticates with `x-api-key` and requires a dated
    // `anthropic-version`; everyone else takes a bearer token.
    ...protocolHeaders(protocol, apiKey),
  };
  if (id === "openrouter") {
    headers["HTTP-Referer"] =
      process.env.OPENROUTER_SITE_URL || "https://llmatlas.xyz";
    headers["X-Title"] = process.env.OPENROUTER_SITE_NAME || "LLM Atlas";
  }
  return {
    id,
    baseUrl,
    apiKey,
    headers,
    protocol,
    credential: userKey ? "user" : "operator",
  };
}

export function configuredProviderIds(): ProviderId[] {
  return PROVIDER_LIST.filter((p) => getProviderRuntime(p.id) !== null).map(
    (p) => p.id,
  );
}

export function isAnyProviderConfigured(): boolean {
  return configuredProviderIds().length > 0;
}

/** The routing inputs that live outside the catalog. */
export function routeEnv(userKeys?: UserKeys): RouteEnv {
  return {
    configured: configuredProviderIds(),
    userKeys: userKeyProviders(userKeys),
    servePaid: process.env.OPERATOR_SERVE_PAID === "true",
    freeCeilingPerM: Number(process.env.ATLAS_FREE_OPEN_CEILING_PER_M ?? 0) || 0,
  };
}

/**
 * A runtime for one route.
 *
 * For a free route the operator's key is preferred, so a user's own OpenRouter
 * key isn't spent (and rate-limited) on `:free` variants the operator can serve.
 * For a metered route the user's key comes first — the operator must never
 * silently pay unless `OPERATOR_SERVE_PAID` says so.
 */
function runtimeFor(
  route: ModelRoute,
  cost: "free" | "metered",
  userKeys?: UserKeys,
): ProviderRuntime | null {
  if (cost === "free") {
    return getProviderRuntime(route.provider) ?? getProviderRuntime(route.provider, userKeys);
  }
  return getProviderRuntime(route.provider, userKeys) ?? getProviderRuntime(route.provider);
}

/**
 * Every route worth attempting for this model, in failover order.
 *
 * Ordering and cost come from `modelAvailability` — the same function the pickers
 * use — so what the UI labels and what the server dials can't diverge. Notably
 * a `free` verdict yields *only* zero-cost routes, which is what makes the
 * "advance on every failure" policy in `streamChatEvents` safe.
 */
export function resolveCandidates(
  modelId: string,
  userKeys?: UserKeys,
): ResolvedRoute[] {
  const model = getModelById(modelId);
  if (!model) throw new RouterError("model_not_found", `Unknown model: ${modelId}`, 404);
  if (model.routes.length === 0)
    throw new RouterError("no_route", `${model.name} has no routable provider`, 422);

  const env = routeEnv(userKeys);
  const availability = modelAvailability(model, env);

  if (availability.kind === "needs_key") {
    throw new RouterError(
      "key_required",
      `${model.name} is a paid model — add your OpenRouter key to use it.`,
      402,
    );
  }

  if (availability.kind === "unavailable") {
    if (availability.reason === "no_free_route") {
      throw new RouterError(
        "no_provider_configured",
        `${model.name} has no free route on the connected providers.`,
        503,
      );
    }
    throw new RouterError(
      "no_provider_configured",
      `No connected provider can serve ${model.name}. The operator must add a key (NVIDIA_API_KEY, GOOGLE_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, or LOCAL_BASE_URL).`,
      503,
    );
  }

  const cost = availability.kind === "free" ? "free" : "metered";
  const resolved: ResolvedRoute[] = [];
  for (const route of availability.candidates) {
    const runtime = runtimeFor(route, cost, userKeys);
    if (runtime) resolved.push({ model, route, runtime });
  }

  if (resolved.length === 0) {
    // `modelAvailability` said a provider was configured but no runtime built —
    // only reachable if the env changed between the two reads.
    throw new RouterError(
      "no_provider_configured",
      `No connected provider can serve ${model.name}.`,
      503,
    );
  }
  return resolved;
}

/**
 * The single route that would serve a model right now. Thin wrapper over
 * {@link resolveCandidates} kept for the API routes that only need the provider
 * name for a pre-flight check.
 *
 * Deliberately does NOT consult the quota ledger: it is a synchronous naming
 * helper, and a route it names may still be skipped by
 * {@link resolveServableCandidates} when the turn is actually spent.
 */
export function resolveRoute(modelId: string, userKeys?: UserKeys): ResolvedRoute {
  return resolveCandidates(modelId, userKeys)[0];
}

/** "45s" / "12m" / "3h" — enough to answer "when", not a duration library. */
function humanizeMs(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.ceil(m / 60)}h`;
}

/**
 * Candidates that are both routable and still have allowance left.
 *
 * `resolveCandidates` is synchronous and pure; reading the ledger is neither,
 * which is why this is a separate async step rather than a condition inside it.
 *
 * An exhausted lane is **skipped, never attempted**. That is the entire reason
 * to keep a ledger instead of reacting to 429s: reacting costs a round trip,
 * and on a provider that counts rejected requests it digs the hole deeper.
 *
 * Only operator-funded lanes can be blocked — a route carrying the user's own
 * key spends their allowance, which Atlas neither owns nor can observe.
 */
export async function dropExhaustedCandidates(
  candidates: ResolvedRoute[],
  userKeys?: UserKeys,
  now: number = Date.now(),
): Promise<ResolvedRoute[]> {
  const { blocked, retryAfterMs } = await dropExhausted(
    candidates.map((cand) => ({
      cand,
      provider: cand.route.provider,
      operatorFunded: cand.runtime.credential === "operator",
    })),
    now,
  );

  const spent = new Set(blocked);
  const keep: ResolvedRoute[] = [];
  for (const cand of candidates) {
    if (!(cand.runtime.credential === "operator" && spent.has(cand.route.provider))) {
      keep.push(cand);
      continue;
    }
    // The operator's allowance on this lane is gone — but the user may hold
    // their own key for it, and that quota is untouched.
    //
    // `runtimeFor` deliberately prefers the operator's key on a free route, so
    // a BYOK user's key normally sits unused. That is right while the operator
    // can still pay and wrong the moment they cannot: without this the app
    // would tell someone to connect a key they had already connected. Rebuilt
    // in place so failover order is preserved.
    const runtime = getProviderRuntime(cand.route.provider, userKeys);
    if (runtime?.credential === "user") keep.push({ ...cand, runtime });
  }
  if (keep.length > 0) return keep;

  const model = candidates[0].model;
  const lanes = blocked.map((id) => PROVIDERS[id].name).join(", ");
  const err = new RouterError(
    "quota_exhausted",
    `${model.name} has used up the free allowance on ${lanes} for now. ` +
      `It resets in about ${humanizeMs(retryAfterMs)} — or connect your own ` +
      `key in the Vault to keep going straight away.`,
    429,
  );
  err.retryAfterMs = retryAfterMs;
  throw err;
}

/** Resolve and filter in one step, for callers that need no other view. */
export async function resolveServableCandidates(
  modelId: string,
  userKeys?: UserKeys,
  now: number = Date.now(),
): Promise<ResolvedRoute[]> {
  return dropExhaustedCandidates(resolveCandidates(modelId, userKeys), userKeys, now);
}

export interface StreamParams {
  modelId: string;
  messages: ChatMessage[];
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  /** Stop sequences. */
  stop?: string[];
  seed?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  /** Thinking budget for reasoning models that support it. */
  reasoningEffort?: "low" | "medium" | "high";
  /** text / JSON object / JSON schema output constraint. */
  responseFormat?:
    | { type: "text" }
    | { type: "json_object" }
    | { type: "json_schema"; json_schema: Record<string, unknown> };
  /** Tools the model may call. */
  tools?: ToolDef[];
  toolChoice?:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; function: { name: string } };
  signal?: AbortSignal;
  userKeys?: UserKeys;
}

/**
 * Params a provider's OpenAI-compat layer rejects with a 400 (verified live);
 * they are dropped from the request body for that provider.
 */
const UNSUPPORTED_PARAMS: Partial<Record<ProviderId, readonly string[]>> = {
  groq: ["top_k"],
  google: ["top_k", "seed", "frequency_penalty", "presence_penalty"],
};

/**
 * Whether a 422/400 is the provider objecting to `stream_options` specifically.
 *
 * Not every OpenAI-compatible endpoint accepts it. NVIDIA NIM is inconsistent
 * *per model*: `openai/gpt-oss-120b` is fine, while `google/gemma-2-2b-it`
 * answers `422 body -> stream_options Extra inputs are not permitted`. Since it
 * only carries token accounting, retrying without it turns a hard failure into a
 * working model that reports no usage.
 */
function rejectsStreamOptions(status: number, body: string): boolean {
  return (status === 422 || status === 400) && /stream_options/i.test(body);
}

/**
 * `rejectsTools` — whether a 400/422 is the provider objecting to `tools` — is
 * the exact counterpart of `rejectsStreamOptions` above, with the same remedy:
 * re-queue the route with the offending field removed rather than burning it. It
 * lives in `lib/chat/tool-support.ts` because the client needs the same verdict
 * to decide whether to keep offering tools, and one matcher cannot drift from
 * itself. That module is where it is tested against real provider bodies.
 */

/** Build the OpenAI-compatible request body, omitting undefined params. */
function buildBody(
  route: ModelRoute,
  p: StreamParams,
  omitStreamOptions = false,
  omitTools = false,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: route.model,
    messages: p.messages,
    temperature: p.temperature ?? 0.7,
    stream: true,
    ...(omitStreamOptions ? {} : { stream_options: { include_usage: true } }),
  };
  if (p.topP !== undefined) body.top_p = p.topP;
  if (p.topK !== undefined) body.top_k = p.topK;
  if (p.maxTokens) body.max_tokens = p.maxTokens;
  if (p.stop && p.stop.length) body.stop = p.stop;
  if (p.seed !== undefined) body.seed = p.seed;
  if (p.frequencyPenalty !== undefined) body.frequency_penalty = p.frequencyPenalty;
  if (p.presencePenalty !== undefined) body.presence_penalty = p.presencePenalty;
  if (p.reasoningEffort) body.reasoning_effort = p.reasoningEffort;
  if (p.responseFormat) body.response_format = p.responseFormat;
  if (!omitTools && p.tools && p.tools.length) {
    body.tools = p.tools;
    if (p.toolChoice) body.tool_choice = p.toolChoice;
  }
  for (const key of UNSUPPORTED_PARAMS[route.provider] ?? []) delete body[key];
  return body;
}

/**
 * How long we wait for response *headers*. A provider that has not answered by
 * now is treated as down and the next route is tried.
 */
export const CONNECT_TIMEOUT_MS = 10_000;

/**
 * Headers → first byte of the stream. `fetch` resolves on headers, so a provider
 * can accept the request and then hang forever; NVIDIA NIM does exactly that for
 * several advertised models (`meta/llama-3.3-70b-instruct` hung for 55 s under a
 * direct curl). This is the window that catches it, and it is the last point at
 * which failing over is still possible.
 */
export const FIRST_CHUNK_TIMEOUT_MS = 20_000;

/**
 * Gap between chunks once tokens are flowing. Generous, because a long
 * generation legitimately pauses. Past the first chunk we cannot fail over —
 * output has already been shown — so this ends the stream instead.
 */
export const IDLE_TIMEOUT_MS = 60_000;

/**
 * Ceiling on the idle gap, however slow the model claims to be.
 *
 * Past this a silent connection is more likely dead than thinking, and holding
 * it open costs the user the turn either way.
 */
export const MAX_IDLE_TIMEOUT_MS = 300_000;

/** Throughput at which the 60-second constant above was a comfortable gap. */
const BASELINE_TPS = 100;

/**
 * The idle gap for a specific model.
 *
 * `IDLE_TIMEOUT_MS` answers "has this connection died", and 60 s answers it well
 * for a model that emits tokens continuously. It answers it wrongly for a large
 * reasoning model: measured live, mid-build, Nemotron 3 Ultra streamed a hundred
 * reasoning deltas, went quiet while it composed the next step, and was cut off
 * at sixty seconds — reported as `finish_reason: "stalled"`.
 *
 * That is the worst of the failure modes found here, because `stalled` is the
 * one finish reason nothing retries: {@link shouldContinue} declines it by
 * design, on the correct reasoning that a hung connection is the failover
 * layer's problem — and the failover layer cannot act, because the route was
 * committed long ago. So the build ended with an empty assistant message and no
 * error, having spent two rounds and produced nothing.
 *
 * Scaled inversely with throughput and floored at today's value, so a fast model
 * keeps exactly the gap it has now. `GENERATION_SLOWDOWN`'s margin is folded in
 * for the same reason it exists in `build-budget.ts`: the catalog's throughput
 * is a vendor best case, measured at roughly half on the one model this was
 * tested against.
 */
export function idleTimeoutFor(model?: { throughputTps?: number } | null): number {
  const tps = model?.throughputTps;
  if (!tps || tps <= 0) return IDLE_TIMEOUT_MS;
  const scaled = IDLE_TIMEOUT_MS * (BASELINE_TPS / tps) * 2;
  return Math.min(MAX_IDLE_TIMEOUT_MS, Math.max(IDLE_TIMEOUT_MS, Math.round(scaled)));
}

/**
 * How long a **parked** route gets once every other candidate has failed.
 *
 * The two deadlines above are failover deadlines: they answer "should I try
 * somewhere else yet", and ten seconds is the right answer to that. They were
 * being used to answer a second question they cannot answer — "is this provider
 * ever going to reply" — and on a large model the answer to the two questions
 * differs by a minute.
 *
 * Measured, repeatedly, on `nvidia/nemotron-3-ultra-550b-a55b`: **56–60 s to
 * first byte** for a five-token prompt, against 2.6 s for the 120B in the same
 * family and 0.3 s for the 30B. NVIDIA NIM withholds response headers until
 * generation starts, so a 550B model's queue and prefill land inside the connect
 * window. Every route timed out, and a model with a million-token window — the
 * one model in the catalog that exists to do long-context work — could not be
 * called at all.
 *
 * The fix is not a bigger number: raising `CONNECT_TIMEOUT_MS` would make a
 * genuinely dead provider hold the user for a minute before failing over. It is
 * to stop treating "slow" as "dead". A route that misses the eager deadline is
 * **parked, not aborted** — the request stays in flight, the queue moves on to
 * the next candidate immediately, and only if nothing else answers do we come
 * back and wait. Failover stays as fast as it was; the slow route is simply no
 * longer thrown away while it was still working.
 *
 * Parking rather than re-issuing also matters for cost, which is the whole point
 * on a long-context model: aborting and retrying would pay prefill twice on a
 * prompt that can be hundreds of thousands of tokens.
 *
 * Three minutes, because the caller's own `AbortSignal` is still live — Stop
 * works throughout — so this is a backstop against a provider that never
 * answers, not the mechanism the user waits on.
 */
export const PATIENT_DEADLINE_MS = 180_000;

/** Marker for "this promise has not settled inside the deadline". */
const SLOW = Symbol("slow");
type Slow = typeof SLOW;

/**
 * Await `p`, or give up waiting at `ms` — **without** disturbing `p`.
 *
 * The distinction from {@link readWithTimeout} is the whole of the fix above:
 * this reports that something is taking too long, and leaves the caller to
 * decide whether that means abandoning it.
 */
function raceDeadline<T>(p: Promise<T>, ms: number): Promise<T | Slow> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (timer) clearTimeout(timer);
  };
  return Promise.race([
    p.then(
      (v) => {
        clear();
        return v;
      },
      (e) => {
        clear();
        throw e;
      },
    ),
    new Promise<Slow>((resolve) => {
      timer = setTimeout(() => resolve(SLOW), ms);
    }),
  ]);
}

/**
 * Read until the stream produces its first `data:` frame.
 *
 * A route that has sent *bytes* has not necessarily answered. OpenRouter opens
 * every stream with `: OPENROUTER PROCESSING` comment lines while the upstream
 * provider is still queueing — measured on
 * `nvidia/nemotron-3-ultra-550b-a55b:free`, two of them before anything else.
 * Treating those as "this route works" is how a keepalive beats a route that was
 * about to send real tokens: the committed stream then delivers nothing, the
 * better route has already been abandoned, and the turn ends with an empty
 * assistant message and no error to explain it. Seen live, mid-build.
 *
 * Every chunk consumed here is handed back so the parser sees the stream whole.
 */
async function readUntilData(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<{ chunks: Uint8Array[] } | { empty: true } | { err: Error }> {
  const chunks: Uint8Array[] = [];
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) return { empty: true };
      if (!r.value) continue;
      chunks.push(r.value);
      text += decoder.decode(r.value, { stream: true });
      if (/^data:/m.test(text)) return { chunks };
    }
  } catch (err) {
    return { err: err as Error };
  }
}

class ReadTimeout extends Error {}

/** One `reader.read()`, bounded. Throws `ReadTimeout` rather than hanging. */
async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ReadTimeout()), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Turn the recorded attempts into one error a user can act on.
 *
 * `userKeys` is needed only to say *whose* credential was rejected. Now that any
 * provider can be dialled with the user's own key, blaming "the operator key"
 * unconditionally sends someone to check an env var they do not control.
 */
function aggregateFailure(
  model: CatalogModel,
  attempts: RouteAttempt[],
  userKeys?: UserKeys,
): RouterError {
  const list = attempts
    .map((a) => {
      const what = a.error ? `${a.error} after ${Math.round(a.ms)}ms` : `HTTP ${a.status}`;
      // `detail` is the first ~200 chars of the upstream body, already
      // credential-scrubbed where it is recorded. It was being collected and
      // then dropped here, which is how "fetch failed" — the one string that
      // says the address was unreachable — never reached anyone.
      return `${a.provider}/${a.routeModel} ${what}${a.detail ? ` (${a.detail})` : ""}`;
    })
    .join("; ");

  /**
   * Only routes that actually got an HTTP response can testify about a status.
   *
   * These predicates used to run over *every* attempt, which let one
   * unreachable route veto the diagnosis for all the others: a dead
   * `LOCAL_BASE_URL` records `status: undefined`, so `every(a => a.status ===
   * 401)` went false and a genuinely rejected NVIDIA key was reported as the
   * generic `all_routes_failed` instead of "the operator key was rejected".
   * Since `.env.example` shipped `LOCAL_BASE_URL` live, that was the default
   * state of a fresh clone, and it silently disabled every actionable message
   * below.
   *
   * A route that never connected is evidence about reachability, not about
   * whether a key is valid — so it belongs to `all_routes_failed` (which still
   * reads `attempts` in full, via `list`) and to nothing else.
   */
  const answered = attempts.filter((a) => a.status !== undefined);
  /** Status-based verdicts: only routes that got a response may testify. */
  const every = (p: (a: RouteAttempt) => boolean) => answered.length > 0 && answered.every(p);
  /**
   * Transport-based verdicts: judged over *every* attempt, since a route that
   * never answered is exactly the evidence these are about. Keeping this
   * separate is load-bearing — a timeout also carries no `status`, so routing it
   * through `answered` would leave that list empty and downgrade a genuine
   * all-hung request to `all_routes_failed`.
   */
  const everyAttempt = (p: (a: RouteAttempt) => boolean) =>
    attempts.length > 0 && attempts.every(p);
  /** Providers named in a status-based message — never the ones that never answered. */
  const answeredProviders = () => [...new Set(answered.map((a) => a.provider))].join(" / ");

  if (every((a) => a.status === 402)) {
    return new RouterError(
      "no_credit",
      `${model.name} needs a funded key. A zero-credit OpenRouter key can only run ":free" model variants — pick a model from the Free tab, or top up your OpenRouter account.`,
      402,
      attempts,
    );
  }
  if (every((a) => a.status === 404 || a.status === 422)) {
    return new RouterError(
      "route_dead",
      `${model.name} is no longer served by ${answeredProviders()}. The next catalog sync will drop it — please pick another model.`,
      502,
      attempts,
    );
  }
  if (every((a) => a.status === 429)) {
    return new RouterError(
      "rate_limited",
      `${model.name} is rate-limited right now. Free provider tiers cap requests per minute — wait a moment and retry, or pick another model from the Free tab.`,
      429,
      attempts,
    );
  }
  if (every((a) => a.status === 401 || a.status === 403)) {
    // Whose key actually carried these attempts? If every provider that answered
    // was dialled with the user's own credential, the operator cannot help.
    const rejected = [...new Set(answered.map((a) => a.provider))];
    const allUserKeyed = rejected.length > 0 && rejected.every((id) => Boolean(userKeys?.[id]));
    return new RouterError(
      "provider_key_invalid",
      allUserKeyed
        ? `Your ${answeredProviders()} key was rejected. Check it in the Vault, or reconnect it.`
        : `The operator key for ${answeredProviders()} was rejected. Check the provider API key.`,
      502,
      attempts,
    );
  }
  if (everyAttempt((a) => a.error === "timeout")) {
    return new RouterError(
      "all_routes_timed_out",
      `${model.name} did not respond on any route (${list}). The provider is likely overloaded — try another model.`,
      504,
      attempts,
    );
  }
  return new RouterError(
    "all_routes_failed",
    `Every route for ${model.name} failed: ${list}.`,
    502,
    attempts,
  );
}

/**
 * Stream a chat completion as a typed event stream (§3.1): `token`,
 * `reasoning`, `tool_call`, `usage`, `done`. Works across every provider
 * (OpenAI-compatible chat/completions). Routing / transport failures throw
 * `RouterError`; the API layer converts those to `error` frames on the wire.
 *
 * Failover policy: **advance on every failure except a caller abort.** The
 * previous rule — retry only on 429/5xx — meant a 404 from the first route
 * aborted the whole request, and because NVIDIA sorts first in `ROUTE_PRIORITY`,
 * 15 models with a perfectly good OpenRouter route were unreachable. A status
 * table is the wrong shape here: any status classified wrongly strands a working
 * route. Advancing always cannot over-bill, because a `free` verdict from
 * `modelAvailability` contains only zero-cost candidates.
 */
export async function* streamChatEvents(
  params: StreamParams,
): AsyncGenerator<RouterEvent, void, unknown> {
  const resolved = resolveCandidates(params.modelId, params.userKeys);
  // Taken BEFORE the ledger filter, deliberately. `preferred` exists to tell the
  // client when the serving provider differs from what its own pre-flight
  // `resolveRoute` predicted — and that prediction is unfiltered. Reading it off
  // the filtered list would make a ledger-skipped lane look like the intended
  // one and silently suppress the `provider` event.
  const preferred = resolved[0].route.provider;
  const candidates = await dropExhaustedCandidates(resolved, params.userKeys);
  const model = candidates[0].model;

  const attempts: RouteAttempt[] = [];

  interface Committed {
    reader: ReadableStreamDefaultReader<Uint8Array>;
    provider: ProviderId;
    /** Chunks consumed while waiting for the first data frame, replayed intact. */
    first: Uint8Array[];
    /** The committed attempt ran without the `tools` the caller supplied. */
    toolsDropped: boolean;
    /** This attempt spent the operator's allowance, so the ledger counts it. */
    operatorFunded: boolean;
    /** Upstream response headers, read for the provider's own quota figures. */
    responseHeaders: Headers;
  }
  interface QueueItem {
    cand: ResolvedRoute;
    omitStreamOptions: boolean;
    omitTools: boolean;
  }
  /** A route still in flight past its failover deadline. See PATIENT_DEADLINE_MS. */
  interface ParkedRoute {
    /** Wait on it properly, now that nothing else has answered. */
    resume: () => Promise<Committed | null>;
    /** Another route won; stop this one so it is not billed for output nobody reads. */
    abandon: () => void;
  }
  type Outcome =
    | { kind: "committed"; value: Committed }
    | { kind: "requeue"; item: QueueItem }
    | { kind: "failed" }
    | { kind: "slow"; parked: ParkedRoute };

  let committed: Committed | null = null;

  // Token spend for the quota ledger, accumulated across the stream. Requests
  // are counted at commit; tokens cannot be, because nothing knows them yet.
  let billedPrompt = 0;
  let billedCompletion = 0;

  // A work queue rather than a plain loop, so one candidate can be re-queued with
  // a reduced body (see `rejectsStreamOptions`) without duplicating the attempt
  // machinery or letting a compatibility quirk consume a whole route.
  const queue: QueueItem[] = candidates.map((cand) => ({
    cand,
    omitStreamOptions: false,
    omitTools: false,
  }));
  const parked: ParkedRoute[] = [];

  /**
   * One attempt at one route.
   *
   * `patient` is set on the second pass, where there is nothing left to fail
   * over to: missing the deadline there is a real failure rather than a reason
   * to look elsewhere, so nothing is parked.
   */
  const attemptOne = async (item: QueueItem, patient: boolean): Promise<Outcome> => {
    const { cand, omitStreamOptions, omitTools } = item;
    const started = Date.now();
    const record = (patch: Partial<RouteAttempt>) =>
      attempts.push({
        provider: cand.route.provider,
        routeModel: cand.route.model,
        ms: Date.now() - started,
        ...patch,
      });

    // A dedicated controller per attempt. Deliberately NOT `AbortSignal.timeout`
    // handed to `fetch`: that same signal governs the response body, so a 60 s
    // generation would be killed mid-stream by the connect deadline.
    const ac = new AbortController();
    const onCallerAbort = () => ac.abort();
    params.signal?.addEventListener("abort", onCallerAbort, { once: true });
    const release = () => params.signal?.removeEventListener("abort", onCallerAbort);

    // Settled into a value rather than left to reject, so `raceDeadline` can
    // report "still waiting" without also having to catch.
    const fetching = fetch(endpointFor(cand.runtime.protocol, cand.runtime.baseUrl), {
      method: "POST",
      headers: cand.runtime.headers,
      body: JSON.stringify(
        cand.runtime.protocol === "anthropic"
          ? buildAnthropicBody(cand.route, params, omitTools)
          : buildBody(cand.route, params, omitStreamOptions, omitTools),
      ),
      signal: ac.signal,
    }).then(
      (res) => ({ res }) as const,
      (err: unknown) => ({ err: err as Error }) as const,
    );

    /** Everything from the first data frame on. Shared, so the passes cannot drift. */
    const commitOrFail = (
      res: Response,
      reader: ReadableStreamDefaultReader<Uint8Array>,
      read: Awaited<ReturnType<typeof readUntilData>>,
    ): Outcome => {
      release();
      if ("err" in read) {
        void reader.cancel().catch(() => undefined);
        ac.abort();
        if (params.signal?.aborted) throw read.err;
        record({ error: "network" });
        return { kind: "failed" };
      }
      if ("empty" in read) {
        // Accepted, streamed no data frame at all — keepalives at most. Not a
        // usable answer; try the next route.
        record({ status: res.status, detail: "empty stream" });
        return { kind: "failed" };
      }
      return {
        kind: "committed",
        value: {
          reader,
          provider: cand.route.provider,
          first: read.chunks,
          toolsDropped: omitTools && !!params.tools?.length,
          operatorFunded: cand.runtime.credential === "operator",
          responseHeaders: res.headers,
        },
      };
    };

    /** Headers have arrived (or failed). Everything downstream of that. */
    const afterHeaders = async (
      settled: { res: Response } | { err: Error },
      firstChunkMs: number,
    ): Promise<Outcome> => {
      if ("err" in settled) {
        release();
        // A caller abort is the user pressing stop — never failover, never mask it.
        if (params.signal?.aborted) throw settled.err;
        record({ error: ac.signal.aborted ? "timeout" : "network", detail: settled.err.message });
        return { kind: "failed" };
      }
      const res = settled.res;

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        release();
        // Retry this same route once without `stream_options` before giving up on
        // it — the model works, the provider just will not accept that one field.
        if (!omitStreamOptions && rejectsStreamOptions(res.status, text)) {
          return { kind: "requeue", item: { cand, omitStreamOptions: true, omitTools } };
        }
        // Same remedy for `tools`. Without it, a route that rejects tool calling
        // is spent rather than downgraded — and since most NIM-only models have
        // exactly one route, the queue empties and the whole turn fails with
        // `all_routes_failed` instead of answering. The retry costs one round trip
        // on a request that streamed nothing and is not billed.
        if (!omitTools && params.tools?.length && rejectsTools(res.status, text)) {
          return { kind: "requeue", item: { cand, omitStreamOptions, omitTools: true } };
        }
        record({ status: res.status, detail: scrubSecrets(text).slice(0, 200) });
        return { kind: "failed" };
      }

      // Headers are not enough — read until a real data frame before committing,
      // so a provider that accepts and then hangs, or that only sends
      // keepalives, still falls through to the next route.
      const reader = res.body.getReader();
      const reading = readUntilData(reader);
      const first = await raceDeadline(reading, firstChunkMs);
      if (first !== SLOW) return commitOrFail(res, reader, first);

      if (patient) {
        release();
        void reader.cancel().catch(() => undefined);
        ac.abort();
        record({ error: "timeout" });
        return { kind: "failed" };
      }
      return {
        kind: "slow",
        parked: {
          resume: async () => {
            const late = await raceDeadline(reading, PATIENT_DEADLINE_MS);
            if (late === SLOW) {
              release();
              void reader.cancel().catch(() => undefined);
              ac.abort();
              record({ error: "timeout" });
              return null;
            }
            const out = commitOrFail(res, reader, late);
            return out.kind === "committed" ? out.value : null;
          },
          abandon: () => {
            release();
            void reader.cancel().catch(() => undefined);
            ac.abort();
          },
        },
      };
    };

    const settled = await raceDeadline(fetching, patient ? PATIENT_DEADLINE_MS : CONNECT_TIMEOUT_MS);
    if (settled !== SLOW) return afterHeaders(settled, patient ? PATIENT_DEADLINE_MS : FIRST_CHUNK_TIMEOUT_MS);

    if (patient) {
      release();
      ac.abort();
      record({ error: "timeout" });
      return { kind: "failed" };
    }
    return {
      kind: "slow",
      parked: {
        resume: async () => {
          const late = await raceDeadline(fetching, PATIENT_DEADLINE_MS);
          if (late === SLOW) {
            release();
            ac.abort();
            record({ error: "timeout" });
            return null;
          }
          const out = await afterHeaders(late, PATIENT_DEADLINE_MS);
          if (out.kind === "committed") return out.value;
          // A provider that answered late *and* rejected one field is rare
          // enough to re-issue rather than complicate the parked path — and by
          // this point the first request streamed nothing, so nothing is
          // re-paid for.
          if (out.kind === "requeue") {
            const retry = await attemptOne(out.item, true);
            return retry.kind === "committed" ? retry.value : null;
          }
          return null;
        },
        abandon: () => {
          release();
          ac.abort();
        },
      },
    };
  };

  // Pass one: every candidate, on the failover deadlines. A route that is merely
  // slow is set aside rather than killed, so this pass moves at exactly the
  // speed it always did.
  while (queue.length > 0) {
    const item = queue.shift()!;
    if (params.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const out = await attemptOne(item, false);
    if (out.kind === "committed") {
      committed = out.value;
      break;
    }
    if (out.kind === "requeue") queue.unshift(out.item);
    else if (out.kind === "slow") parked.push(out.parked);
  }

  // Pass two: nothing answered in time, but something may still be thinking.
  // This is the only path on which a 550B model is reachable at all.
  while (!committed && parked.length > 0) {
    if (params.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    committed = await parked.shift()!.resume();
  }

  if (!committed) {
    for (const p of parked) p.abandon();
    throw aggregateFailure(model, attempts, params.userKeys);
  }

  const readUsage = (u: any): Usage | null => {
    if (!u) return null;
    // Where image-output tokens land is not standardized — chat-completions
    // never had a field for them, so each provider put them somewhere
    // plausible. All three spellings below are read and the first finite one
    // wins; an absent count simply means the turn is priced as plain text.
    const details = u.completion_tokens_details ?? u.output_tokens_details;
    const imageTokens = [
      details?.image_tokens,
      details?.image_output_tokens,
      u.image_tokens,
    ].find((n) => typeof n === "number" && Number.isFinite(n) && n > 0);
    return {
      promptTokens: u.prompt_tokens,
      completionTokens: u.completion_tokens,
      totalTokens: u.total_tokens,
      ...(imageTokens ? { imageTokens } : {}),
    };
  };

  /**
   * A committed stream that produced no answer at all.
   *
   * Distinguished from a normal end so the caller can fall back: a route that
   * committed and then said nothing has told us nothing except that it was the
   * wrong route.
   */
  const BARREN = Symbol("barren");

  /** Read one committed stream to its end, or report that it carried nothing. */
  const drain = async function* (
    c: Committed,
  ): AsyncGenerator<RouterEvent, typeof BARREN | undefined, unknown> {
    const reader = c.reader;
    const decoder = new TextDecoder();
    let buffer = "";
    // Anthropic streams a block's identity once and then only its deltas, so
    // the translation needs memory across frames. Inert for OpenAI.
    const frameState = newFrameState();
    const committedProtocol: WireProtocol = PROVIDERS[c.provider].protocol ?? "openai";

    // Reasoning models (DeepSeek R1/V4, o-series, gpt-oss, …) stream their
    // visible text in `reasoning_content`/`reasoning`; we surface it as a
    // separate `reasoning` stream. If a response produces NO content at all, the
    // string wrapper below falls back to reasoning so the model never appears
    // silent.
    let finishReason: string | undefined;
    // Tool calls arrive as indexed fragments; accumulate then flush at the end.
    const toolAcc: Record<number, { id: string; name: string; args: string }> = {};
    /** Anything the caller could actually show or act on. */
    let answered = false;

    const flushTools = function* (): Generator<RouterEvent> {
      for (const k of Object.keys(toolAcc)) {
        const t = toolAcc[Number(k)];
        if (t.name || t.args) {
          answered = true;
          yield { type: "tool_call", call: { id: t.id, name: t.name, arguments: t.args } };
        }
      }
    };

    // The chunks consumed to commit this route are replayed here, so no tokens
    // are lost to the read-ahead above.
    const replay = [...c.first];
    let stalled = false;

    // De-duplicated across the whole stream, not per delta: providers repeat the
    // finished image on the final chunk, and some send it on both `delta` and
    // `message`.
    const seenImages = new Set<string>();
    let imageCount = 0;

    try {
      for (;;) {
        let value: Uint8Array | undefined;
        if (replay.length) {
          value = replay.shift();
        } else {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await readWithTimeout(reader, idleTimeoutFor(model));
          } catch (e) {
            if (params.signal?.aborted) throw e;
            // Past the first chunk the caller has already seen output, so
            // failing over is not an option — end the stream and say why.
            if (e instanceof ReadTimeout) {
              stalled = true;
              break;
            }
            throw e;
          }
          if (chunk.done) break;
          value = chunk.value;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const raw of lines) {
          const line = raw.trim();
          if (!line || !line.startsWith("data:")) continue;
          // Translate the frame into the OpenAI chunk shape. Identity for
          // OpenAI providers, so this path is unchanged for every existing
          // model; `null` means a frame that carries nothing (keepalives).
          const data = normalizeFrame(committedProtocol, line.slice(5).trim(), frameState);
          if (data === null) continue;
          if (data === "[DONE]") {
            yield* flushTools();
            if (!answered) return BARREN;
            yield { type: "done", finishReason };
            return undefined;
          }
          try {
            const json = JSON.parse(data);

            // A provider error delivered *inside* the stream. `choices` is
            // absent on these, so every field below reads as empty and the turn
            // used to end looking like a model that had nothing to say. Seen
            // live: an OpenRouter free route erroring mid-build, reported to the
            // user as a blank assistant message.
            const err = json.error;
            if (err && (typeof err === "string" || err.message || err.code)) {
              throw new RouterError(
                "upstream_error",
                typeof err === "string"
                  ? err
                  : (err.message ?? `${c.provider} reported an error mid-stream.`),
                502,
                attempts,
              );
            }

            const choice = json.choices?.[0];
            const delta = choice?.delta ?? {};
            if (choice?.finish_reason) finishReason = choice.finish_reason;

            // Guarded on the type, not just on truthiness: `content` is an array
            // of typed parts when the model emits an image, and yielding that as
            // a token would put "[object Object]" in the transcript.
            const content: unknown = delta.content;
            const reasoning: string | undefined = delta.reasoning_content ?? delta.reasoning;
            if (typeof content === "string" && content) {
              answered = true;
              yield { type: "token", text: content };
            }
            if (reasoning) {
              answered = true;
              yield { type: "reasoning", text: reasoning };
            }

            // Image output. Checked on the message as well as the delta: a
            // provider that does not stream images still sends them, once, on a
            // final non-delta choice.
            for (const image of [...readImages(delta), ...readImages(choice?.message)]) {
              if (imageCount >= MAX_IMAGES_PER_TURN) break;
              if (seenImages.has(image.url)) continue;
              seenImages.add(image.url);
              imageCount++;
              answered = true;
              yield { type: "image", image };
            }

            if (Array.isArray(delta.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const idx: number = tc.index ?? 0;
                const cur = toolAcc[idx] ?? { id: "", name: "", args: "" };
                if (tc.id) cur.id = tc.id;
                if (tc.function?.name) cur.name = tc.function.name;
                if (tc.function?.arguments) cur.args += tc.function.arguments;
                toolAcc[idx] = cur;
              }
            }

            const usage = readUsage(json.usage);
            if (usage) {
              // Remembered rather than counted here: providers differ in how
              // many usage frames they send and which fields each carries
              // (Anthropic splits prompt and completion across two), so the
              // running maximum of each field is the only shape that is right
              // for all of them. Counted once, after the stream ends.
              billedPrompt = Math.max(billedPrompt, usage.promptTokens ?? 0);
              billedCompletion = Math.max(billedCompletion, usage.completionTokens ?? 0);
              yield { type: "usage", usage };
            }
          } catch (e) {
            if (e instanceof RouterError) throw e;
            // partial JSON across chunks — ignore; it'll arrive next read
          }
        }
      }

      // Stream ended without an explicit [DONE], or stalled past the idle timeout.
      yield* flushTools();
      if (!answered && !stalled) return BARREN;
      yield { type: "done", finishReason: stalled ? "stalled" : finishReason };
      return undefined;
    } finally {
      // Release the connection on every exit path, including the consumer
      // abandoning the generator — otherwise a stopped chat leaks a socket.
      await reader.cancel().catch(() => undefined);
    }
  };

  // A route that committed and then said nothing has not answered, and the
  // routes parked behind it may still be about to. Measured live: an OpenRouter
  // free route won the race with keepalives and an error frame while the NVIDIA
  // route that would have produced the page sat parked and was discarded.
  for (;;) {
    // Count the spend the moment a route commits, not when it finishes: the
    // request has already been made by then, and a caller that disconnects
    // mid-stream still cost the operator's allowance. Awaiting a counter while
    // a stream is waiting to be read would be the wrong trade, so this is
    // fire-and-forget by contract — see `bumpUsage`.
    //
    // Once per committed route, which is exactly right: a BARREN failover
    // re-enters this loop with a different `committed`, and that second route
    // really was a second request.
    if (committed.operatorFunded) {
      void recordLaneSpend(committed.provider, committed.responseHeaders, { requests: 1 });
    }

    if (committed.provider !== preferred) {
      yield { type: "provider", provider: committed.provider };
    }
    // Before the first token, so the caller can say so at the top of the turn
    // rather than explaining afterwards why the model ignored every tool it was
    // supposedly given.
    if (committed.toolsDropped) {
      yield { type: "capability", capability: "tools", supported: false };
    }

    const outcome = yield* drain(committed);
    if (outcome !== BARREN) break;

    attempts.push({
      provider: committed.provider,
      routeModel: model.id,
      ms: 0,
      detail: "committed but streamed no answer",
    });
    const next = parked.length ? await parked.shift()!.resume() : null;
    if (!next) {
      for (const p of parked) p.abandon();
      throw aggregateFailure(model, attempts, params.userKeys);
    }
    committed = next;
  }

  // Tokens, now that the stream has reported them. A second write rather than a
  // larger first one: a caller who disconnects mid-stream never reaches here,
  // and their request must still have been counted. Best-effort by design —
  // token ceilings (Groq's tpm, Mistral's whole tpMonth tier) would otherwise
  // read zero forever, which is worse than reading slightly low.
  const billedTokens = billedPrompt + billedCompletion;
  if (committed.operatorFunded && billedTokens > 0) {
    void recordLaneSpend(committed.provider, undefined, { requests: 0, tokens: billedTokens });
  }

  for (const p of parked) p.abandon();
}

/**
 * Stream a chat completion as plain content deltas. Back-compat wrapper over
 * {@link streamChatEvents}: yields visible text, and if a reasoning model emits
 * NO content at all, flushes the buffered reasoning at the end so it's never
 * silent.
 */
export async function* streamChat(
  params: StreamParams,
): AsyncGenerator<string, void, unknown> {
  let emittedContent = false;
  let reasoningBuf = "";
  for await (const ev of streamChatEvents(params)) {
    if (ev.type === "token") {
      emittedContent = true;
      yield ev.text;
    } else if (ev.type === "reasoning") {
      reasoningBuf += ev.text;
    }
  }
  if (!emittedContent && reasoningBuf) yield reasoningBuf;
}

/** Convenience: collect a full (non-streamed) completion. */
export async function completeChat(params: StreamParams): Promise<string> {
  let out = "";
  for await (const delta of streamChat(params)) out += delta;
  return out;
}

/** Resolve which provider would actually serve a model right now (for UI). */
export function routeProviderFor(
  modelId: string,
  userKeys?: UserKeys,
): ProviderId | null {
  const model = getModelById(modelId);
  if (!model) return null;
  const availability = modelAvailability(model, routeEnv(userKeys));
  if (availability.kind === "free" || availability.kind === "your_key") {
    return availability.route.provider;
  }
  return null;
}
