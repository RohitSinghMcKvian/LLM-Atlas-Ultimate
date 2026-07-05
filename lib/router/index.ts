// Atlas Router — a unified, OpenAI-compatible inference gateway.
// Server-only. Free (open) models run on operator env keys; closed (BYOK)
// models run on the USER's own OpenRouter key, passed per-request and never
// persisted or logged.
import { PROVIDERS, PROVIDER_LIST, getModelById, modelAccess } from "@/lib/catalog";
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

export class RouterError extends Error {
  code:
    | "no_provider_configured"
    | "model_not_found"
    | "no_route"
    | "key_required"
    | "upstream_error";
  status: number;
  constructor(code: RouterError["code"], message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
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

/**
 * Resolve which provider+runtime serves a model.
 *  - "byok"  (closed/paid): routed through the USER's OpenRouter key. If the
 *    user hasn't supplied one, throw `key_required` (402) — the operator key
 *    must never silently pay for frontier models.
 *  - "free"  (open): routed through the first operator-configured provider.
 */
export function resolveRoute(modelId: string, userKeys?: UserKeys): ResolvedRoute {
  const model = getModelById(modelId);
  if (!model) throw new RouterError("model_not_found", `Unknown model: ${modelId}`, 404);
  if (model.routes.length === 0)
    throw new RouterError("no_route", `${model.name} has no routable provider`, 422);

  if (modelAccess(model) === "byok") {
    const route = model.routes.find((r) => r.provider === "openrouter");
    if (!route)
      throw new RouterError("no_route", `${model.name} has no OpenRouter route`, 422);

    // Prefer the user's own key. If absent, the operator MAY serve paid models
    // on their key when OPERATOR_SERVE_PAID is enabled (single-operator deploy);
    // otherwise the user must connect their own key.
    if (userKeys?.openrouter) {
      const runtime = getProviderRuntime("openrouter", userKeys);
      if (runtime) return { model, route, runtime };
    }
    if (process.env.OPERATOR_SERVE_PAID === "true") {
      const operatorRuntime = getProviderRuntime("openrouter");
      if (operatorRuntime) return { model, route, runtime: operatorRuntime };
    }
    throw new RouterError(
      "key_required",
      `${model.name} is a closed model — add your OpenRouter key to use it.`,
      402,
    );
  }

  // Free / open: operator env keys only (user is never billed for these).
  for (const route of model.routes) {
    const runtime = getProviderRuntime(route.provider);
    if (runtime) return { model, route, runtime };
  }
  throw new RouterError(
    "no_provider_configured",
    `No free provider is connected to serve ${model.name}. The operator must add a key (NVIDIA_API_KEY, GOOGLE_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, or LOCAL_BASE_URL).`,
    503,
  );
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

/** Build the OpenAI-compatible request body, omitting undefined params. */
function buildBody(route: ModelRoute, p: StreamParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: route.model,
    messages: p.messages,
    temperature: p.temperature ?? 0.7,
    stream: true,
    stream_options: { include_usage: true },
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
 * Stream a chat completion as a typed event stream (§3.1): `token`,
 * `reasoning`, `tool_call`, `usage`, `done`. Works across every provider
 * (OpenAI-compatible chat/completions). Routing / transport failures throw
 * `RouterError`; the API layer converts those to `error` frames on the wire.
 */
export async function* streamChatEvents(
  params: StreamParams,
): AsyncGenerator<RouterEvent, void, unknown> {
  const primary = resolveRoute(params.modelId, params.userKeys);

  // Free models may have several configured routes; if the preferred provider
  // is rate-limited or down (429 / 5xx), fall through to the next one.
  const candidates: ResolvedRoute[] = [primary];
  if (modelAccess(primary.model) !== "byok") {
    for (const r of primary.model.routes) {
      if (r === primary.route) continue;
      const runtime = getProviderRuntime(r.provider);
      if (runtime) candidates.push({ model: primary.model, route: r, runtime });
    }
  }

  let res: Response | null = null;
  let servedProvider: ProviderId = primary.route.provider;
  let lastFail: { id: ProviderId; status: number; text: string } | null = null;
  for (const cand of candidates) {
    const attempt = await fetch(`${cand.runtime.baseUrl}/chat/completions`, {
      method: "POST",
      headers: cand.runtime.headers,
      body: JSON.stringify(buildBody(cand.route, params)),
      signal: params.signal,
    });
    if (attempt.ok && attempt.body) {
      res = attempt;
      servedProvider = cand.route.provider;
      break;
    }
    const text = await attempt.text().catch(() => "");
    lastFail = { id: cand.runtime.id, status: attempt.status, text };
    // Only retry the next provider on rate limits / upstream outages; other
    // statuses (bad request, auth) would fail identically everywhere.
    if (attempt.status !== 429 && attempt.status < 500) break;
  }

  if (!res || !res.body) {
    const f = lastFail ?? { id: primary.runtime.id, status: 502, text: "" };
    throw new RouterError(
      "upstream_error",
      `${f.id} responded ${f.status}: ${f.text.slice(0, 300)}`,
      f.status,
    );
  }

  if (servedProvider !== primary.route.provider) {
    yield { type: "provider", provider: servedProvider };
  }

  const reader = res.body.getReader();
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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
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

  // Stream ended without an explicit [DONE].
  yield* flushTools();
  yield { type: "done", finishReason };
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
  if (modelAccess(model) === "byok") {
    // Runnable only with the user's OpenRouter key.
    if (!userKeys?.openrouter) return null;
    return model.routes.some((r) => r.provider === "openrouter")
      ? "openrouter"
      : null;
  }
  for (const route of model.routes) {
    if (getProviderRuntime(route.provider)) return route.provider;
  }
  return null;
}
