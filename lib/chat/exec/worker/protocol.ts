/**
 * The wire between the chat tool loop and the Python worker.
 *
 * Pure, and separate from both ends, for the reason `lib/mcp/protocol.ts` is:
 * the worker itself cannot be tested in a node environment, but every bug worth
 * catching lives in the framing — a response arriving after its run was
 * terminated, a message from a worker that has been replaced, a malformed
 * payload from a script that crashed the runtime. Those are all decidable here.
 *
 * Correlation is by `runId`, not by ordering. A terminated worker can still have
 * a message in flight when its replacement boots, and delivering that to the new
 * run would attribute one script's output to another.
 */

export interface WorkerFile {
  path: string;
  text?: string;
  /** Transferred as a plain array; structured clone handles it either way. */
  bytes?: Uint8Array;
}

/** Client → worker. */
export type WorkerRequest =
  | { type: "boot"; runId: string }
  | {
      type: "run";
      runId: string;
      code: string;
      mount: WorkerFile[];
      install?: string[];
      cwd: string;
    };

/** Worker → client. */
export type WorkerResponse =
  | { type: "ready"; runId: string }
  | { type: "chunk"; runId: string; text: string }
  | {
      type: "done";
      runId: string;
      output: string;
      error?: string;
      files: WorkerFile[];
      skippedNote: string;
      installed: string[];
    }
  | { type: "failed"; runId: string; message: string };

/** Every response carries the run it belongs to. */
export function isWorkerResponse(v: unknown): v is WorkerResponse {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  if (typeof m.runId !== "string" || !m.runId) return false;
  switch (m.type) {
    case "ready":
    case "chunk":
      return m.type === "ready" || typeof m.text === "string";
    case "failed":
      return typeof m.message === "string";
    case "done":
      return (
        typeof m.output === "string" &&
        Array.isArray(m.files) &&
        typeof m.skippedNote === "string" &&
        Array.isArray(m.installed)
      );
    default:
      return false;
  }
}

/**
 * Should this response be delivered?
 *
 * A message whose `runId` is not the one being awaited is from a run that was
 * terminated, or from a worker that has already been replaced. Dropping it is
 * the whole reason the id exists: without this, aborting a `while True:` and
 * immediately starting a new script would let the first one's late `done` frame
 * resolve the second.
 */
export function acceptsResponse(expected: string | null, msg: WorkerResponse): boolean {
  return expected !== null && msg.runId === expected;
}

/** Terminal frames. Anything else leaves the run open. */
export function isTerminal(msg: WorkerResponse): msg is Extract<
  WorkerResponse,
  { type: "done" | "failed" }
> {
  return msg.type === "done" || msg.type === "failed";
}

/**
 * What the model is told when a run was killed mid-flight.
 *
 * Terminating the worker is the only way to stop synchronous WASM, and it takes
 * the interpreter's globals with it. Saying so is not optional: a model that
 * believes its dataframe is still loaded will write the next script against
 * state that no longer exists, and the failure surfaces two rounds later as
 * something inexplicable.
 */
export const RESTART_NOTE =
  "The run was stopped and the Python interpreter was restarted, so variables from earlier calls are gone. Re-run any setup before continuing.";
