import { describe, it, expect } from "vitest";
import { messageView, recoveryOutcome, recoveryNote } from "./message-state";

const assistant = (over: Partial<Parameters<typeof messageView>[0]> = {}) =>
  messageView({ role: "assistant", hasBody: false, ...over });

describe("messageView", () => {
  it("puts the user's own text in a bubble and claims no deliverables", () => {
    const v = messageView({ role: "user", hasBody: true });
    expect(v.presentation).toBe("user");
    expect(v.showsBody).toBe(true);
    expect(v.showsDeliverables).toBe(false);
    expect(v.showsCaret).toBe(false);
  });

  it("renders an answer with a caret only while it is still arriving", () => {
    expect(assistant({ hasBody: true, streaming: true }).showsCaret).toBe(true);
    expect(assistant({ hasBody: true, streaming: false }).showsCaret).toBe(false);
  });

  // The reported bug. The prose fallback streams an entire build into a message
  // that is still flagged `error: true`, so this is the case that decided the
  // shape of the module: presentation must follow the flag, and the flag must be
  // cleared the moment a recovery starts.
  it("treats a cleared flag as an answer even though the turn began as a failure", () => {
    const v = assistant({ hasBody: true, streaming: true, error: false });
    expect(v.presentation).toBe("answer");
    expect(v.showsDeliverables).toBe(true);
  });

  it("suppresses deliverables on a real failure, and nothing else", () => {
    const failed = assistant({ error: true, hasBody: true });
    expect(failed.presentation).toBe("failed");
    expect(failed.showsBody).toBe(true);
    expect(failed.showsDeliverables).toBe(false);
    expect(failed.showsCaret).toBe(false);
  });

  it("shows the live status line during a run and hides it once the run ends", () => {
    // The condition this replaces was inverted, so the line appeared only after
    // the turn it was describing had finished.
    expect(assistant({ streaming: true }).presentation).toBe("waiting");
    expect(assistant({ streaming: true }).showsBody).toBe(true);
    expect(assistant({ streaming: false }).showsBody).toBe(false);
  });

  it("still lets a waiting turn show what it has already produced", () => {
    expect(assistant({ streaming: true }).showsDeliverables).toBe(true);
  });
});

describe("recoveryOutcome", () => {
  it("is a success when files parsed out of the answer", () => {
    expect(recoveryOutcome({ text: "…", files: 2 })).toBe("files");
  });

  it("is an answer, not a failure, when text arrived without files", () => {
    expect(recoveryOutcome({ text: "a long page of prose", files: 0 })).toBe("text-only");
  });

  it("is a failure only when nothing came back at all", () => {
    expect(recoveryOutcome({ text: "", files: 0 })).toBe("nothing");
    expect(recoveryOutcome({ text: "   \n ", files: 0 })).toBe("nothing");
  });

  it("names the recovery in the activity row, and says so when files are missing", () => {
    expect(recoveryNote("files")).toBe("Retried without tools");
    expect(recoveryNote("text-only")).toContain("no files");
    expect(recoveryNote("nothing")).toBeNull();
  });
});
