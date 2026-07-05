// INTAKE (Depth Spec v2 A.1): classify the prompt before running any
// ceremony. Trivial requests answer directly, bounded tasks skip the plan,
// complex tasks get the full loop. Clarifying questions are batched — asked
// once or not at all, never a drip.
//
// The prompt builders and the response parser are pure (tested); the single
// cheap model call happens through the LlmPort.

import type { TaskClassification } from "./types";

export interface IntakeResult {
  classification: TaskClassification;
  /** Batched clarifying questions — empty when defaults are safe. */
  questions: string[];
  /** Stated assumptions when proceeding without asking. */
  assumptions: string[];
}

export function intakeSystemPrompt(): string {
  return `You classify a coding task for an autonomous agent working in a small Node.js workspace. Reply with ONLY a JSON object:
{
  "classification": "trivial" | "bounded" | "complex",
  "questions": string[],
  "assumptions": string[]
}

- "trivial": answerable directly or a one-file, one-step change (rename a variable, explain code, tweak one line).
- "bounded": a clear small task — one feature or fix touching a couple of files, no ambiguity worth a question.
- "complex": multi-file work, new sub-systems, refactors, anything needing a plan.
- "questions": AT MOST 3, and ONLY for ambiguity that would waste a build cycle (framework? storage? design intent?). If safe defaults exist, ask nothing and record them in "assumptions" instead.`;
}

export function intakeUserPrompt(goal: string, fileListing: string): string {
  return `Task: ${goal}\n\nWorkspace files:\n${fileListing || "(empty workspace)"}`;
}

/** Tolerant parse — malformed output degrades to "bounded", no questions. */
export function parseIntake(raw: string): IntakeResult {
  const fallback: IntakeResult = { classification: "bounded", questions: [], assumptions: [] };
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return fallback;
  try {
    const obj = JSON.parse(m[0]);
    const cls = obj.classification;
    const classification: TaskClassification =
      cls === "trivial" || cls === "bounded" || cls === "complex" ? cls : "bounded";
    const strings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, 3) : [];
    return { classification, questions: strings(obj.questions), assumptions: strings(obj.assumptions) };
  } catch {
    return fallback;
  }
}
