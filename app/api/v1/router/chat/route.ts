import { NextRequest } from "next/server";
import {
  streamChatEvents,
  resolveServableCandidates,
  RouterError,
  type ChatMessage,
  type StreamParams,
  type UserKeys,
} from "@/lib/router";
import { sse, SSE_HEADERS } from "@/lib/router/sse";
import { getCatalogSnapshot } from "@/lib/catalog/store";
import { readUserKeys } from "@/lib/router/user-keys";
import { RateLimiter, callerKey } from "@/lib/compare/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The one route in the app that can legitimately run for minutes.
 *
 * Every other long route here declares 60 s; this one declared nothing and so
 * inherited the platform default, which is shorter than a single answer from a
 * large model. Measured against `nvidia/nemotron-3-ultra-550b-a55b`: 57 s to the
 * first byte and 554 s to `finish_reason`, for one 16k-token answer. A stream cut
 * at the platform's default is indistinguishable, from the client's side, from a
 * model that stopped talking — the partial answer is kept and presented as
 * finished.
 *
 * 300 s is the Vercel Hobby plan's ceiling (800 s needs Pro or higher). A run
 * that legitimately needs longer than this still gets cut off client-side, same
 * as before — the ceiling just moved down with the plan.
 */
export const maxDuration = 300;

/**
 * Per-caller cap on requests that spend the OPERATOR's credential.
 *
 * Until now this route had no limit at all: any anonymous POST spent the
 * operator's provider budget, and `middleware.ts` has gating disabled. The
 * quota ledger stops the operator's free tier being burned through in total;
 * this stops one caller doing it alone.
 *
 * Deliberately NOT applied when the request carries the user's own key — they
 * are spending their own allowance, and rate-limiting that would be pure
 * friction. See `lib/quota/index.ts` for why the two are separate problems.
 *
 * Same mitigation-not-authentication caveat as `lib/compare/rate-limit.ts`:
 * `callerKey` reads a spoofable header and the bucket is per-instance.
 */
const chatLimiter = new RateLimiter({
  capacity: Number(process.env.ATLAS_CHAT_BURST ?? 40) || 40,
  windowMs: 5 * 60 * 1000,
});

interface Body {
  modelId: string;
  messages: ChatMessage[];
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  stop?: string[];
  seed?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  reasoningEffort?: StreamParams["reasoningEffort"];
  responseFormat?: StreamParams["responseFormat"];
  tools?: StreamParams["tools"];
  toolChoice?: StreamParams["toolChoice"];
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.modelId || !Array.isArray(body.messages)) {
    return Response.json(
      { error: "modelId and messages are required" },
      { status: 400 },
    );
  }

  // The catalog is a runtime snapshot, so it must be loaded before the router
  // resolves an id — otherwise every model added by the daily sync 404s here.
  await getCatalogSnapshot();

  // BYOK: user's OpenRouter key arrives per-request. Do NOT log or persist it.
  const userKeys: UserKeys = readUserKeys(req.headers);

  // Validate routing up-front so we can return a clean HTTP error rather than a
  // 200 carrying an error frame. Emits `key_required` (402) for closed models
  // without a user key, `no_provider_configured` (503) for free models with no
  // operator key, and `quota_exhausted` (429) when every free lane's allowance
  // is spent — the last of these consults the ledger, which is why it is async.
  let providerId: string;
  let operatorFunded: boolean;
  try {
    const candidates = await resolveServableCandidates(body.modelId, userKeys);
    providerId = candidates[0].route.provider;
    operatorFunded = candidates[0].runtime.credential === "operator";
  } catch (e) {
    const err = e as RouterError;
    return Response.json(
      { error: err.message, code: err.code },
      {
        status: err.status ?? 400,
        // Standard, machine-readable, and understood by proxies and clients
        // that never look at our JSON body.
        headers: err.retryAfterMs
          ? { "Retry-After": String(Math.ceil(err.retryAfterMs / 1000)) }
          : undefined,
      },
    );
  }

  // Only requests on the operator's dime are capped; see `chatLimiter`.
  if (operatorFunded) {
    const decision = chatLimiter.check(callerKey(req.headers), 1);
    if (!decision.ok) {
      return Response.json(
        {
          // Deliberately does NOT suggest connecting a key: on a free route
          // `runtimeFor` prefers the operator's credential even when the user
          // has their own, so this particular limit would still apply and the
          // advice would be false. (When the operator's *allowance* runs out,
          // that is a different code and a user key genuinely does take over —
          // see `dropExhaustedCandidates`.)
          error: "Too many requests in a short window. Give it a moment and try again.",
          code: "rate_limited",
        },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(decision.retryAfterMs / 1000)) },
        },
      );
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: unknown) => controller.enqueue(encoder.encode(sse(e)));
      send({ type: "meta", provider: providerId });
      try {
        for await (const ev of streamChatEvents({
          modelId: body.modelId,
          messages: body.messages,
          temperature: body.temperature,
          topP: body.topP,
          topK: body.topK,
          maxTokens: body.maxTokens,
          stop: body.stop,
          seed: body.seed,
          frequencyPenalty: body.frequencyPenalty,
          presencePenalty: body.presencePenalty,
          reasoningEffort: body.reasoningEffort,
          responseFormat: body.responseFormat,
          tools: body.tools,
          toolChoice: body.toolChoice,
          signal: req.signal,
          userKeys,
        })) {
          // `delta` is kept for back-compat with existing chat/playground/
          // compare clients; the richer events are additive.
          if (ev.type === "token") send({ type: "delta", text: ev.text });
          else if (ev.type === "reasoning") send({ type: "reasoning", text: ev.text });
          // Images are already validated and size-capped by lib/router/images.ts;
          // the route only forwards them.
          else if (ev.type === "image")
            send({ type: "image", url: ev.image.url, mime: ev.image.mime });
          else if (ev.type === "tool_call")
            send({ type: "tool_call", ...ev.call });
          else if (ev.type === "usage") send({ type: "usage", ...ev.usage });
          else if (ev.type === "done")
            send({ type: "done", finishReason: ev.finishReason });
          // Free models can fall through to a backup provider mid-request
          // (first choice 429/5xx) — correct the earlier optimistic meta.
          else if (ev.type === "provider")
            send({ type: "meta", provider: ev.provider });
          // The route rejected `tools` and the request was retried without them.
          // Forwarded so the client can tell the user AND remember it, rather
          // than paying for the same rejection on every subsequent turn.
          else if (ev.type === "capability")
            send({ type: "capability", capability: ev.capability, supported: ev.supported });
        }
      } catch (e) {
        const err = e as RouterError;
        send({
          type: "error",
          message: err.message ?? "Inference failed",
          code: err.code ?? "upstream_error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
