import { gradeText } from "@/lib/eval/graders";

export type Check =
  | { type: "contains"; value: string }
  | { type: "regex"; value: string }
  | { type: "json" }
  | { type: "wordcount"; value: number };

export interface EvalCase {
  id: string;
  prompt: string;
  check: Check;
  /** Human-readable expectation, shown in the UI. */
  expect: string;
}

export interface EvalSuite {
  id: string;
  name: string;
  about: string;
  judge: string;
  cases: EvalCase[];
}

export const SUITES: EvalSuite[] = [
  {
    id: "arithmetic",
    name: "Reasoning · arithmetic",
    about: "Short numeric reasoning with deterministic answers.",
    judge: "exact-substring",
    cases: [
      {
        id: "a1",
        prompt: "What is 17 × 23? Reply with just the number.",
        check: { type: "contains", value: "391" },
        expect: "contains 391",
      },
      {
        id: "a2",
        prompt:
          "A train travels 60 mph for 2.5 hours. How many miles? Reply with just the number.",
        check: { type: "contains", value: "150" },
        expect: "contains 150",
      },
      {
        id: "a3",
        prompt: "How many letter r's are in 'strawberry'? Reply with just the number.",
        check: { type: "contains", value: "3" },
        expect: "contains 3",
      },
    ],
  },
  {
    id: "format",
    name: "Format · structured output",
    about: "Valid, constrained structured outputs.",
    judge: "schema-validate",
    cases: [
      {
        id: "f1",
        prompt:
          'Return ONLY a JSON object with keys "name" set to "Atlas" and "year" set to 2026. No prose.',
        check: { type: "json" },
        expect: "parses as JSON",
      },
      {
        id: "f2",
        prompt:
          "Return ONLY a JSON array of exactly three color names as strings. No prose.",
        check: { type: "json" },
        expect: "parses as JSON",
      },
    ],
  },
  {
    id: "instruction",
    name: "Instruction following",
    about: "Precise adherence to output constraints.",
    judge: "regex / wordcount",
    cases: [
      {
        id: "i1",
        prompt: "Reply with exactly the single word: ACKNOWLEDGED",
        check: { type: "regex", value: "^\\s*ACKNOWLEDGED\\s*$" },
        expect: "exactly 'ACKNOWLEDGED'",
      },
      {
        id: "i2",
        prompt: "Describe the ocean in exactly three words. No punctuation.",
        check: { type: "wordcount", value: 3 },
        expect: "exactly 3 words",
      },
    ],
  },
];

// Grading is shared with the Playground eval lab (Depth v2 D.1) — a bench
// Check is a subset of GraderDef, so it delegates directly.
export function grade(check: Check, output: string): boolean {
  return gradeText(check, output);
}

export const TOTAL_CASES = SUITES.reduce((n, s) => n + s.cases.length, 0);
