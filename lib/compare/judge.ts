// Scoring the answers against the run's own rubric.
//
// This lands the `llm-judge` grader that `lib/eval/graders.ts` reserved in its
// header and never shipped. Four decisions make the number worth printing:
//
//   * **The judge does not compete.** `pickArbiter` prefers a model outside the
//     lane set. The old code chose the first *compared* model to write the
//     synthesis, which is the one arrangement guaranteed to flatter it.
//   * **The lanes are anonymous to it.** Answers arrive as "Answer A", "Answer
//     B". A judge that can see it is scoring its own family has a thumb on the
//     scale, and hiding the names costs nothing.
//   * **The total is arithmetic, not opinion.** The model scores each criterion;
//     the weighted total is computed here. Asking a model for a weighted average
//     is asking it to do arithmetic it is bad at, over weights it cannot see.
//   * **Failure is visible.** No score at all beats a number nobody can defend,
//     so a judge that could not be run leaves the scorecard empty and says why.

import type { Criterion, EvidencePack, JudgeScore, LaneState, Rubric } from "./types";

/** Answers are labelled A, B, C… so the judge cannot recognise a model. */
export function anonLabel(index: number): string {
  return `Answer ${String.fromCharCode(65 + index)}`;
}

export const JUDGE_SYSTEM =
  "You score answers against a fixed rubric. You are given several answers to the same question, " +
  "labelled A, B, C and so on, and you do not know which model wrote any of them — do not guess, " +
  "and do not let writing style stand in for quality. Score every criterion from 0 to 10 on its " +
  "own terms. A long answer is not automatically better than a short one. If sources are provided, " +
  "an answer that asserts something they do not support should lose marks for it. If no sources " +
  "are provided, do not report unsupported claims at all — there is nothing to check them against.";

export function judgeSchema(criteria: Criterion[], labels: string[], hasSources = true) {
  return {
    name: "compare_scores",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["scores"],
      properties: {
        scores: {
          type: "array",
          minItems: labels.length,
          maxItems: labels.length,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "criteria", "justification", "unsupported"],
            properties: {
              label: { type: "string", enum: labels },
              criteria: {
                type: "object",
                additionalProperties: false,
                required: criteria.map((c) => c.id),
                properties: Object.fromEntries(
                  criteria.map((c) => [
                    c.id,
                    { type: "number", description: `${c.name}: ${c.description}. 0-10.` },
                  ]),
                ),
              },
              justification: { type: "string", description: "One sentence. What decided the score." },
              unsupported: {
                type: "array",
                maxItems: 5,
                items: { type: "string" },
                description: hasSources
                  ? "Claims this answer makes that the sources do not support. Empty if none."
                  : // No pack to check against, so there is nothing this field can
                    // mean. Asked for anyway because the schema is strict, but the
                    // model is told to leave it alone rather than inventing
                    // findings from an empty evidence set.
                    "Leave this empty. No sources were provided, so grounding cannot be judged.",
              },
            },
          },
        },
      },
    },
  };
}

export interface JudgePromptInput {
  task: string;
  rubric: Rubric;
  lanes: Pick<LaneState, "id" | "text">[];
  evidence?: EvidencePack;
}

export interface JudgePrompt {
  prompt: string;
  /** Label to lane id, so the anonymised scores can be mapped back. */
  mapping: Record<string, string>;
  labels: string[];
}

/**
 * Build the judging prompt.
 *
 * Only lanes with text are included: a failed lane has nothing to score, and
 * including it would invite the judge to score its error message.
 */
export function buildJudgePrompt(input: JudgePromptInput): JudgePrompt {
  const answering = input.lanes.filter((l) => l.text.trim().length > 0);
  const mapping: Record<string, string> = {};
  const labels: string[] = [];

  const blocks = answering.map((lane, i) => {
    const label = anonLabel(i);
    mapping[label] = lane.id;
    labels.push(label);
    return `### ${label}\n${lane.text.trim()}`;
  });

  const rubricText = input.rubric.criteria
    .map((c) => `- ${c.id} — ${c.name}: ${c.description} (weight ${(c.weight * 100).toFixed(0)}%)`)
    .join("\n");

  const sources =
    input.evidence && input.evidence.sources.length > 0
      ? `\n\nThe answers were given these sources. Judge grounding against them, by number:\n${input.evidence.sources
          .map((s, i) => `[${i + 1}] ${s.title} — ${s.snippet}`)
          .join("\n")}`
      : "";

  return {
    labels,
    mapping,
    prompt:
      `Question:\n"""${input.task}"""\n\nRubric:\n${rubricText}${sources}\n\n` +
      `Answers to score:\n\n${blocks.join("\n\n")}`,
  };
}

interface RawScore {
  label?: unknown;
  criteria?: unknown;
  justification?: unknown;
  unsupported?: unknown;
}

function clamp10(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(10, v));
}

/**
 * Read the judge's reply back into per-lane scores.
 *
 * The weighted total is computed here from the rubric's own weights. Asking the
 * model for it would be asking for arithmetic over numbers it was never shown,
 * and a total that disagrees with its own parts is worse than no total.
 *
 * Returns `[]` rather than throwing on unusable output: the scorecard being
 * empty is a state the UI handles, and a run should not fail because a judge
 * emitted a stray token.
 */
export function parseJudgeScores(
  raw: string,
  rubric: Rubric,
  mapping: Record<string, string>,
  hasSources = true,
): JudgeScore[] {
  let parsed: { scores?: unknown };
  try {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
    parsed = JSON.parse((fenced ? fenced[1] : raw).trim());
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.scores)) return [];

  const out: JudgeScore[] = [];
  for (const entry of parsed.scores as RawScore[]) {
    const label = typeof entry?.label === "string" ? entry.label : "";
    const laneId = mapping[label];
    // A label the prompt never issued is a hallucinated answer; scoring it would
    // put a number against a lane that does not exist.
    if (!laneId) continue;

    const rawCriteria = (entry.criteria ?? {}) as Record<string, unknown>;
    const scores: Record<string, number> = {};
    let total = 0;
    for (const criterion of rubric.criteria) {
      const value = clamp10(rawCriteria[criterion.id]);
      scores[criterion.id] = value;
      total += value * criterion.weight;
    }

    out.push({
      laneId,
      scores,
      total: Math.round(total * 10) / 10,
      justification: typeof entry.justification === "string" ? entry.justification.trim() : "",
      // Grounding cannot be judged without a pack. A model asked anyway will
      // produce findings, and reporting them would flag an answer as unsupported
      // against evidence that never existed.
      unsupported: !hasSources
        ? []
        : Array.isArray(entry.unsupported)
          ? entry.unsupported
              .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
              .slice(0, 5)
          : [],
    });
  }
  return out;
}

/** Rank lanes by score, highest first. Ties keep their original order. */
export function rankByScore(scores: JudgeScore[]): JudgeScore[] {
  return [...scores].sort((a, b) => b.total - a.total);
}

/** One line for the run spine. */
export function describeScores(scores: JudgeScore[], judgeName?: string): string {
  if (scores.length === 0) return "No scores — the judge could not be run";
  const by = judgeName ? ` by ${judgeName}` : "";
  return `${scores.length} answer${scores.length === 1 ? "" : "s"} scored${by}`;
}
