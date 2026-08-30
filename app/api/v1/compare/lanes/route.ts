import { NextRequest } from "next/server";
import { streamChatEvents, RouterError, type ChatMessage, type UserKeys } from "@/lib/router";
import { sse, SSE_HEADERS } from "@/lib/router/sse";
import { getCatalogSnapshot } from "@/lib/catalog/store";
import { getModelById } from "@/lib/catalog";
import { fanOut } from "@/lib/engine/orchestrator";
import { MAX_CONTINUATIONS, RESUME_INSTRUCTION, shouldContinue, stitch } from "@/lib/chat/continuation";

/**
 * Floor for a continuation request.
 *
 * Asking for 0 or a handful of tokens produces a request that cannot finish a
 * sentence, so the remainder is never allowed below this — the budget check
 * above stops the loop instead.
 */
const MIN_CONTINUATION_TOKENS = 128;
import { callerKey, compareLimiter } from "@/lib/compare/rate-limit";
import { MAX_LANES, type LaneEvent } from "@/lib/compare/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Compare fans out to several models at once, so its worst case is longer than
 * chat's, not shorter — yet the route this replaces declared no `maxDuration`
 * at all and inherited the platform default. A stream cut at that default is
 * indistinguishable client-side from a model that stopped talking, so a run
 * would present a truncated answer as a finished one.
 *
 * 300 s is the Vercel Hobby ceiling. It is survivable here only because the run
 * is staged: this route carries the lanes and nothing else, and the client
 * re-issues it with whichever lane ids never finished.
 */
export const maxDuration = 300;

interface LaneRequest {
  id: string;
  modelId: string;
  maxTokens: number;
}

interface Body {
  runId: string;
  /** The brief's restated task. What every lane is actually asked. */
  question: string;
  lanes: LaneRequest[];
  systemPrompt?: string;
  /**
   * The shared evidence, already numbered by `formatResearchContext`.
   *
   * Identical for every lane — that is the whole design. Lanes whose context
   * window could not hold it send a retrieved slice in `laneContext` instead.
   */
  sharedContext?: string;
  laneContext?: Record<string, string>;
  /**
   * The lane's own prior answers in this session, oldest first.
   *
   * Only ever this lane's. Multi-turn Compare gives each model its own thread so
   * that a follow-up still measures the model rather than how well it continues
   * another model's reasoning; merging the lanes into one shared history would
   * be cheaper and would destroy the thing being compared.
   *
   * Already fitted to the model's window by `lib/compare/thread.ts`, so the route
   * forwards it rather than re-deciding what fits.
   */
  history?: { role: string; content: string }[];
  temperature?: number;
}

const DEFAULT_SYSTEM =
  "Answer the question directly and completely. If sources are provided, cite them inline by " +
  "number and do not assert anything they do not support — say what you could not establish " +
  "instead. Do not mention that other models are answering the same question.";

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.question?.trim() || !Array.isArray(body.lanes) || body.lanes.length === 0) {
    return Response.json({ error: "question and at least one lane are required" }, { status: 400 });
  }

  // The ramp has six bands and a lane's band is its identity, so six is also the
  // hard server-side cap — not a UI convention the client could talk its way out
  // of by posting a longer array.
  if (body.lanes.length > MAX_LANES) {
    return Response.json(
      { error: `A run may compare at most ${MAX_LANES} models.`, code: "too_many_lanes" },
      { status: 400 },
    );
  }

  // One token per lane: a six-lane Deep run is genuinely six times the load of a
  // one-lane Quick run, and a per-request limit would price them the same.
  const decision = compareLimiter.check(callerKey(req.headers), body.lanes.length);
  if (!decision.ok) {
    return Response.json(
      {
        error: "Too many comparison lanes started from this address. Try again shortly.",
        code: "rate_limited",
        retryAfterMs: decision.retryAfterMs,
      },
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil(decision.retryAfterMs / 1000)) },
      },
    );
  }

  // The catalog is a runtime snapshot; every model added by the daily sync 404s
  // unless it is loaded before any id is resolved.
  await getCatalogSnapshot();

  // BYOK, forwarded per request. Never logged, never persisted.
  const orKey = req.headers.get("x-openrouter-key") ?? undefined;
  const userKeys: UserKeys = orKey ? { openrouter: orKey } : {};

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (e: LaneEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(sse(e)));
      };

      const jobs = body.lanes.map((lane) => ({
        id: lane.id,
        run: () => runLane(lane, body, userKeys, req.signal, send),
      }));

      try {
        // The concurrency cap is the client's, computed by the lane planner from
        // the run's depth. Clamped here so a caller cannot ask for more upstream
        // connections than lanes.
        await fanOut(jobs, Math.min(body.lanes.length, MAX_LANES), req.signal);
        send({ type: "stage_done" });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

/**
 * Stream one lane into the shared channel.
 *
 * Never throws: `fanOut` captures rejections per job, but a lane failing is a
 * normal outcome here — a mixed set of free and BYOK-only models is legal, and
 * one lane reporting `key_required` must not disturb the other five.
 */
async function runLane(
  lane: LaneRequest,
  body: Body,
  userKeys: UserKeys,
  signal: AbortSignal,
  send: (e: LaneEvent) => void,
): Promise<void> {
  const startedAt = Date.now();
  let ttftMs: number | undefined;

  send({ type: "lane_start", id: lane.id, modelId: lane.modelId });

  const model = getModelById(lane.modelId);
  if (!model) {
    send({ type: "lane_error", id: lane.id, message: "This model is no longer in the catalog.", code: "model_not_found" });
    return;
  }

  const context = body.laneContext?.[lane.id] ?? body.sharedContext;

  // Only user and assistant turns are carried. A stray role from a malformed
  // body would either be rejected by the provider or, worse, accepted as a
  // second system prompt.
  const history = (body.history ?? [])
    .filter(
      (m): m is { role: "user" | "assistant"; content: string } =>
        (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string",
    )
    .map((m) => ({ role: m.role, content: m.content }));

  const messages: ChatMessage[] = [
    { role: "system", content: body.systemPrompt?.trim() || DEFAULT_SYSTEM },
    // The evidence pack sits above the conversation, not inside it: it is the
    // same for every turn, and repeating it per turn would grow the prompt by a
    // whole pack each time.
    ...(context ? [{ role: "system" as const, content: context }] : []),
    ...history,
    { role: "user", content: body.question },
  ];

  let full = "";
  let continuations = 0;
  // The first `provider` event names the route that was chosen, not a fallback.
  // Only the ones after it are failovers.
  let providerEvents = 0;
  // Usage arrives once per upstream call, so a stitched answer reports several.
  // Summed rather than replaced — otherwise a continuation would erase the cost
  // of the part it is continuing.
  let promptTokens = 0;
  let completionTokens = 0;
  let imageTokens = 0;

  try {
    for (;;) {
      let finishReason: string | undefined;
      let roundText = "";

      // `lane.maxTokens` is the ceiling for the whole answer, not for one
      // request. Each continuation asks only for what is left, so a stitched
      // answer costs what the planner budgeted rather than up to four times it.
      const remaining = Math.max(MIN_CONTINUATION_TOKENS, lane.maxTokens - completionTokens);

      for await (const ev of streamChatEvents({
        modelId: lane.modelId,
        messages,
        temperature: body.temperature ?? 0.6,
        maxTokens: remaining,
        signal,
        userKeys,
      })) {
        switch (ev.type) {
          case "token":
            if (ttftMs === undefined) ttftMs = Date.now() - startedAt;
            roundText += ev.text;
            send({ type: "lane_delta", id: lane.id, text: ev.text });
            break;
          case "reasoning":
            send({ type: "lane_reasoning", id: lane.id, text: ev.text });
            break;
          case "usage":
            promptTokens += ev.usage.promptTokens ?? 0;
            completionTokens += ev.usage.completionTokens ?? 0;
            imageTokens += ev.usage.imageTokens ?? 0;
            break;
          case "provider":
            // A free model can fall through to a backup provider mid-request.
            // Corrects the client's optimistic pre-flight guess, and the count
            // is a reliability signal worth showing in the trace.
            providerEvents++;
            send({ type: "lane_meta", id: lane.id, provider: ev.provider });
            break;
          case "capability":
            send({ type: "lane_capability", id: lane.id, capability: ev.capability, supported: ev.supported });
            break;
          case "done":
            finishReason = ev.finishReason;
            break;
        }
      }

      full = continuations === 0 ? roundText : stitch(full, roundText);

      // Out of budget is a reason to stop, not to keep asking: the answer is
      // truncated either way, and the UI reports `finishReason: "length"` so the
      // user can see it was cut rather than finished.
      const spent = completionTokens >= lane.maxTokens;
      if (spent || !shouldContinue(finishReason, continuations, MAX_CONTINUATIONS)) {
        send({
          type: "lane_usage",
          id: lane.id,
          promptTokens,
          completionTokens,
          imageTokens,
        });
        send({
          type: "lane_done",
          id: lane.id,
          finishReason,
          ms: Date.now() - startedAt,
          ttftMs,
          failovers: Math.max(0, providerEvents - 1),
          continuations,
        });
        return;
      }

      // Ask for the rest. The partial answer goes back as the assistant turn so
      // the model continues it rather than starting over.
      continuations++;
      send({ type: "lane_continue", id: lane.id });
      messages.push({ role: "assistant", content: full });
      messages.push({ role: "user", content: RESUME_INSTRUCTION });
    }
  } catch (e) {
    const err = e as RouterError;
    // A client abort is the user pressing Stop, not a failure. The client
    // already knows; emitting an error here would overwrite the lane's own
    // `stopped` state with a red banner.
    if (signal.aborted || (e as Error)?.name === "AbortError") return;
    send({
      type: "lane_error",
      id: lane.id,
      message: err.message ?? "This lane failed.",
      code: err.code ?? "upstream_error",
    });
  }
}
