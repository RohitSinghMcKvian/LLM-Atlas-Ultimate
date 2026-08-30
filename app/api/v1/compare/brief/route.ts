import { NextRequest } from "next/server";
import { completeChat, RouterError, type UserKeys } from "@/lib/router";
import { getCatalogSnapshot } from "@/lib/catalog/store";
import { BRIEF_SCHEMA, BRIEF_SYSTEM, briefPrompt, fallbackBrief, parseBrief } from "@/lib/compare/brief";
import { callerKey, compareLimiter } from "@/lib/compare/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Short by design — one small model call with a bounded JSON schema — but it
 * still declares the ceiling, because a route that inherits the platform default
 * fails in a way that is indistinguishable from a model refusing to answer.
 */
export const maxDuration = 300;

interface Body {
  question: string;
  modelId: string;
  /** Force retrieval on or off instead of letting the brief decide. */
  web?: boolean;
}

/**
 * Prepare the run: restate the task, derive a rubric, decide what to search.
 *
 * Non-streaming on purpose. The output is a small structured object that is
 * useless until it is complete, so streaming it would only mean rendering a
 * half-built rubric.
 *
 * Never fails the run. A brief that cannot be produced degrades to a generic
 * rubric — the response says so with `fallback: true` — because refusing to
 * compare anything over a failed preparation step is far worse than comparing
 * against criteria the user can see are generic.
 */
export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.question?.trim() || !body.modelId) {
    return Response.json({ error: "question and modelId are required" }, { status: 400 });
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

  try {
    const raw = await completeChat({
      modelId: body.modelId,
      messages: [
        { role: "system", content: BRIEF_SYSTEM },
        { role: "user", content: briefPrompt(body.question, { web: body.web }) },
      ],
      temperature: 0.2,
      maxTokens: 800,
      // Structured output rather than the mandated-markdown-headings contract
      // this replaces, which a model breaks by writing "## Synthesis:".
      responseFormat: { type: "json_schema", json_schema: BRIEF_SCHEMA },
      signal: req.signal,
      userKeys,
    });

    const brief = parseBrief(raw, body.question, body.modelId);
    return Response.json({ brief, fallback: false });
  } catch (e) {
    const err = e as RouterError;
    return Response.json({
      brief: fallbackBrief(body.question),
      fallback: true,
      reason: err.message ?? "The brief could not be prepared.",
    });
  }
}
