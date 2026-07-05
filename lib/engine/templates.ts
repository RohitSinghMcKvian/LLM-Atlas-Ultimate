// Task templates (Depth Spec v2 B.4): one-click flows that pre-tune the Task
// Loop's plan skeleton so the model refines rather than invents. Each template
// maps a slash command to an intake hint (biasing classification), a plan
// skeleton, a role bias, and a verification emphasis.
//
// Pure data + a small resolver — unit-tested.

import type { TaskClassification } from "./types";

export interface PlanSkeletonItem {
  text: string;
  acceptance: string;
}

export interface TaskTemplate {
  id: string;
  command: string;
  label: string;
  description: string;
  /** Force classification when the template implies scope. */
  classifyAs?: TaskClassification;
  /** Pre-filled plan the model may refine (empty ⇒ model plans freely). */
  planSkeleton: PlanSkeletonItem[];
  /** Preferred subagent role for execution. */
  roleBias?: "implementer" | "tester" | "reviewer" | "researcher";
  /** Extra guidance folded into the goal. */
  guidance: string;
  /** Placeholder shown in the composer when the template is chosen. */
  argHint: string;
}

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: "fix-issue",
    command: "/fix-issue",
    label: "Fix issue",
    description: "Paste an error or issue; reproduce, diagnose, fix, and verify.",
    classifyAs: "complex",
    roleBias: "implementer",
    argHint: "Paste the error text / issue description…",
    guidance:
      "Reproduce the problem first (write a failing test if none exists), find the root cause via the stack trace, apply the minimal fix, and prove it with the failing check now passing.",
    planSkeleton: [
      { text: "Reproduce the failure", acceptance: "a command or test reliably shows the bug" },
      { text: "Diagnose the root cause from the stack trace", acceptance: "the failing file:line is identified" },
      { text: "Apply the minimal fix", acceptance: "the previously failing check now passes" },
      { text: "Check for regressions", acceptance: "the full test suite passes" },
    ],
  },
  {
    id: "add-feature",
    command: "/add-feature",
    label: "Add feature",
    description: "Scaffold a feature with tests and a clean, verified diff.",
    classifyAs: "complex",
    roleBias: "implementer",
    argHint: "Describe the feature…",
    guidance:
      "Design the smallest change that satisfies the request, implement it consistent with existing conventions, and cover it with a happy-path test plus one edge case.",
    planSkeleton: [
      { text: "Implement the feature", acceptance: "the feature works when exercised" },
      { text: "Add happy-path and edge-case tests", acceptance: "the new tests pass" },
    ],
  },
  {
    id: "write-tests",
    command: "/write-tests",
    label: "Write tests",
    description: "Add focused tests for existing behavior without touching implementation.",
    classifyAs: "bounded",
    roleBias: "tester",
    argHint: "What behavior should be tested?",
    guidance:
      "Write tests ONLY — do not modify implementation files. Cover the happy path and meaningful edge cases; run them and report results.",
    planSkeleton: [
      { text: "Add tests for the described behavior", acceptance: "new tests run and pass (or reveal a real bug)" },
    ],
  },
  {
    id: "refactor",
    command: "/refactor",
    label: "Refactor",
    description: "Restructure code with behavior held constant, verified by tests.",
    classifyAs: "complex",
    roleBias: "implementer",
    argHint: "Describe the refactor…",
    guidance:
      "Preserve behavior exactly. Make the change across all affected files as one coherent step, and prove behavior is unchanged by keeping the existing tests green (add characterization tests first if coverage is thin).",
    planSkeleton: [],
  },
  {
    id: "review",
    command: "/review",
    label: "Review diff",
    description: "Run the Reviewer on the current change set.",
    classifyAs: "bounded",
    roleBias: "reviewer",
    argHint: "Anything specific to focus the review on?",
    guidance:
      "Critique the current uncommitted changes against their intent: correctness, misses, dead code, weakened tests. Do not modify anything.",
    planSkeleton: [
      { text: "Review the current diff", acceptance: "a written critique with a pass/concerns verdict" },
    ],
  },
  {
    id: "migrate",
    command: "/migrate",
    label: "Migrate library",
    description: "Migrate a dependency to a target version across the codebase.",
    classifyAs: "complex",
    roleBias: "implementer",
    argHint: "e.g. react-router@6 or zod@4",
    guidance:
      "Find every usage of the library, apply the migration guide's changes, update the version, and verify the build and tests pass end-to-end.",
    planSkeleton: [
      { text: "Locate all usages of the library", acceptance: "usages enumerated" },
      { text: "Apply the migration changes", acceptance: "code compiles against the new version" },
      { text: "Verify build and tests", acceptance: "typecheck, build, and tests pass" },
    ],
  },
  {
    id: "document",
    command: "/document",
    label: "Document",
    description: "Write or update documentation for the target code.",
    classifyAs: "bounded",
    roleBias: "implementer",
    argHint: "What should be documented?",
    guidance:
      "Produce accurate docs grounded in the actual code — read before writing. Update the README or add doc comments as appropriate; do not change behavior.",
    planSkeleton: [
      { text: "Document the target", acceptance: "docs are accurate and match the code" },
    ],
  },
];

export function templateByCommand(command: string): TaskTemplate | undefined {
  const c = command.trim().toLowerCase();
  return TASK_TEMPLATES.find((t) => t.command === c);
}

/**
 * Parse a composer input that starts with a slash command into a template +
 * the remaining argument text. Returns null when no template matches.
 */
export function matchTemplateInput(
  input: string,
): { template: TaskTemplate; arg: string } | null {
  const m = /^(\/[a-z-]+)\s*([\s\S]*)$/i.exec(input.trim());
  if (!m) return null;
  const template = templateByCommand(m[1]);
  return template ? { template, arg: m[2].trim() } : null;
}

/** Expand a template + user arg into the goal string handed to the Task Loop. */
export function expandTemplate(template: TaskTemplate, arg: string): string {
  const parts = [arg || template.description, "", `Approach: ${template.guidance}`];
  if (template.planSkeleton.length) {
    parts.push("", "Suggested plan (refine as needed):");
    for (const step of template.planSkeleton)
      parts.push(`- ${step.text} — done when: ${step.acceptance}`);
  }
  return parts.join("\n");
}
