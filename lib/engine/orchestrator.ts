// Subagent orchestration (Depth Spec v2 A.5): parallelism with discipline.
// Built-in roles, user-definable agents from .atlas/agents/*.md, and a
// concurrency-capped fan-out. WebContainer has ONE filesystem and ONE shell —
// only read-only roles may run in parallel; anything that mutates stays
// serial. Results merge back as structured summaries, not transcripts.

export interface AgentRole {
  id: string;
  name: string;
  /** System prompt for the subagent run. */
  prompt: string;
  /** Read-only toolset? Mutating roles must never fan out in parallel. */
  readonly: boolean;
  maxIterations: number;
  /** Optional model override (user-defined agents). */
  modelId?: string;
  builtin?: boolean;
}

export const BUILTIN_ROLES: Record<string, AgentRole> = {
  explorer: {
    id: "explorer",
    name: "Explorer",
    readonly: true,
    maxIterations: 6,
    builtin: true,
    prompt:
      "You are an EXPLORER subagent: map the requested part of the codebase read-only (entry points, exports, conventions, coupling). Report facts with file paths — dense, no speculation.",
  },
  implementer: {
    id: "implementer",
    name: "Implementer",
    readonly: false,
    maxIterations: 10,
    builtin: true,
    prompt:
      "You are an IMPLEMENTER subagent: apply exactly the change described, smallest-diff-first, read before editing, verify with run_command where cheap. Report what changed and how it was verified.",
  },
  tester: {
    id: "tester",
    name: "Tester",
    readonly: false,
    maxIterations: 8,
    builtin: true,
    prompt:
      "You are a TESTER subagent: you write and run tests ONLY — never touch implementation files. Add focused tests (happy path + edge cases) for the described behavior, run them, and report results. If a test fails, report the failure — do not fix the implementation.",
  },
  reviewer: {
    id: "reviewer",
    name: "Reviewer",
    readonly: true,
    maxIterations: 6,
    builtin: true,
    prompt:
      "You are a fresh-context REVIEWER subagent: critique the described change against the original request, read-only. Flag misses, dead code, leftover debug logging, weakened tests. End with 'REVIEW: pass' or 'REVIEW: concerns'.",
  },
  researcher: {
    id: "researcher",
    name: "Researcher",
    readonly: true,
    maxIterations: 8,
    builtin: true,
    prompt:
      "You are a RESEARCHER subagent: answer the question using the tools you are given, citing sources (file paths or URLs). Dense facts, explicit uncertainty, no padding.",
  },
};

// ── User-definable agents (.atlas/agents/*.md) ──────────────────────────────
//
// ---
// name: My Migrator
// model: deepseek/deepseek-chat        (optional)
// tools: read-only | full              (optional, default read-only)
// max-iterations: 8                    (optional)
// ---
// System prompt body…

export function parseAgentMd(path: string, content: string): AgentRole | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content.trim());
  if (!m) return null;
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z-]+):\s*(.+)$/.exec(line.trim());
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim();
  }
  const prompt = m[2].trim();
  if (!prompt) return null;
  const fileId = path.split("/").pop()!.replace(/\.md$/i, "");
  const iters = Number(meta["max-iterations"]);
  return {
    id: fileId,
    name: meta.name || fileId,
    prompt,
    readonly: (meta.tools ?? "read-only").toLowerCase() !== "full",
    maxIterations: Number.isFinite(iters) && iters > 0 ? Math.min(iters, 12) : 6,
    modelId: meta.model || undefined,
  };
}

/** Merge built-ins with workspace-defined agents (user files win on id). */
export function mergeRoles(
  custom: { path: string; content: string }[],
): Record<string, AgentRole> {
  const roles = { ...BUILTIN_ROLES };
  for (const f of custom) {
    const role = parseAgentMd(f.path, f.content);
    if (role) roles[role.id] = role;
  }
  return roles;
}

// ── Fan-out ─────────────────────────────────────────────────────────────────

export interface FanOutJob<T> {
  id: string;
  run: () => Promise<T>;
}

export interface FanOutResult<T> {
  id: string;
  ok: boolean;
  value?: T;
  error?: string;
}

/**
 * Run jobs with a concurrency cap (default 3, the WebContainer-safe ceiling
 * for read-only work). Rejections are captured per-job, never thrown.
 */
export async function fanOut<T>(
  jobs: FanOutJob<T>[],
  concurrency = 3,
  signal?: AbortSignal,
): Promise<FanOutResult<T>[]> {
  const results: FanOutResult<T>[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      if (signal?.aborted) return;
      const i = next++;
      const job = jobs[i];
      try {
        results[i] = { id: job.id, ok: true, value: await job.run() };
      } catch (e) {
        results[i] = { id: job.id, ok: false, error: (e as Error).message };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, jobs.length)) }, worker),
  );
  return results.filter(Boolean);
}

/** Structured merge of subagent reports (context hygiene: summaries only). */
export function mergeSummaries(results: FanOutResult<string>[]): string {
  return results
    .map((r) =>
      r.ok
        ? `### ${r.id}\n${(r.value ?? "").trim() || "(empty report)"}`
        : `### ${r.id}\n(failed: ${r.error})`,
    )
    .join("\n\n");
}
