import { NextRequest } from "next/server";
import { streamChatEvents, RouterError, type UserKeys } from "@/lib/router";
import { sse, SSE_HEADERS } from "@/lib/router/sse";
import { getCatalogSnapshot } from "@/lib/catalog/store";
import {
  buildSynthesisPrompt,
  parseSynthesis,
  SYNTHESIS_SCHEMA,
  SYNTHESIS_SYSTEM,
} from "@/lib/compare/synthesis";
import { callerKey, compareLimiter } from "@/lib/compare/rate-limit";
import type { EvidencePack, LaneState, SynthesisEvent } from "@/lib/compare/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Body {
  task: string;
  lanes: Pick<LaneState, "id" | "text">[];
  evidence?: EvidencePack;
  clusters?: string[][];
  outlier?: string;
  modelId: string;
}

/**
 * Merge the answers into one.
 *
 * Streams, unlike the judge: the merged answer is prose someone reads top to
 * bottom, and watching it arrive is better than waiting for it. The deltas are
 * raw model output — which is JSON, since the schema is enforced — so the client
 * shows a progress pulse rather than the tokens, and renders the parsed answer
 * on `synthesis_done`.
 *
 * The `structured` flag on the parse is what lets the UI tell "this model
 * ignored the schema, so there are genuinely no agreements listed" apart from
 * "it found none". The contract this replaces could not distinguish those.
 */
export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.task?.trim() || !body.modelId || !Array.isArray(body.lanes)) {
    return Response.json({ error: "task, modelId and lanes are required" }, { status: 400 });
  }

  const decision = compareLimiter.check(callerKey(req.headers), 1);
  if (!decision.ok) {
    return Response.json(
      { error: "Too many comparison runs from this address. Try again shortly.", code: "rate_limited" },
      { status: 429, headers: { "retry-after": String(Math.ceil(decision.retryAfterMs / 1000)) } },
    );
  }

  await getCatalogSnapshot();

  const orKey = req.headers.get("x-openrouter-key") ?? undefined;
  const userKeys: UserKeys = orKey ? { openrouter: orKey } : {};

  const { prompt } = buildSynthesisPrompt({
    task: body.task,
    lanes: body.lanes,
    evidence: body.evidence,
    clusters: body.clusters,
    outlier: body.outlier,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (e: SynthesisEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(sse(e)));
      };

      let full = "";
      try {
        for await (const ev of streamChatEvents({
          modelId: body.modelId,
          messages: [
            { role: "system", content: SYNTHESIS_SYSTEM },
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
          // A three-lane merge plus three lists does not fit in 2k: measured
          // live, the answer alone consumed the whole budget and the lists —
          // the part a reader cannot get from the answers themselves — never
          // arrived. The schema now bounds the answer; this bounds the rest.
          maxTokens: 3_500,
          responseFormat: { type: "json_schema", json_schema: SYNTHESIS_SCHEMA },
          signal: req.signal,
          userKeys,
        })) {
          if (ev.type === "token") {
            full += ev.text;
            send({ type: "synthesis_delta", text: ev.text });
          }
        }
        send({ type: "synthesis_done", synthesis: parseSynthesis(full, body.modelId) });
      } catch (e) {
        const err = e as RouterError;
        if (!req.signal.aborted) {
          send({ type: "synthesis_error", message: err.message ?? "The merge could not be produced." });
          // Whatever arrived before the failure is still worth showing.
          if (full.trim()) {
            send({ type: "synthesis_done", synthesis: parseSynthesis(full, body.modelId) });
          }
        }
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
