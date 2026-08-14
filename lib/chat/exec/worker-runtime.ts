"use client";

/**
 * `ExecRuntime` over the Python worker.
 *
 * The whole point is `terminate()`. Nothing else can stop synchronous WASM — see
 * the header of `worker/pyodide.worker.ts` — so Stop, which previously left a
 * `while True:` running while the UI claimed it had cancelled, is implemented by
 * killing the worker outright and booting a fresh one on the next call.
 *
 * That loses the interpreter's globals, which is a real cost and is therefore
 * *reported*: `RESTART_NOTE` goes into the tool result rather than being left
 * for the model to discover two rounds later when its dataframe is gone.
 */

import { UNAVAILABLE_RUNTIME, type ExecFile, type ExecRuntime, type PythonRun } from "./runtime";
import {
  acceptsResponse,
  isTerminal,
  isWorkerResponse,
  RESTART_NOTE,
  type WorkerFile,
  type WorkerResponse,
} from "./worker/protocol";

/** Chat's own directory. `/code` keeps `/home/pyodide`; the two never meet. */
const CWD = "/atlas-chat";

/** How long a worker may take to boot before we give up and fall back. */
const BOOT_TIMEOUT_MS = 60_000;

function newRunId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function toWorkerFiles(files: ExecFile[]): WorkerFile[] {
  return files.map((f) => ({ path: f.path, text: f.text, bytes: f.bytes }));
}

function fromWorkerFiles(files: WorkerFile[]): ExecFile[] {
  return files.map((f) => ({
    path: f.path,
    text: f.text,
    // Structured clone can hand back a plain ArrayBuffer view; normalise so the
    // caller always sees a Uint8Array.
    bytes: f.bytes ? new Uint8Array(f.bytes) : undefined,
  }));
}

export function createWorkerRuntime(): ExecRuntime {
  if (typeof Worker === "undefined") return UNAVAILABLE_RUNTIME;

  let worker: Worker | null = null;
  /** Set when the previous run was killed, so the next result says so. */
  let restarted = false;

  const spawn = (): Worker => {
    if (worker) return worker;
    worker = new Worker(new URL("./worker/pyodide.worker.ts", import.meta.url), {
      type: "module",
    });
    return worker;
  };

  const kill = () => {
    worker?.terminate();
    worker = null;
    restarted = true;
  };

  return {
    kind: "pyodide",

    async runPython(code, mount, opts) {
      let w: Worker;
      try {
        w = spawn();
      } catch {
        // Bundling or a CSP can stop a worker from being constructed at all.
        // The caller falls back to the main-thread runtime.
        return UNAVAILABLE_RUNTIME.runPython(code, mount, opts);
      }

      const runId = newRunId();
      const wasRestarted = restarted;
      restarted = false;

      return new Promise<PythonRun>((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          w.removeEventListener("message", onMessage);
          w.removeEventListener("error", onError);
          opts?.signal?.removeEventListener("abort", onAbort);
          clearTimeout(timer);
          fn();
        };

        const onMessage = (e: MessageEvent) => {
          if (!isWorkerResponse(e.data)) return;
          const msg = e.data as WorkerResponse;
          // A frame from a terminated run, or from a worker we have replaced.
          if (!acceptsResponse(runId, msg)) return;

          if (msg.type === "chunk") {
            opts?.onChunk?.(msg.text);
            return;
          }
          if (!isTerminal(msg)) return;

          if (msg.type === "failed") {
            finish(() =>
              resolve({
                output: "",
                error: `The Python sandbox could not run this: ${msg.message}`,
                files: [],
                skippedNote: "",
                installed: [],
              }),
            );
            return;
          }

          const notes = [msg.skippedNote, wasRestarted ? RESTART_NOTE : ""]
            .filter(Boolean)
            .join(" ");
          finish(() =>
            resolve({
              output: msg.output,
              error: msg.error,
              files: fromWorkerFiles(msg.files),
              skippedNote: notes,
              installed: msg.installed,
            }),
          );
        };

        const onError = () => {
          kill();
          finish(() =>
            resolve({
              output: "",
              error:
                "The Python sandbox crashed. It has been restarted; variables from earlier calls are gone.",
              files: [],
              skippedNote: "",
              installed: [],
            }),
          );
        };

        // Stop. The only mechanism that actually interrupts a running script.
        const onAbort = () => {
          kill();
          finish(() => reject(new DOMException("Aborted", "AbortError")));
        };

        // The boot download is ~10MB; a run cannot outlast it silently.
        const timer = setTimeout(() => {
          kill();
          finish(() =>
            resolve({
              output: "",
              error: "The Python sandbox did not start in time. It has been restarted.",
              files: [],
              skippedNote: "",
              installed: [],
            }),
          );
        }, BOOT_TIMEOUT_MS);

        w.addEventListener("message", onMessage);
        w.addEventListener("error", onError);
        opts?.signal?.addEventListener("abort", onAbort, { once: true });

        if (opts?.signal?.aborted) {
          onAbort();
          return;
        }

        w.postMessage({
          type: "run",
          runId,
          code,
          mount: toWorkerFiles(mount),
          install: opts?.install,
          cwd: CWD,
        });
      });
    },

    dispose() {
      // Unlike the main-thread runtime, this one owns its interpreter outright,
      // so disposing is both safe and correct.
      worker?.terminate();
      worker = null;
    },
  };
}
