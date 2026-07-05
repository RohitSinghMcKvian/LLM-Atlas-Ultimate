// Debugging engine (Depth Spec v2 A.3): hypothesis-driven, not retry-spam.
// Pure helpers — stack-trace parsing, strategy-ladder selection, and the
// prompts that force the agent to (1) read the actual error, (2) state a
// hypothesis, (3) instrument when unsure, (4) fix minimally, (5) escalate
// strategy on repeat failure.

export interface StackFrame {
  file: string;
  line: number;
  column?: number;
  fn?: string;
}

/** Marker the agent must attach to temporary instrumentation lines. */
export const DEBUG_MARKER = "ATLAS-DEBUG";

// node/V8:      "at fn (path/file.js:12:5)" | "at path/file.js:12:5"
const V8_FRAME = /at\s+(?:(.+?)\s+\()?(?:file:\/\/)?([^()\s]+?):(\d+)(?::(\d+))?\)?/g;
// vitest/jest:  "❯ path/file.ts:12:5" | " > src/x.test.ts:3:1"
const ARROW_FRAME = /[❯>]\s+([^\s()]+?):(\d+)(?::(\d+))?/g;
// python:       'File "path/file.py", line 12, in fn'
const PY_FRAME = /File "([^"]+)", line (\d+)(?:, in (\S+))?/g;

const NOISE = /node_modules|node:internal|^internal\/|webcontainer|\.vite\//;

/**
 * Extract file:line frames from an error/stack blob, most-relevant first
 * (first-seen order, workspace files before dependency noise, deduped).
 */
export function parseStackTrace(text: string): StackFrame[] {
  const frames: StackFrame[] = [];
  const seen = new Set<string>();
  const push = (file: string, line: number, column?: number, fn?: string) => {
    const clean = file.trim().replace(/^\.?\//, "");
    const key = `${clean}:${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    frames.push({ file: clean, line, column, fn: fn?.trim() || undefined });
  };

  for (const m of text.matchAll(V8_FRAME))
    push(m[2], Number(m[3]), m[4] ? Number(m[4]) : undefined, m[1]);
  for (const m of text.matchAll(ARROW_FRAME)) push(m[1], Number(m[2]), m[3] ? Number(m[3]) : undefined);
  for (const m of text.matchAll(PY_FRAME)) push(m[1], Number(m[2]), undefined, m[3]);

  // Workspace frames first, dependency/internal noise last.
  return frames.sort((a, b) => Number(NOISE.test(a.file)) - Number(NOISE.test(b.file)));
}

export type DebugStrategy = "minimal_fix" | "instrument" | "broaden" | "bisect" | "ask_user";

/**
 * The escalation ladder (A.3 §5): minimal fix → instrument → broader change →
 * bisect against checkpoints → ask the user. Chosen by attempt number.
 */
export function nextStrategy(attempt: number, canBisect: boolean): DebugStrategy {
  switch (attempt) {
    case 0:
      return "minimal_fix";
    case 1:
      return "instrument";
    case 2:
      return "broaden";
    default:
      return canBisect ? "bisect" : "ask_user";
  }
}

const STRATEGY_GUIDANCE: Record<DebugStrategy, string> = {
  minimal_fix:
    "Apply the SMALLEST fix consistent with the evidence. Open the exact file:line from the stack trace before changing anything.",
  instrument: `You are unsure — instrument before fixing: insert temporary logging at the suspect points (every such line MUST contain the comment marker "${DEBUG_MARKER}"), re-run the failing command, read the output, THEN fix. Remove every ${DEBUG_MARKER} line before finishing.`,
  broaden:
    "The minimal fix did not hold. Reconsider the design of the failing unit: refactor the surrounding logic rather than patching symptoms. Re-read the involved files fully first.",
  bisect:
    "Roll back your recent edits mentally: compare the current file contents against what the checkpoints captured (the harness can restore them), identify which change introduced the failure, and re-apply only the good parts.",
  ask_user:
    "Stop guessing. Summarize the evidence and formulate ONE precise, evidence-backed question for the user.",
};

/** Frames rendered for the prompt, workspace-relevant first. */
export function describeFrames(frames: StackFrame[], max = 4): string {
  if (!frames.length) return "";
  return frames
    .slice(0, max)
    .map((f) => `- ${f.file}:${f.line}${f.fn ? ` (in ${f.fn})` : ""}`)
    .join("\n");
}

/** Debugging protocol block appended to self-correct prompts. */
export function debugProtocol(
  evidence: string,
  attempt: number,
  canBisect: boolean,
): { strategy: DebugStrategy; prompt: string } {
  const frames = parseStackTrace(evidence);
  const strategy = nextStrategy(attempt, canBisect);
  const lines = [
    frames.length
      ? `Stack frames to open FIRST (read these files at these lines):\n${describeFrames(frames)}`
      : "No stack frames detected — reproduce the failure with run_command first and read its output.",
    `Escalation level ${attempt + 1}: ${STRATEGY_GUIDANCE[strategy]}`,
    `Then: fix, re-run the failing command yourself, and check the NEIGHBORING tests too (run the full suite, not just the failing case).`,
  ];
  return { strategy, prompt: lines.join("\n\n") };
}

/** True when written content still contains instrumentation markers. */
export function hasDebugMarkers(content: string): boolean {
  return content.includes(DEBUG_MARKER);
}
