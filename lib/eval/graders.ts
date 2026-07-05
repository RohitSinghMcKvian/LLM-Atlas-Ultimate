// Eval graders (Depth Spec v2 D.1) — the single grading implementation shared
// by the Bench module's built-in suites and the Playground eval lab.
//
// Phase 0 ships the deterministic text graders (grown from lib/bench/suites.ts
// `grade()`); `json-schema` and `llm-judge` land with the eval lab (Phase 5).
//
// Pure and framework-agnostic — unit-tested under vitest/node.

export type GraderDef =
  | { type: "exact"; value: string }
  | { type: "contains"; value: string }
  | { type: "regex"; value: string }
  | { type: "json" }
  | { type: "wordcount"; value: number };

/** Extract the first fenced code block, else the whole string. */
export function stripFence(s: string): string {
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
  return (m ? m[1] : s).trim();
}

/**
 * Grade a model output against a deterministic grader. Case-insensitive for
 * exact/contains/regex — matching the pre-v2 Bench behavior.
 */
export function gradeText(grader: GraderDef, output: string): boolean {
  const out = output.trim();
  switch (grader.type) {
    case "exact":
      return out.toLowerCase() === grader.value.trim().toLowerCase();
    case "contains":
      return out.toLowerCase().includes(grader.value.toLowerCase());
    case "regex":
      try {
        return new RegExp(grader.value, "i").test(out);
      } catch {
        return false;
      }
    case "json":
      try {
        JSON.parse(stripFence(out));
        return true;
      } catch {
        return false;
      }
    case "wordcount": {
      const words = out
        .replace(/[.,!?;:]/g, "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      return words.length === grader.value;
    }
  }
}
