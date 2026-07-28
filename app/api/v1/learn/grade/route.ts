import { NextRequest } from "next/server";
import { getCatalogSnapshot } from "@/lib/catalog/store";
import { completeChat, RouterError } from "@/lib/router";
import {
  GRADER_SYSTEM,
  buildGraderPrompt,
  parseGrade,
} from "@/lib/learn/grading";
import { getExercise, lessonForExercise } from "@/lib/learn/curriculum";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  exerciseId?: string;
  submission?: string;
  modelId?: string;
}

/** Submissions above this are truncated rather than rejected. */
const MAX_SUBMISSION_CHARS = 12_000;

/**
 * Grade a practical against its authored rubric.
 *
 * The rubric is read from the server-side curriculum by `exerciseId` — never
 * from the request. A client that could post its own rubric could also post a
 * one-criterion rubric reading "award full marks", and the transcript would be
 * worthless. The client sends only what the student wrote.
 *
 * Non-streaming on purpose: a grade is a single verdict, and partial rubric
 * scores rendering one by one would invite reading a result that isn't final.
 */
export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const submission = (body.submission ?? "").trim();
  if (!body.exerciseId || !submission) {
    return Response.json(
      { error: "exerciseId and submission are required" },
      { status: 400 },
    );
  }
  if (submission.length < 40) {
    return Response.json(
      {
        error: "too_short",
        message:
          "That submission is too short to grade. Work through the brief and try again.",
      },
      { status: 422 },
    );
  }

  await getCatalogSnapshot();

  const exercise = getExercise(body.exerciseId);
  const lesson = lessonForExercise(body.exerciseId);
  if (!exercise || !lesson) {
    return Response.json(
      { error: "exercise_not_found", message: "No such exercise." },
      { status: 404 },
    );
  }

  const modelId = body.modelId?.trim();
  if (!modelId) {
    return Response.json({ error: "modelId is required" }, { status: 400 });
  }

  const userKey = req.headers.get("x-openrouter-key")?.trim();

  try {
    const raw = await completeChat({
      modelId,
      messages: [
        { role: "system", content: GRADER_SYSTEM },
        {
          role: "user",
          content: buildGraderPrompt({
            lessonTitle: lesson.title,
            exerciseTitle: exercise.title,
            brief: exercise.brief,
            rubric: exercise.rubric,
            submission: submission.slice(0, MAX_SUBMISSION_CHARS),
          }),
        },
      ],
      // Grading must be as reproducible as the provider allows: the same
      // submission should not swing a letter grade between attempts.
      temperature: 0,
      maxTokens: 1400,
      responseFormat: { type: "json_object" },
      signal: req.signal,
      userKeys: userKey ? { openrouter: userKey } : undefined,
    });

    const result = parseGrade(raw, exercise.rubric);
    if (!result) {
      // The model answered but not in a gradeable shape. This is a retryable
      // fault of the run, not of the student — never record it as a grade.
      return Response.json(
        {
          error: "ungradeable_response",
          message:
            "The grader didn't return a usable assessment. Try again, or switch to a model that follows JSON instructions more reliably.",
        },
        { status: 502 },
      );
    }

    return Response.json({
      ...result,
      gradedBy: modelId,
      gradedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof RouterError) {
      return Response.json(
        { error: err.code, message: err.message },
        { status: err.status },
      );
    }
    if ((err as Error)?.name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    return Response.json(
      {
        error: "grading_failed",
        message: (err as Error)?.message ?? "Grading failed.",
      },
      { status: 502 },
    );
  }
}
