import { describe, it, expect } from "vitest";
import { nextTask, resumeInstruction, shouldAutoResume } from "./resume";
import type { WorkspaceSnapshot, WorkspaceTask } from "./workspace/types";

const task = (p: Partial<WorkspaceTask>): WorkspaceTask => ({
  id: p.id ?? "t",
  conversationId: "c",
  title: p.title ?? "step",
  status: p.status ?? "pending",
  order: p.order ?? 0,
  ...(p.note ? { note: p.note } : {}),
});

const snapshot = (p: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot => ({
  goal: "",
  files: [],
  tasks: [],
  ...p,
});

describe("shouldAutoResume", () => {
  it("resumes a round cap within the allowance", () => {
    expect(shouldAutoResume("rounds", 0, 1)).toBe(true);
    expect(shouldAutoResume("rounds", 1, 2)).toBe(true);
  });

  it("stops once the allowance is spent", () => {
    expect(shouldAutoResume("rounds", 1, 1)).toBe(false);
    expect(shouldAutoResume("rounds", 5, 2)).toBe(false);
  });

  // The default. An automatic continuation spends money the user did not ask
  // for a second time, so it is opted into.
  it("never resumes at the default allowance of zero", () => {
    expect(shouldAutoResume("rounds", 0, 0)).toBe(false);
  });

  // The distinction that matters: resuming past a ceiling the user set would be
  // spending money they explicitly capped, and another round of a model that was
  // going in circles is the definition of not helping.
  it("refuses every stop that is not a round cap, at any allowance", () => {
    for (const reason of ["cost", "time", "looping", "no-progress", "stalled", null] as const) {
      expect(shouldAutoResume(reason, 0, 2), String(reason)).toBe(false);
    }
  });
});

describe("nextTask", () => {
  it("prefers an active step over a pending one", () => {
    const t = nextTask([
      task({ id: "a", status: "pending", order: 0 }),
      task({ id: "b", status: "active", order: 1 }),
    ]);
    expect(t?.id).toBe("b");
  });

  it("falls back to the first pending step in ledger order", () => {
    const t = nextTask([
      task({ id: "c", status: "pending", order: 2 }),
      task({ id: "a", status: "done", order: 0 }),
      task({ id: "b", status: "pending", order: 1 }),
    ]);
    expect(t?.id).toBe("b");
  });

  it("returns nothing when every step is done or blocked", () => {
    expect(
      nextTask([task({ status: "done" }), task({ status: "blocked", order: 1 })]),
    ).toBeUndefined();
  });

  it("handles an empty ledger", () => {
    expect(nextTask([])).toBeUndefined();
  });
});

describe("resumeInstruction", () => {
  // The whole point. A model handed "continue" spends the first rounds of the
  // new budget re-reading its own files to work out where it was, and sometimes
  // rewrites a file it had already finished.
  it("names the next step and what is already done", () => {
    const text = resumeInstruction(
      snapshot({
        tasks: [
          task({ id: "1", title: "Scaffold the page", status: "done", order: 0 }),
          task({ id: "2", title: "Add the chart", status: "active", order: 1, note: "recharts" }),
          task({ id: "3", title: "Write the README", order: 2 }),
        ],
      }),
    );
    expect(text).toContain("Add the chart");
    expect(text).toContain("recharts");
    expect(text).toContain("1 of 3");
    expect(text).toContain("do not redo them");
  });

  it("warns about existing files so they are read before being rewritten", () => {
    const text = resumeInstruction(
      snapshot({
        files: [
          { conversationId: "c", path: "/workspace/a.html", content: "x", updatedAt: 0 },
          { conversationId: "c", path: "/workspace/b.css", content: "y", updatedAt: 0 },
        ],
      }),
    );
    expect(text).toContain("2 files");
    expect(text).toContain("read before rewriting");
  });

  it("uses the singular for one file", () => {
    const text = resumeInstruction(
      snapshot({
        files: [{ conversationId: "c", path: "/workspace/a.html", content: "x", updatedAt: 0 }],
      }),
    );
    expect(text).toContain("1 file already");
  });

  // Inventing a next step would be worse than saying there is none: the model
  // can close the build out or explain the block, and cannot do either if it is
  // told to keep going.
  it("says so when nothing is pending rather than inventing a step", () => {
    const text = resumeInstruction(
      snapshot({
        tasks: [task({ status: "done" }), task({ status: "blocked", order: 1 })],
      }),
    );
    expect(text).toContain("No step remains pending");
  });

  it("still produces a usable instruction with an empty workspace", () => {
    const text = resumeInstruction(snapshot());
    expect(text).toContain("Continue the build");
    expect(text).not.toContain("undefined");
  });
});
