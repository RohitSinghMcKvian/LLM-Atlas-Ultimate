import { NextRequest } from "next/server";
import { completeChat, RouterError, type UserKeys } from "@/lib/router";
import { getCatalogSnapshot } from "@/lib/catalog/store";
import { buildJudgePrompt, JUDGE_SYSTEM, judgeSchema, parseJudgeScores } from "@/lib/compare/judge";
import { callerKey, compareLimiter } from "@/lib/compare/rate-limit";
import type { EvidencePack, LaneState, Rubric } from "@/lib/compare/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The judge re-reads every answer, so its prompt is the largest in the run —
 * routinely larger than any single lane's. It needs the same ceiling.
 */
export const maxDuration = 300;

interface Body {
  task: string;
  rubric: Rubric;
  lanes: Pick<LaneState, "id" | "text">[];
  evidence?: EvidencePack;
  modelId: string;
}

/**
 * Score the answers against the run's rubric.
 *
 * Non-streaming: the output is a table that is useless until complete, and a
 * half-filled scorecard would invite reading a rank that is not final.
 *
 * The scoring is anonymised in `buildJudgePrompt` — the judge sees "Answer A",
 * never a model name — and the weighted total is computed client-side from the
 * rubric rather than asked for, so the number cannot disagree with its parts.
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
  if (!body.rubric?.criteria?.length) {
    return Response.json({ error: "a rubric with at least one criterion is required" }, { status: 400 });
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

  const { prompt, mapping, labels } = buildJudgePrompt({
    task: body.task,
    rubric: body.rubric,
    lanes: body.lanes,
    evidence: body.evidence,
  });

  const hasSources = (body.evidence?.sources.length ?? 0) > 0;

  if (labels.length === 0) {
    return Response.json({ scores: [], reason: "No answer had any text to score." });
  }

  try {
    const raw = await completeChat({
      modelId: body.modelId,
      messages: [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: prompt },
      ],
      // Low but not zero: scoring is a judgement, and a fully greedy decode
      // makes a judge stickier on its first impression than it should be.
      temperature: 0.1,
      maxTokens: 1_200,
      responseFormat: {
        type: "json_schema",
        json_schema: judgeSchema(body.rubric.criteria, labels, hasSources),
      },
      signal: req.signal,
      userKeys,
    });

    const scores = parseJudgeScores(raw, body.rubric, mapping, hasSources);
    return Response.json({
      scores,
      modelId: body.modelId,
      // An empty array from a judge that *did* answer means the reply was
      // unusable, which is a different fact from the judge never running.
      reason: scores.length === 0 ? "The judge's reply could not be read." : undefined,
    });
  } catch (e) {
    const err = e as RouterError;
    // No score beats a number nobody can defend.
    return Response.json({ scores: [], reason: err.message ?? "The judge could not be run." });
  }
}
