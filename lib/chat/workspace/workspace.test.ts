import { describe, it, expect } from "vitest";
import { formatLedger, ledgerProgress, planTasks, setTaskStatus } from "./tasks";
import { buildWorkspaceContext, WORKSPACE_CONTEXT_MAX_CHARS } from "./context";
import { toRelativePath, toWorkspacePath } from "./fs";
import { MAX_TASKS, type WorkspaceFile, type WorkspaceTask } from "./types";

const CONV = "c1";

function file(path: string, lines: number): WorkspaceFile {
  return {
    conversationId: CONV,
    path,
    content: Array.from({ length: lines }, (_, i) => `line ${i}`).join("\n"),
    updatedAt: 1,
  };
}

describe("planTasks", () => {
  it("numbers steps in order", () => {
    const { tasks } = planTasks(CONV, ["Design", "Build", "Ship"]);
    expect(tasks.map((t) => t.title)).toEqual(["Design", "Build", "Ship"]);
    expect(tasks.map((t) => t.order)).toEqual([0, 1, 2]);
    expect(tasks.every((t) => t.status === "pending")).toBe(true);
  });

  it("rejects an empty plan rather than recording nothing", () => {
    const r = planTasks(CONV, ["", "   "]);
    expect(r.isError).toBe(true);
    expect(r.tasks).toEqual([]);
  });

  it("caps the ledger and says how many were dropped", () => {
    const titles = Array.from({ length: MAX_TASKS + 5 }, (_, i) => `Step ${i}`);
    const r = planTasks(CONV, titles);
    expect(r.tasks).toHaveLength(MAX_TASKS);
    expect(r.message).toContain("5 step(s) past");
  });

  // A model that adds a step mid-build must not reset the work already done.
  it("carries completed steps across a re-plan, matched by title", () => {
    const first = planTasks(CONV, ["Design", "Build"]);
    const done = setTaskStatus(first.tasks, "1", "done", "wireframes agreed").tasks;
    const second = planTasks(CONV, ["Design", "Build", "Ship"], done);
    expect(second.tasks[0].status).toBe("done");
    expect(second.tasks[0].note).toBe("wireframes agreed");
    expect(second.tasks[0].id).toBe(done[0].id);
    expect(second.tasks[1].status).toBe("pending");
    expect(second.message).toContain("1 already complete");
  });

  it("normalises whitespace and drops overlong titles", () => {
    const { tasks } = planTasks(CONV, ["  spaced    out  ", "x".repeat(400)]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("spaced out");
  });
});

describe("setTaskStatus", () => {
  const base = () => planTasks(CONV, ["Design", "Build", "Ship"]).tasks;

  it("locates a step by 1-based number", () => {
    const r = setTaskStatus(base(), "2", "done");
    expect(r.tasks[1].status).toBe("done");
    expect(r.message).toContain("2 remaining");
  });

  it("locates a step by a unique title substring", () => {
    const r = setTaskStatus(base(), "shi", "active");
    expect(r.tasks[2].status).toBe("active");
  });

  it("refuses an ambiguous title rather than guessing", () => {
    const tasks = planTasks(CONV, ["Build header", "Build footer"]).tasks;
    const r = setTaskStatus(tasks, "build", "done");
    expect(r.isError).toBe(true);
    expect(tasks.every((t) => t.status === "pending")).toBe(true);
  });

  it("errors when there is no plan at all", () => {
    const r = setTaskStatus([], "1", "done");
    expect(r.isError).toBe(true);
    expect(r.message).toContain("no plan");
  });

  // A ledger claiming three things are in flight has stopped describing reality.
  it("keeps at most one step active", () => {
    let tasks = setTaskStatus(base(), "1", "active").tasks;
    tasks = setTaskStatus(tasks, "2", "active").tasks;
    expect(tasks.filter((t) => t.status === "active")).toHaveLength(1);
    expect(tasks[1].status).toBe("active");
    expect(tasks[0].status).toBe("pending");
  });

  it("announces completion when nothing is left", () => {
    let tasks = base();
    for (const n of ["1", "2", "3"]) tasks = setTaskStatus(tasks, n, "done").tasks;
    expect(setTaskStatus(tasks, "3", "done").message).toContain("All steps complete");
    expect(ledgerProgress(tasks)).toEqual({ done: 3, total: 3 });
  });

  it("keeps an existing note when a later transition omits one", () => {
    const tasks = setTaskStatus(base(), "1", "active", "started").tasks;
    const after = setTaskStatus(tasks, "1", "done").tasks;
    expect(after[0].note).toBe("started");
  });
});

describe("formatLedger", () => {
  it("marks each status distinctly", () => {
    let tasks = planTasks(CONV, ["A", "B", "C", "D"]).tasks;
    tasks = setTaskStatus(tasks, "1", "done").tasks;
    tasks = setTaskStatus(tasks, "2", "active").tasks;
    tasks = setTaskStatus(tasks, "3", "blocked", "waiting on copy").tasks;
    const out = formatLedger(tasks);
    expect(out).toContain("1. [x] A");
    expect(out).toContain("2. [>] B");
    expect(out).toContain("3. [!] C — waiting on copy");
    expect(out).toContain("4. [ ] D");
  });

  it("is empty for an empty ledger", () => {
    expect(formatLedger([])).toBe("");
  });
});

describe("buildWorkspaceContext", () => {
  it("returns nothing for a conversation that is not a build", () => {
    expect(buildWorkspaceContext({ goal: "", files: [], tasks: [] })).toBe("");
  });

  it("carries the goal, the ledger and the file inventory", () => {
    const tasks = setTaskStatus(planTasks(CONV, ["Design", "Build"]).tasks, "1", "done").tasks;
    const out = buildWorkspaceContext({
      goal: "A landing page for a coffee subscription",
      files: [file("/workspace/index.html", 412)],
      tasks,
    });
    expect(out).toContain("coffee subscription");
    expect(out).toContain("1/2 done");
    expect(out).toContain("1. [x] Design");
    expect(out).toContain("/workspace/index.html (412 lines)");
  });

  // Progressive disclosure: the inventory is an index, not the build itself.
  it("never includes file contents", () => {
    const out = buildWorkspaceContext({
      goal: "g",
      files: [
        { conversationId: CONV, path: "/workspace/a.js", content: "SECRET_TOKEN", updatedAt: 1 },
      ],
      tasks: [],
    });
    expect(out).toContain("/workspace/a.js");
    expect(out).not.toContain("SECRET_TOKEN");
  });

  // R5: this block is sent on every request, so it must not grow with the build.
  it("stays inside its ceiling at 500 files and 200 tasks", () => {
    const files = Array.from({ length: 500 }, (_, i) =>
      file(`/workspace/some/deeply/nested/path/file-${String(i).padStart(4, "0")}.tsx`, 300),
    );
    const tasks: WorkspaceTask[] = Array.from({ length: 200 }, (_, i) => ({
      id: `t${i}`,
      conversationId: CONV,
      title: `Step number ${i} with a fairly long description of what it does`,
      status: "pending",
      order: i,
    }));
    const out = buildWorkspaceContext({ goal: "x".repeat(5000), files, tasks });
    expect(out.length).toBeLessThanOrEqual(WORKSPACE_CONTEXT_MAX_CHARS);
    expect(out).toContain("more");
  });

  it("tells the model where to put things when the workspace is empty but planned", () => {
    const out = buildWorkspaceContext({
      goal: "",
      files: [],
      tasks: planTasks(CONV, ["Design"]).tasks,
    });
    expect(out).toContain("/workspace is empty");
  });
});

describe("toWorkspacePath", () => {
  it("makes a relative path absolute", () => {
    expect(toWorkspacePath("index.html")).toBe("/workspace/index.html");
    expect(toWorkspacePath("src/App.jsx")).toBe("/workspace/src/App.jsx");
  });

  it("passes an already-absolute workspace path through", () => {
    expect(toWorkspacePath("/workspace/a.css")).toBe("/workspace/a.css");
  });

  // A stray info-string token must not become a file.
  it.each(["", "   ", "/etc/passwd", "../escape", "a/../b", "has space.html", "http://x/y", "a//b"])(
    "rejects %j",
    (bad) => {
      expect(toWorkspacePath(bad)).toBeNull();
    },
  );

  it("rejects an absurdly long path", () => {
    expect(toWorkspacePath(`${"a".repeat(250)}.html`)).toBeNull();
  });

  it("round-trips with toRelativePath", () => {
    const abs = toWorkspacePath("src/App.jsx")!;
    expect(toRelativePath(abs)).toBe("src/App.jsx");
  });
});
