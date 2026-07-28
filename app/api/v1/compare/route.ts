import { NextRequest } from "next/server";
import {
  streamChat,
  resolveRoute,
  RouterError,
  type UserKeys,
} from "@/lib/router";
import { getModelById } from "@/lib/catalog";
import { getCatalogSnapshot } from "@/lib/catalog/store";
import { sse, SSE_HEADERS } from "@/lib/router/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  query: string;
  modelIds: string[];
  temperature?: number;
  synthesisModelId?: string;
}

const SYSTEM = "Answer the user's question clearly and concisely. Be direct.";

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.query?.trim() || !Array.isArray(body.modelIds) || body.modelIds.length === 0) {
    return Response.json(
      { error: "query and at least one modelId are required" },
      { status: 400 },
    );
  }

  // The catalog is a runtime snapshot, so it must be loaded before any model
  // id is resolved — otherwise every model added by the daily sync 404s here.
  await getCatalogSnapshot();

  // BYOK: forwarded per-request, never logged or persisted. A mixed fan-out of
  // free + closed models is fine — each model resolves independently below, and
  // closed models without a key surface a per-column `key_required` error.
  const orKey = req.headers.get("x-openrouter-key") ?? undefined;
  const userKeys: UserKeys = orKey ? { openrouter: orKey } : {};

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: unknown) => controller.enqueue(encoder.encode(sse(e)));
      const answers: Record<string, string> = {};

      // 1. Fan out to all selected models concurrently (parallel exploration).
      await Promise.all(
        body.modelIds.map(async (id) => {
          const model = getModelById(id);
          if (!model) {
            send({ type: "model_error", id, message: "Unknown model" });
            return;
          }
          send({ type: "model_start", id, name: model.name, provider: model.provider });
          try {
            // surface which provider actually serves it
            const provider = resolveRoute(id, userKeys).route.provider;
            send({ type: "model_meta", id, provider });
            let full = "";
            for await (const delta of streamChat({
              modelId: id,
              messages: [
                { role: "system", content: SYSTEM },
                { role: "user", content: body.query },
              ],
              temperature: body.temperature ?? 0.6,
              signal: req.signal,
              userKeys,
            })) {
              full += delta;
              send({ type: "model_delta", id, text: delta });
            }
            answers[id] = full;
            send({ type: "model_done", id });
          } catch (e) {
            const err = e as RouterError;
            send({ type: "model_error", id, message: err.message ?? "Failed", code: err.code });
          }
        }),
      );

      // 2. Synthesize across the answers that succeeded.
      const got = Object.entries(answers).filter(([, v]) => v.trim().length > 0);
      if (got.length >= 1) {
        const synthId =
          body.synthesisModelId && getModelById(body.synthesisModelId)
            ? body.synthesisModelId
            : pickSynthesizer(body.modelIds, userKeys);

        send({ type: "synthesis_start", modelId: synthId });
        try {
          const corpus = got
            .map(([id, ans]) => `### ${getModelById(id)?.name ?? id}\n${ans}`)
            .join("\n\n");
          const prompt = `A user asked:\n"""${body.query}"""\n\nHere are answers from ${got.length} different models:\n\n${corpus}\n\nProduce a synthesis using EXACTLY this markdown structure and headings:\n\n## Synthesis\n<a single best merged answer, 2-5 sentences>\n\n## Agreements\n- <points most/all models agree on>\n\n## Divergences\n- <points where models disagree or differ in emphasis>\n\nBe concise and neutral.`;
          for await (const delta of streamChat({
            modelId: synthId,
            messages: [
              {
                role: "system",
                content:
                  "You are a careful synthesis agent. Merge multiple model answers, surfacing agreements and divergences. Never invent facts.",
              },
              { role: "user", content: prompt },
            ],
            temperature: 0.3,
            signal: req.signal,
            userKeys,
          })) {
            send({ type: "synthesis_delta", text: delta });
          }
          send({ type: "synthesis_done" });
        } catch (e) {
          const err = e as RouterError;
          send({ type: "synthesis_error", message: err.message ?? "Synthesis failed" });
        }
      }

      send({ type: "done" });
      controller.close();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

/** Prefer a model among the selected set that we can actually run as synthesizer. */
function pickSynthesizer(modelIds: string[], userKeys?: UserKeys): string {
  for (const id of modelIds) {
    try {
      resolveRoute(id, userKeys);
      return id;
    } catch {
      /* keep looking */
    }
  }
  return modelIds[0];
}
