import { NextRequest } from "next/server";
import {
  streamChatEvents,
  resolveRoute,
  RouterError,
  type ChatMessage,
  type StreamParams,
  type UserKeys,
} from "@/lib/router";
import { sse, SSE_HEADERS } from "@/lib/router/sse";
import { getCatalogSnapshot } from "@/lib/catalog/store";

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
  const orKey = req.headers.get("x-openrouter-key") ?? undefined;
  const userKeys: UserKeys = orKey ? { openrouter: orKey } : {};

  // Validate routing up-front so we can return a clean error. resolveRoute
  // emits `key_required` (402) for closed models without a user key and
  // `no_provider_configured` (503) for free models with no operator key.
  let providerId: string;
  try {
    providerId = resolveRoute(body.modelId, userKeys).route.provider;
  } catch (e) {
    const err = e as RouterError;
    return Response.json(
      { error: err.message, code: err.code },
      { status: err.status ?? 400 },
    );
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
