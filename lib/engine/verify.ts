// Verification harness (Depth Spec v2 A.2): detect the project's own truth
// from its package.json and run the cheapest sufficient checks, escalating
// typecheck → lint → unit → build. Every check yields a structured Verdict —
// "it should work" is banned output.
//
// detectChecks() is pure and unit-tested; runChecks() executes through an
// injected exec port (the workspace shell).

import type { CheckKind, Verdict } from "./types";

export interface CheckDef {
  check: CheckKind;
  command: string;
}

export interface ExecLike {
  (cmd: string, timeoutMs?: number): Promise<{ code: number; output: string; timedOut?: boolean }>;
}

const MAX_EVIDENCE = 2_000;

/** npm's placeholder test script — not a real check. */
const NPM_TEST_PLACEHOLDER = /echo .Error: no test specified/i;

/**
 * Detect the escalating check ladder from the project's own configuration.
 * Runs the project's commands, never invented ones — a script named in
 * package.json is trusted as the project's definition of that check.
 */
export function detectChecks(pkgJsonText: string | null, paths: string[]): CheckDef[] {
  const checks: CheckDef[] = [];
  let scripts: Record<string, string> = {};
  let devDeps: Record<string, string> = {};
  if (pkgJsonText) {
    try {
      const pkg = JSON.parse(pkgJsonText);
      scripts = pkg.scripts ?? {};
      devDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    } catch {
      /* malformed package.json — fall through to path heuristics */
    }
  }

  const has = (name: string) => typeof scripts[name] === "string" && scripts[name].trim() !== "";

  // typecheck — a dedicated script, else tsc when the project is TypeScript.
  if (has("typecheck")) checks.push({ check: "typecheck", command: "npm run typecheck" });
  else if (paths.includes("tsconfig.json") && devDeps.typescript)
    checks.push({ check: "typecheck", command: "npx tsc --noEmit" });

  // lint
  if (has("lint")) checks.push({ check: "lint", command: "npm run lint" });

  // unit tests — npm's default placeholder does not count.
  if (has("test") && !NPM_TEST_PLACEHOLDER.test(scripts.test))
    checks.push({ check: "unit", command: "npm test" });
  else if (!pkgJsonText && paths.includes("test.js"))
    checks.push({ check: "unit", command: "node test.js" });

  // build — the most expensive gate, last.
  if (has("build")) checks.push({ check: "build", command: "npm run build" });

  return checks;
}

export interface RunChecksOptions {
  /** Stop at the first failure (cheapest-first ladder). Default true. */
  stopOnFail?: boolean;
  /** Per-command timeout (ms). Default 120s — builds are slow in WebContainer. */
  timeoutMs?: number;
  onVerdict?: (v: Verdict) => void;
  now?: () => number;
}

/** Run the ladder, emitting a structured Verdict per check. */
export async function runChecks(
  checks: CheckDef[],
  exec: ExecLike,
  opts: RunChecksOptions = {},
): Promise<Verdict[]> {
  const { stopOnFail = true, timeoutMs = 120_000, now = Date.now } = opts;
  const verdicts: Verdict[] = [];
  for (const c of checks) {
    const started = now();
    let verdict: Verdict;
    try {
      const res = await exec(c.command, timeoutMs);
      verdict = {
        check: c.check,
        command: c.command,
        pass: !res.timedOut && res.code === 0,
        evidence: (res.timedOut ? "[timed out]\n" : "") + res.output.slice(-MAX_EVIDENCE).trim(),
        durationMs: now() - started,
        ts: started,
      };
    } catch (e) {
      verdict = {
        check: c.check,
        command: c.command,
        pass: false,
        evidence: `[exec failed] ${(e as Error).message}`.slice(0, MAX_EVIDENCE),
        durationMs: now() - started,
        ts: started,
      };
    }
    verdicts.push(verdict);
    opts.onVerdict?.(verdict);
    if (!verdict.pass && stopOnFail) break;
  }
  return verdicts;
}

/** Compact, model-readable rendering of failed verdicts for retry prompts. */
export function describeFailures(verdicts: Verdict[]): string {
  return verdicts
    .filter((v) => !v.pass)
    .map((v) => `Check "${v.check}" failed (${v.command}):\n${v.evidence}`)
    .join("\n\n");
}
