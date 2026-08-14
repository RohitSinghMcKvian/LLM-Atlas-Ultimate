/**
 * The seam between the chat tool registry and whatever actually runs code.
 *
 * Chat has never been able to execute anything. The machinery existed — Atlas
 * Code has both a WebContainer and a Pyodide interpreter — but the two live in
 * different registries with different storage models, and merging them would
 * force one storage shape on both and break the page that works.
 *
 * So the chat side declares what it needs and nothing more. Today only Pyodide
 * implements it, because Pyodide needs no cross-origin isolation and therefore
 * works on `/chat` with no header change: setting COEP on the chat route would
 * be inherited by every artifact iframe, and every artifact that loads a CDN
 * script or a remote image would stop working. Trading the best-working part of
 * the app for a shell is not a trade worth making.
 */

import type { MountEntry } from "./mount";

/** A file handed to the interpreter, or produced by it. */
export interface ExecFile {
  /** Relative to the run's working directory. */
  path: string;
  /** Text content. Mutually exclusive with `bytes`. */
  text?: string;
  bytes?: Uint8Array;
}

export interface PythonRun {
  /** Captured stdout and stderr, in order, truncated to a readable length. */
  output: string;
  /** The traceback, when the script raised. */
  error?: string;
  /** Files the script created or changed, already filtered by the export caps. */
  files: ExecFile[];
  /** Files the caps excluded, phrased for the model. Empty when nothing was. */
  skippedNote: string;
  /** Packages installed on demand for this run. */
  installed: string[];
}

export interface ExecRuntime {
  /**
   * `"unavailable"` is a first-class state, not an error.
   *
   * Pyodide is a ~10MB download from a CDN that a network or a policy can block.
   * When it cannot start, `run_python` refuses with a sentence the model can
   * relay — never a fabricated result and never a silent no-op, which is the
   * pattern `MemoryWorkspace.exec` already sets in `lib/code/workspace.ts`.
   */
  readonly kind: "pyodide" | "unavailable";
  /**
   * Run a script with `mount` present in the working directory.
   *
   * `onChunk` receives output as it is produced, so the run panel shows a live
   * terminal rather than a block of text that appears when the run is already
   * over. Long analyses are exactly where that matters.
   */
  runPython(
    code: string,
    mount: ExecFile[],
    opts?: { install?: string[]; onChunk?: (text: string) => void; signal?: AbortSignal },
  ): Promise<PythonRun>;
  /** Release the interpreter. Safe to call when nothing was ever started. */
  dispose(): void;
}

/** The runtime a turn gets when execution is off, unsupported, or failed to load. */
export const UNAVAILABLE_RUNTIME: ExecRuntime = {
  kind: "unavailable",
  async runPython() {
    return {
      output: "",
      error:
        "The Python sandbox is not running. Ask the user to turn on Code execution in the composer menu, or answer without running code.",
      files: [],
      skippedNote: "",
      installed: [],
    };
  },
  dispose() {},
};

/** Shared with `mount.ts`; re-exported so callers need one import. */
export type { MountEntry };

/**
 * The runtime for this turn.
 *
 * Worker first, because it is the only one where Stop can actually stop a
 * running script and where a thirty-second analysis does not freeze the page.
 * Main thread second, unchanged, so a bundler or a CSP that refuses to construct
 * a worker leaves users with today's behaviour rather than none. `unavailable`
 * last, which `run_python` turns into an honest refusal.
 *
 * Behind `chatPyExecWorker` while it bakes — this changes where model-authored
 * code runs, which is not a change to make silently.
 */
export async function createExecRuntime(useWorker: boolean): Promise<ExecRuntime> {
  if (useWorker) {
    try {
      const { createWorkerRuntime } = await import("./worker-runtime");
      const runtime = createWorkerRuntime();
      if (runtime.kind !== "unavailable") return runtime;
    } catch {
      /* fall through to the main thread */
    }
  }
  const { createPyodideRuntime } = await import("./pyodide-runtime");
  return createPyodideRuntime();
}
