// Did the answer obey the instructions it was given?
//
// The brief produces `groundRules` — "at most 200 words", "reply as JSON",
// "include a table". Those are checkable without a model, and checking them
// deterministically is strictly better than asking a judge: it costs nothing, it
// cannot be talked out of a verdict, and it is the same answer every time.
//
// Rules are turned into the graders that already exist in `lib/eval/graders.ts`,
// which is the module whose header reserved exactly this kind of use. A rule
// nothing can be derived from is reported as unchecked rather than silently
// passed — claiming compliance nobody verified is worse than admitting the gap.

import { gradeText, type GraderDef } from "@/lib/eval/graders";
import { stripCode } from "./text";

export interface RuleCheck {
  rule: string;
  grader?: GraderDef;
  /** Undefined when no grader could be derived from the rule. */
  passed?: boolean;
}

export interface ComplianceReport {
  checks: RuleCheck[];
  /** Rules that were checked and passed. */
  passed: number;
  /** Rules that were checked and failed. */
  failed: number;
  /** Rules no deterministic check could be derived from. */
  unchecked: number;
  /** Share of *checkable* rules that passed, 0-1. Null when nothing was checkable. */
  score: number | null;
}

const WORD_LIMIT =
  /\b(?:at most|no more than|under|fewer than|less than|maximum(?: of)?|max)\s+(\d{1,5})\s+words?\b/i;
const WORD_MINIMUM = /\b(?:at least|no fewer than|minimum(?: of)?|more than)\s+(\d{1,5})\s+words?\b/i;
const EXACT_WORDS = /\bexactly\s+(\d{1,5})\s+words?\b/i;

/**
 * Turn one ground rule into a check, when one can be derived.
 *
 * Only patterns with an unambiguous reading are matched. A rule like "be
 * concise" has no threshold and gets no grader — guessing one would produce a
 * confident pass or fail from an invented number.
 */
export function graderForRule(rule: string): GraderDef | undefined {
  const text = rule.trim();
  if (!text) return undefined;

  const exact = EXACT_WORDS.exec(text);
  if (exact) return { type: "wordcount", value: Number(exact[1]) };

  // Word limits are a bound, not an equality, so `wordcount` (which tests
  // equality) is the wrong grader — the caller enforces bounds itself.
  if (WORD_LIMIT.test(text) || WORD_MINIMUM.test(text)) return undefined;

  if (/\bjson\b/i.test(text)) return { type: "json" };
  if (/\b(?:table|markdown table)\b/i.test(text)) return { type: "regex", value: "\\|.*\\|" };
  if (/\b(?:code block|fenced code|code sample)\b/i.test(text)) {
    return { type: "regex", value: "```" };
  }
  if (/\bbullet(?:s| points?| list)\b/i.test(text)) {
    return { type: "regex", value: "(?:^|\\n)\\s*(?:[-*+]|\\d+[.)])\\s+" };
  }

  const quoted = /["“]([^"”]{3,60})["”]/.exec(text);
  if (quoted) return { type: "contains", value: quoted[1] };

  return undefined;
}

/** Word count over prose, matching how `lengthProfile` counts. */
function wordCount(text: string): number {
  return stripCode(text)
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w)).length;
}

/**
 * Bounds are handled here rather than by a grader.
 *
 * `gradeText`'s `wordcount` tests equality, which is right for "exactly 50
 * words" and wrong for "at most 200" — using it for a limit would fail every
 * answer that came in under.
 */
function checkBound(rule: string, output: string): boolean | undefined {
  const limit = WORD_LIMIT.exec(rule);
  if (limit) return wordCount(output) <= Number(limit[1]);
  const minimum = WORD_MINIMUM.exec(rule);
  if (minimum) return wordCount(output) >= Number(minimum[1]);
  return undefined;
}

export function checkCompliance(rules: string[], output: string): ComplianceReport {
  const checks: RuleCheck[] = rules.map((rule) => {
    const bound = checkBound(rule, output);
    if (bound !== undefined) return { rule, passed: bound };
    const grader = graderForRule(rule);
    if (!grader) return { rule };
    return { rule, grader, passed: gradeText(grader, output) };
  });

  const passed = checks.filter((c) => c.passed === true).length;
  const failed = checks.filter((c) => c.passed === false).length;
  const checkable = passed + failed;

  return {
    checks,
    passed,
    failed,
    unchecked: checks.length - checkable,
    score: checkable > 0 ? passed / checkable : null,
  };
}

/** One line for the scorecard. */
export function describeCompliance(report: ComplianceReport): string {
  if (report.checks.length === 0) return "No format rules were set.";
  if (report.failed === 0 && report.passed > 0) {
    return `Followed all ${report.passed} checkable rule${report.passed === 1 ? "" : "s"}.`;
  }
  if (report.failed > 0) {
    return `Broke ${report.failed} of ${report.passed + report.failed} format rules.`;
  }
  return `${report.unchecked} rule${report.unchecked === 1 ? "" : "s"} could not be checked automatically.`;
}
