// Atlas Router — a unified, OpenAI-compatible inference gateway.
// Server-only. Free (open) models run on operator env keys; closed (BYOK)
// models run on the USER's own OpenRouter key, passed per-request and never
// persisted or logged.
import { PROVIDERS, PROVIDER_LIST, getModelById } from "@/lib/catalog";
import { modelAvailability, type RouteEnv } from "@/lib/catalog/availability";
import type { CatalogModel, ProviderId, ModelRoute } from "@/lib/catalog/types";

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
  | { type: "tool_call"; call: ToolCall }
  | { type: "usage"; usage: Usage }
  | { type: "done"; finishReason?: string }
  /** The provider that actually served the request — may differ from the
   *  caller's pre-flight resolveRoute() when a free model fell through to a
   *  backup provider after a 429/5xx from the first-choice one. */
  | { type: "provider"; provider: ProviderId };

/**
 * User-supplied keys, forwarded from the browser for a single request.
 * SECURITY: never persist these, never log them, never echo them in responses.
 */
export interface UserKeys {
  openrouter?: string;
}

export interface ProviderRuntime {
  id: ProviderId;
  baseUrl: string;
  apiKey?: string;
  headers: Record<string, string>;
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
    /** Every route answered 401/403 — an operator key is bad. */
    | "provider_key_invalid"
    /** Every route answered 429 — free tiers cap requests per minute. */
    | "rate_limited"
    /** Every route hung. */
    | "all_routes_timed_out"
    /** Mixed failures across every route. */
    | "all_routes_failed";
  status: number;
  /** Populated when the failure happened after routing, one entry per try. */
  attempts?: RouteAttempt[];
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
  return text
    .replace(/nvapi-[A-Za-z0-9_-]{8,}/g, "nvapi-***")
    .replace(/sk-or-v1-[A-Za-z0-9]{8,}/g, "sk-or-v1-***")
    .replace(/sk-[A-Za-z0-9]{16,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer ***");
}

/**
 * Build a runtime for a provider, or null if it isn't configured.
 * For OpenRouter a per-request user key (BYOK) takes precedence over the
 * operator env key; other providers are operator-env only.
 */
export function getProviderRuntime(
  id: ProviderId,
  userKeys?: UserKeys,
): ProviderRuntime | null {
  const meta = PROVIDERS[id];
  const baseUrl =
    process.env[`${id.toUpperCase()}_BASE_URL`] || meta.defaultBaseUrl;
  let apiKey = meta.apiKeyEnv ? process.env[meta.apiKeyEnv] : undefined;

  // BYOK: the user's OpenRouter key (when present) is used in place of env.
  if (id === "openrouter" && userKeys?.openrouter) {
    apiKey = userKeys.openrouter;
  }

  // Local is only considered available when a base URL is explicitly provided.
  if (id === "local") {
    if (!process.env.LOCAL_BASE_URL) return null;
  } else if (!apiKey) {
    return null;
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  if (id === "openrouter") {
    headers["HTTP-Referer"] =
      process.env.OPENROUTER_SITE_URL || "https://llmatlas.xyz";
    headers["X-Title"] = process.env.OPENROUTER_SITE_NAME || "LLM Atlas";
  }
  return { id, baseUrl, apiKey, headers };
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
    userOpenRouterKey: Boolean(userKeys?.openrouter),
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
 */
export function resolveRoute(modelId: string, userKeys?: UserKeys): ResolvedRoute {
  return resolveCandidates(modelId, userKeys)[0];
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

/** Build the OpenAI-compatible request body, omitting undefined params. */
function buildBody(
  route: ModelRoute,
  p: StreamParams,
  omitStreamOptions = false,
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
  if (p.tools && p.tools.length) {
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

/** Turn the recorded attempts into one error a user can act on. */
function aggregateFailure(model: CatalogModel, attempts: RouteAttempt[]): RouterError {
  const list = attempts
    .map((a) => {
      const what = a.error ? `${a.error} after ${Math.round(a.ms)}ms` : `HTTP ${a.status}`;
      return `${a.provider}/${a.routeModel} ${what}`;
    })
    .join("; ");

  const every = (p: (a: RouteAttempt) => boolean) => attempts.length > 0 && attempts.every(p);

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
      `${model.name} is no longer served by ${attempts.map((a) => a.provider).join(" or ")}. The next catalog sync will drop it — please pick another model.`,
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
    return new RouterError(
      "provider_key_invalid",
      `The operator key for ${attempts.map((a) => a.provider).join(" / ")} was rejected. Check the provider API key.`,
      502,
      attempts,
    );
  }
  if (every((a) => a.error === "timeout")) {
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
  const candidates = resolveCandidates(params.modelId, params.userKeys);
  const model = candidates[0].model;
  const preferred = candidates[0].route.provider;

  const attempts: RouteAttempt[] = [];
  let committed: {
    reader: ReadableStreamDefaultReader<Uint8Array>;
    provider: ProviderId;
    first: Uint8Array | undefined;
  } | null = null;

  // A work queue rather than a plain loop, so one candidate can be re-queued with
  // a reduced body (see `rejectsStreamOptions`) without duplicating the attempt
  // machinery or letting a compatibility quirk consume a whole route.
  const queue: { cand: ResolvedRoute; omitStreamOptions: boolean }[] = candidates.map((cand) => ({
    cand,
    omitStreamOptions: false,
  }));

  while (queue.length > 0) {
    const { cand, omitStreamOptions } = queue.shift()!;
    if (params.signal?.aborted) throw new DOMException("Aborted", "AbortError");

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
    let connectTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => ac.abort(),
      CONNECT_TIMEOUT_MS,
    );

    let res: Response;
    try {
      res = await fetch(`${cand.runtime.baseUrl}/chat/completions`, {
        method: "POST",
        headers: cand.runtime.headers,
        body: JSON.stringify(buildBody(cand.route, params, omitStreamOptions)),
        signal: ac.signal,
      });
    } catch (e) {
      clearTimeout(connectTimer);
      params.signal?.removeEventListener("abort", onCallerAbort);
      // A caller abort is the user pressing stop — never failover, never mask it.
      if (params.signal?.aborted) throw e;
      record({ error: ac.signal.aborted ? "timeout" : "network", detail: (e as Error).message });
      continue;
    }
    clearTimeout(connectTimer);
    connectTimer = undefined;

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      params.signal?.removeEventListener("abort", onCallerAbort);
      // Retry this same route once without `stream_options` before giving up on
      // it — the model works, the provider just will not accept that one field.
      if (!omitStreamOptions && rejectsStreamOptions(res.status, text)) {
        queue.unshift({ cand, omitStreamOptions: true });
        continue;
      }
      record({ status: res.status, detail: scrubSecrets(text).slice(0, 200) });
      continue;
    }

    // Headers are not enough — read one chunk before committing, so a provider
    // that accepts and then hangs still falls through to the next route.
    const reader = res.body.getReader();
    try {
      const first = await readWithTimeout(reader, FIRST_CHUNK_TIMEOUT_MS);
      if (first.done) {
        // Accepted, streamed nothing. Not a usable answer; try the next route.
        params.signal?.removeEventListener("abort", onCallerAbort);
        record({ status: res.status, detail: "empty stream" });
        continue;
      }
      committed = { reader, provider: cand.route.provider, first: first.value };
      params.signal?.removeEventListener("abort", onCallerAbort);
      break;
    } catch (e) {
      await reader.cancel().catch(() => undefined);
      ac.abort();
      params.signal?.removeEventListener("abort", onCallerAbort);
      if (params.signal?.aborted) throw e;
      record({ error: e instanceof ReadTimeout ? "timeout" : "network" });
      continue;
    }
  }

  if (!committed) throw aggregateFailure(model, attempts);

  if (committed.provider !== preferred) {
    yield { type: "provider", provider: committed.provider };
  }

  const reader = committed.reader;
  const decoder = new TextDecoder();
  let buffer = "";

  // Reasoning models (DeepSeek R1/V4, o-series, gpt-oss, …) stream their visible
  // text in `reasoning_content`/`reasoning`; we surface it as a separate
  // `reasoning` stream. If a response produces NO content at all, the string
  // wrapper below falls back to reasoning so the model never appears silent.
  let finishReason: string | undefined;
  // Tool calls arrive as indexed fragments; accumulate then flush at the end.
  const toolAcc: Record<number, { id: string; name: string; args: string }> = {};

  const flushTools = function* (): Generator<RouterEvent> {
    for (const k of Object.keys(toolAcc)) {
      const t = toolAcc[Number(k)];
      if (t.name || t.args)
        yield { type: "tool_call", call: { id: t.id, name: t.name, arguments: t.args } };
    }
  };

  const readUsage = (u: any): Usage | null =>
    u
      ? {
          promptTokens: u.prompt_tokens,
          completionTokens: u.completion_tokens,
          totalTokens: u.total_tokens,
        }
      : null;

  // The chunk consumed to commit this route is replayed here, so no tokens are
  // lost to the first-chunk read-ahead above.
  let pending: Uint8Array | undefined = committed.first;
  let stalled = false;

  try {
  while (true) {
    let value: Uint8Array | undefined;
    if (pending) {
      value = pending;
      pending = undefined;
    } else {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await readWithTimeout(reader, IDLE_TIMEOUT_MS);
      } catch (e) {
        if (params.signal?.aborted) throw e;
        // Past the first chunk the caller has already seen output, so failing
        // over is not an option — end the stream and say why.
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
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        yield* flushTools();
        yield { type: "done", finishReason };
        return;
      }
      try {
        const json = JSON.parse(data);
        const choice = json.choices?.[0];
        const delta = choice?.delta ?? {};
        if (choice?.finish_reason) finishReason = choice.finish_reason;

        const content: string | undefined = delta.content;
        const reasoning: string | undefined =
          delta.reasoning_content ?? delta.reasoning;
        if (content) yield { type: "token", text: content };
        if (reasoning) yield { type: "reasoning", text: reasoning };

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
        if (usage) yield { type: "usage", usage };
      } catch {
        // partial JSON across chunks — ignore; it'll arrive next read
      }
    }
  }

  // Stream ended without an explicit [DONE], or stalled past the idle timeout.
  yield* flushTools();
  yield { type: "done", finishReason: stalled ? "stalled" : finishReason };
  } finally {
    // Release the connection on every exit path, including the consumer
    // abandoning the generator — otherwise a stopped chat leaks a socket.
    await reader.cancel().catch(() => undefined);
  }
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
