import { describe, it, expect } from "vitest";
import {
  acceptsResponse,
  isTerminal,
  isWorkerResponse,
  RESTART_NOTE,
  type WorkerResponse,
} from "./protocol";

const done = (runId: string): WorkerResponse => ({
  type: "done",
  runId,
  output: "42\n",
  files: [],
  skippedNote: "",
  installed: [],
});

describe("isWorkerResponse", () => {
  it("accepts each well-formed frame", () => {
    expect(isWorkerResponse({ type: "ready", runId: "a" })).toBe(true);
    expect(isWorkerResponse({ type: "chunk", runId: "a", text: "hi" })).toBe(true);
    expect(isWorkerResponse({ type: "failed", runId: "a", message: "boom" })).toBe(true);
    expect(isWorkerResponse(done("a"))).toBe(true);
  });

  // A worker that crashed mid-write, or any other page's postMessage arriving on
  // the same channel, must not take down the client.
  it("rejects anything malformed", () => {
    for (const bad of [
      null,
      undefined,
      42,
      "done",
      {},
      { type: "done" },
      { type: "done", runId: "" },
      { type: "chunk", runId: "a" },
      { type: "failed", runId: "a" },
      { type: "done", runId: "a", output: "x", files: [], skippedNote: "" },
      { type: "unknown", runId: "a" },
    ]) {
      expect(isWorkerResponse(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

/**
 * The reason the run id exists. Terminating a `while True:` and immediately
 * starting a new script must not let the first one's late `done` frame resolve
 * the second.
 */
describe("acceptsResponse", () => {
  it("delivers only the run being awaited", () => {
    expect(acceptsResponse("r1", done("r1"))).toBe(true);
    expect(acceptsResponse("r1", done("r2"))).toBe(false);
  });

  it("drops everything when no run is in flight", () => {
    expect(acceptsResponse(null, done("r1"))).toBe(false);
  });
});

describe("isTerminal", () => {
  it("closes the run on done and failed only", () => {
    expect(isTerminal(done("a"))).toBe(true);
    expect(isTerminal({ type: "failed", runId: "a", message: "x" })).toBe(true);
    expect(isTerminal({ type: "chunk", runId: "a", text: "x" })).toBe(false);
    expect(isTerminal({ type: "ready", runId: "a" })).toBe(false);
  });
});

describe("RESTART_NOTE", () => {
  // A model that believes its dataframe is still loaded writes the next script
  // against state that no longer exists, and the failure surfaces two rounds
  // later as something inexplicable.
  it("says the interpreter restarted and that variables are gone", () => {
    expect(RESTART_NOTE).toMatch(/restart/i);
    expect(RESTART_NOTE).toMatch(/variables/i);
  });
});
