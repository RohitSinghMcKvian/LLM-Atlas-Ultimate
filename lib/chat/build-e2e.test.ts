import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import * as Babel from "@babel/standalone";

import { runToolLoop, type LoopMessage, type WireEvent } from "./tool-loop";
import { executeTool, toolDefsFor, type ToolAvailability } from "./tools";
import { bindWorkspace } from "./workspace/fs";
import { resetWorkspaceRepo, workspaceSnapshot } from "./workspace/repo";
import { resetWorkspaceDb } from "./workspace/repo-idb";
import { buildWorkspaceContext } from "./workspace/context";
import { applyFold, planCompaction } from "./compact";
import { bundleModules, type Transform } from "./artifact-bundle";
import { BuildBudget, limitsFor } from "./build-budget";
import { callSignature, classifyRound } from "./progress";
import { extractArtifacts } from "./artifact-extract";
import { toWorkspacePath } from "./workspace/fs";
import { entryPathOf, mirrorInputs } from "./workspace/mirror";
import {
  getArtifactByPath,
  listArtifactsForConversation,
  listVersions,
  pathOf,
  recordVersion,
  resetArtifactDb,
} from "./artifact-repo";
import type { ChatMessage } from "./types";
import type { ToolDef } from "@/lib/router";

/**
 * A whole build, end to end, through the real modules.
 *
 * Every piece of this has unit tests. What none of them cover is the thing the
 * user actually asked for: can Atlas carry a multi-file build from "make me a
 * landing page" to a rendered artifact, survive compaction, and still know what
 * it is doing afterwards. That is a property of the *composition*, and it is
 * exactly the kind of thing that passes in pieces and fails assembled.
 *
 * GAP-REPORT records P10, P11 and P12 as shipped with "no real model has driven
 * it". No real model drives this either — but the seam stubbed here is the SSE
 * stream and nothing else. The tool registry, the filesystem, the ledger, the
 * budget, compaction and the bundler are all the real implementations, wired the
 * way `chat-client.tsx` wires them.
 */

const CONV = "conv-build-1";
const transform = Babel.transform as unknown as Transform;

function fakeLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  globalThis.localStorage = fakeLocalStorage();
  resetWorkspaceDb();
  resetWorkspaceRepo();
  resetArtifactDb();
});

const AVAILABILITY: ToolAvailability = {
  webSearch: false,
  hasProject: false,
  memory: false,
  hasSkills: false,
  github: false,
  codeExecution: false,
  hasArtifact: false,
  hasFoldedContext: false,
  subagents: false,
  buildMode: true,
};

/** A tool call as the wire delivers it. */
const call = (id: string, name: string, args: unknown): WireEvent => ({
  type: "tool_call",
  id,
  name,
  arguments: JSON.stringify(args),
});

/** Drive the loop with a scripted model. */
async function drive(rounds: WireEvent[][], deps: { toolDefs: ToolDef[]; run: (n: string, a: string) => Promise<{ content: string; isError?: boolean }> }) {
  let i = 0;
  const stream = () => {
    const events = rounds[Math.min(i, rounds.length - 1)] ?? [];
    i++;
    return (async function* () {
      for (const e of events) yield e;
    })();
  };
  const start: LoopMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "Build me a landing page" },
  ];
  return runToolLoop(start, { stream, runTool: deps.run, toolDefs: deps.toolDefs, maxRounds: 20 });
}

describe("a multi-file build, end to end", () => {
  it("plans, writes several files, and reports progress the model can read back", async () => {
    const stores = await bindWorkspace(CONV);
    const ctx = { workspace: stores.files, tasks: stores.ledger };
    const run = (name: string, args: string) => executeTool(name, args, ctx);

    const outcome = await drive(
      [
        [
          call("1", "tasks", {
            command: "plan",
            goal: "A landing page for a coffee subscription",
            steps: ["Write the page", "Write the styles", "Wire the signup form"],
          }),
        ],
        [
          call("2", "tasks", { command: "start", step: "1" }),
          call("3", "workspace", {
            command: "create",
            path: "/workspace/index.html",
            file_text: '<!DOCTYPE html><html><head><link rel="stylesheet" href="./styles.css"></head><body><h1>Coffee</h1></body></html>',
          }),
          call("4", "tasks", { command: "complete", step: "1", note: "hero + sections" }),
        ],
        [
          call("5", "workspace", {
            command: "create",
            path: "/workspace/styles.css",
            file_text: "body { margin: 0 }",
          }),
          call("6", "tasks", { command: "complete", step: "2" }),
        ],
        [{ type: "delta", text: "Built the page and its stylesheet." }],
      ],
      { toolDefs: toolDefsFor(AVAILABILITY), run },
    );

    expect(outcome.errored).toBe(false);
    expect(outcome.content).toContain("Built the page");

    const snap = await workspaceSnapshot(CONV);
    expect(snap.goal).toBe("A landing page for a coffee subscription");
    expect(snap.files.map((f) => f.path).sort()).toEqual([
      "/workspace/index.html",
      "/workspace/styles.css",
    ]);
    expect(snap.tasks.filter((t) => t.status === "done")).toHaveLength(2);

    // The block the model sees next turn: goal, ledger, inventory — no contents.
    const block = buildWorkspaceContext(snap);
    expect(block).toContain("coffee subscription");
    expect(block).toContain("2/3 done");
    expect(block).toContain("/workspace/index.html");
    expect(block).not.toContain("<h1>Coffee</h1>");
  });

  // The output-limit answer: a file longer than one reply, assembled in chunks.
  it("assembles a file across several appends", async () => {
    const stores = await bindWorkspace(CONV);
    const ctx = { workspace: stores.files, tasks: stores.ledger };
    const run = (name: string, args: string) => executeTool(name, args, ctx);

    await drive(
      [
        [
          call("1", "workspace", {
            command: "create",
            path: "/workspace/page.html",
            file_text: "<!DOCTYPE html>\n<html>\n<body>\n",
          }),
        ],
        [
          call("2", "workspace", {
            command: "append",
            path: "/workspace/page.html",
            append_text: "<section>one</section>\n",
          }),
        ],
        [
          call("3", "workspace", {
            command: "append",
            path: "/workspace/page.html",
            append_text: "</body>\n</html>",
          }),
        ],
        [{ type: "delta", text: "done" }],
      ],
      { toolDefs: toolDefsFor(AVAILABILITY), run },
    );

    const snap = await workspaceSnapshot(CONV);
    const page = snap.files.find((f) => f.path === "/workspace/page.html")!;
    expect(page.content).toBe(
      "<!DOCTYPE html>\n<html>\n<body>\n<section>one</section>\n</body>\n</html>",
    );
  });

  it("patches an existing file without re-sending it", async () => {
    const stores = await bindWorkspace(CONV);
    const ctx = { workspace: stores.files, tasks: stores.ledger };
    const run = (name: string, args: string) => executeTool(name, args, ctx);

    await drive(
      [
        [
          call("1", "workspace", {
            command: "create",
            path: "/workspace/index.html",
            file_text: "<h1>Old headline</h1>",
          }),
        ],
        [
          call("2", "workspace", {
            command: "str_replace",
            path: "/workspace/index.html",
            old_str: "Old headline",
            new_str: "New headline",
          }),
        ],
        [{ type: "delta", text: "changed the headline" }],
      ],
      { toolDefs: toolDefsFor(AVAILABILITY), run },
    );

    const snap = await workspaceSnapshot(CONV);
    expect(snap.files[0].content).toBe("<h1>New headline</h1>");
  });
});

/**
 * The acceptance test named in the plan: force compaction, then confirm the
 * model can still continue the build.
 */
describe("the build survives compaction", () => {
  it("keeps the goal, the ledger and the inventory after every message is folded", async () => {
    const stores = await bindWorkspace(CONV);
    const ctx = { workspace: stores.files, tasks: stores.ledger };
    const run = (name: string, args: string) => executeTool(name, args, ctx);

    await drive(
      [
        [
          call("1", "tasks", {
            command: "plan",
            goal: "A four-screen habit tracker",
            steps: ["Shell", "Home", "Stats", "Settings"],
          }),
          call("2", "workspace", {
            command: "create",
            path: "/workspace/App.jsx",
            file_text: "export default function App(){ return null; }",
          }),
          call("3", "tasks", { command: "complete", step: "Shell" }),
        ],
        [{ type: "delta", text: "shell done" }],
      ],
      { toolDefs: toolDefsFor(AVAILABILITY), run },
    );

    // A long thread, then compaction folds all of it away.
    const messages: ChatMessage[] = Array.from({ length: 30 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `turn ${i} discussing the tracker`,
      parentId: i === 0 ? null : `m${i - 1}`,
      createdAt: 1000 + i,
    }));
    const plan = planCompaction(messages)!;
    const folded = messages.map((m) =>
      plan.foldIds.includes(m.id) ? { ...m, folded: true } : m,
    );
    const sent = applyFold(folded);

    // The transcript shrank...
    expect(sent.length).toBeLessThan(messages.length);
    // ...but the build did not. This is the whole point: workspace state is
    // keyed by conversation, and compaction no longer changes the conversation.
    const snap = await workspaceSnapshot(CONV);
    expect(snap.goal).toBe("A four-screen habit tracker");
    expect(snap.files).toHaveLength(1);
    expect(snap.tasks.filter((t) => t.status === "done")).toHaveLength(1);

    const block = buildWorkspaceContext(snap);
    expect(block).toContain("habit tracker");
    expect(block).toContain("1/4 done");
    expect(block).toContain("/workspace/App.jsx");
  });

  it("lets the build continue after the fold, with the ledger still advancing", async () => {
    const stores = await bindWorkspace(CONV);
    const ctx = { workspace: stores.files, tasks: stores.ledger };
    const run = (name: string, args: string) => executeTool(name, args, ctx);

    await drive(
      [[call("1", "tasks", { command: "plan", goal: "g", steps: ["A", "B"] })], [{ type: "delta", text: "ok" }]],
      { toolDefs: toolDefsFor(AVAILABILITY), run },
    );

    // A later turn, as if every earlier message had been folded away.
    await drive(
      [
        [call("2", "tasks", { command: "complete", step: "B", note: "after fold" })],
        [{ type: "delta", text: "finished B" }],
      ],
      { toolDefs: toolDefsFor(AVAILABILITY), run },
    );

    const snap = await workspaceSnapshot(CONV);
    const b = snap.tasks.find((t) => t.title === "B")!;
    expect(b.status).toBe("done");
    expect(b.note).toBe("after fold");
  });
});

/** What the workspace produced has to actually render. */
describe("the workspace feeds the bundler", () => {
  it("bundles a multi-file React app written through the tools", async () => {
    const stores = await bindWorkspace(CONV);
    const ctx = { workspace: stores.files, tasks: stores.ledger };
    const run = (name: string, args: string) => executeTool(name, args, ctx);

    await drive(
      [
        [
          call("1", "workspace", {
            command: "create",
            path: "/workspace/App.jsx",
            file_text: `import Nav from "./Nav";\nimport "./app.css";\nexport default function App(){ return Nav; }`,
          }),
          call("2", "workspace", {
            command: "create",
            path: "/workspace/Nav.jsx",
            file_text: `export default function Nav(){ return "nav"; }`,
          }),
          call("3", "workspace", {
            command: "create",
            path: "/workspace/app.css",
            file_text: `body { background: #000 }`,
          }),
        ],
        [{ type: "delta", text: "app ready" }],
      ],
      { toolDefs: toolDefsFor(AVAILABILITY), run },
    );

    const snap = await workspaceSnapshot(CONV);
    // The bundler is addressed by workspace-relative path, the way the panel
    // addresses it.
    const files = new Map(
      snap.files.map((f) => [f.path.replace("/workspace/", ""), f.content]),
    );
    const bundle = bundleModules("App.jsx", files, transform);

    expect(bundle.errors).toEqual([]);
    expect(bundle.order).toEqual(expect.arrayContaining(["Nav.jsx", "App.jsx", "app.css"]));
    expect(bundle.css).toContain("background: #000");
    expect(bundle.code).toContain('"Nav.jsx"');
  });
});

/**
 * The fence fallback (R12).
 *
 * The prompt asks the model to call `workspace`. Models frequently write the
 * fence instead, and a build that only persists when the model remembers a tool
 * is a build that intermittently loses itself.
 */
describe("named fences reach the workspace without the tool", () => {
  it("mirrors every path-tagged block a reply contains", async () => {
    const stores = await bindWorkspace(CONV);
    const reply = [
      "Here it is.",
      '```html path="index.html"',
      "<h1>Hi</h1>",
      "```",
      '```css path="styles.css"',
      "body { margin: 0 }",
      "```",
      "```bash",
      "npm run dev",
      "```",
    ].join("\n");

    // Exactly what chat-client does after a turn.
    const named = extractArtifacts(reply).filter(
      (a) => a.path && a.complete !== false && a.code.trim(),
    );
    for (const a of named) {
      const abs = toWorkspacePath(a.path!);
      if (abs) await stores.files.write(abs, a.code);
    }

    const snap = await workspaceSnapshot(CONV);
    expect(snap.files.map((f) => f.path).sort()).toEqual([
      "/workspace/index.html",
      "/workspace/styles.css",
    ]);
    // The untagged snippet is not a deliverable and must not become a file.
    expect(snap.files.some((f) => f.content.includes("npm run dev"))).toBe(false);
  });
});

/**
 * The regression that made build mode useless on its own.
 *
 * `recordVersion` was reachable from three places — the fence backfill, the
 * `artifact` tool's patch, and the post-turn scan of the reply text — and none
 * of them knew the filesystem existed. A model that did exactly what the BUILD
 * prompt asks, writing every deliverable through `workspace.create`, filled the
 * workspace and rendered nothing, because the panel is fed by artifacts.
 */
describe("workspace files become renderable artifacts", () => {
  it("mirrors every file written through the tools", async () => {
    const stores = await bindWorkspace(CONV);
    const ctx = { workspace: stores.files, tasks: stores.ledger };
    const run = (name: string, args: string) => executeTool(name, args, ctx);

    await drive(
      [
        [
          call("1", "workspace", {
            command: "create",
            path: "/workspace/index.html",
            file_text: "<h1>Coffee</h1>",
          }),
          call("2", "workspace", {
            command: "create",
            path: "/workspace/styles.css",
            file_text: "body{margin:0}",
          }),
        ],
        [{ type: "delta", text: "built it" }],
      ],
      { toolDefs: toolDefsFor(AVAILABILITY), run },
    );

    // Exactly what chat-client does after a build turn.
    const snap = await workspaceSnapshot(CONV);
    for (const m of mirrorInputs(snap.files)) {
      await recordVersion({ conversationId: CONV, ...m });
    }

    const recs = await listArtifactsForConversation(CONV);
    expect(recs.map(pathOf).sort()).toEqual(["index.html", "styles.css"]);
    // The HTML is renderable; the CSS is a file of the build, not a document.
    expect(recs.find((r) => pathOf(r) === "index.html")!.kind).toBe("html");
    expect(recs.find((r) => pathOf(r) === "styles.css")!.kind).toBe("code");

    const page = await getArtifactByPath(CONV, "index.html");
    expect((await listVersions(page!.id))[0].code).toBe("<h1>Coffee</h1>");
  });

  it("adds a version rather than a duplicate when a file is edited", async () => {
    const stores = await bindWorkspace(CONV);
    const ctx = { workspace: stores.files, tasks: stores.ledger };
    const run = (name: string, args: string) => executeTool(name, args, ctx);

    await drive(
      [
        [call("1", "workspace", { command: "create", path: "/workspace/a.html", file_text: "<p>v1</p>" })],
        [{ type: "delta", text: "one" }],
      ],
      { toolDefs: toolDefsFor(AVAILABILITY), run },
    );
    for (const m of mirrorInputs((await workspaceSnapshot(CONV)).files)) {
      await recordVersion({ conversationId: CONV, ...m });
    }

    await drive(
      [
        [
          call("2", "workspace", {
            command: "str_replace",
            path: "/workspace/a.html",
            old_str: "v1",
            new_str: "v2",
          }),
        ],
        [{ type: "delta", text: "two" }],
      ],
      { toolDefs: toolDefsFor(AVAILABILITY), run },
    );
    for (const m of mirrorInputs((await workspaceSnapshot(CONV)).files)) {
      await recordVersion({ conversationId: CONV, ...m });
    }

    expect(await listArtifactsForConversation(CONV)).toHaveLength(1);
    const rec = await getArtifactByPath(CONV, "a.html");
    const versions = await listVersions(rec!.id);
    expect(versions.map((v) => v.code)).toEqual(["<p>v1</p>", "<p>v2</p>"]);
  });

  it("skips a placeholder file so a blank version is never revertable-to", async () => {
    const stores = await bindWorkspace(CONV);
    await stores.files.write("/workspace/todo.html", "   ");
    for (const m of mirrorInputs((await workspaceSnapshot(CONV)).files)) {
      await recordVersion({ conversationId: CONV, ...m });
    }
    expect(await listArtifactsForConversation(CONV)).toHaveLength(0);
  });

  // Two of the four target deliverables are prose. They have to become the
  // paginated, printable kinds, not ordinary markdown blocks.
  it("mirrors a report as a document and a deck as slides", async () => {
    const stores = await bindWorkspace(CONV);
    const ctx = { workspace: stores.files, tasks: stores.ledger };
    const run = (name: string, args: string) => executeTool(name, args, ctx);

    await drive(
      [
        [
          call("1", "workspace", {
            command: "create",
            path: "/workspace/research.md",
            file_text: "# Findings\n\nBody.",
          }),
          call("2", "workspace", {
            command: "create",
            path: "/workspace/pitch.slides.md",
            file_text: "# Slide one\n\n---\n\n# Slide two",
          }),
        ],
        [{ type: "delta", text: "written" }],
      ],
      { toolDefs: toolDefsFor(AVAILABILITY), run },
    );

    for (const m of mirrorInputs((await workspaceSnapshot(CONV)).files)) {
      await recordVersion({ conversationId: CONV, ...m });
    }

    const recs = await listArtifactsForConversation(CONV);
    expect(recs.find((r) => pathOf(r) === "research.md")!.kind).toBe("document");
    expect(recs.find((r) => pathOf(r) === "pitch.slides.md")!.kind).toBe("slides");
  });

  it("opens a build on its entry point, not on whatever sorts last", () => {
    expect(entryPathOf(["app.css", "index.html", "util.js"])).toBe("index.html");
    expect(entryPathOf(["styles.css", "App.jsx", "Nav.jsx"])).toBe("App.jsx");
    expect(entryPathOf(["a.css", "b.js"])).toBe("a.css");
    expect(entryPathOf([])).toBeNull();
  });
});

/** Budget behaviour over a realistic run. */
describe("budget over a build", () => {
  it("halts a model that stops making progress, before the round cap", async () => {
    const budget = new BuildBudget(limitsFor(true));
    const stores = await bindWorkspace(CONV);
    const ctx = { workspace: stores.files, tasks: stores.ledger };

    let i = 0;
    const rounds: WireEvent[][] = [
      [call("1", "workspace", { command: "create", path: "/workspace/a.html", file_text: "<p>a</p>" })],
      // The same read, over and over — the shape of a model that has lost the
      // thread. Repetition, not absence of writes, is what identifies it.
      [call("2", "workspace", { command: "view", path: "/workspace/a.html" })],
      [call("3", "workspace", { command: "view", path: "/workspace/a.html" })],
      [call("4", "workspace", { command: "view", path: "/workspace/a.html" })],
      [{ type: "delta", text: "I am going in circles" }],
    ];
    const stream = () => {
      const events = rounds[Math.min(i, rounds.length - 1)] ?? [];
      i++;
      return (async function* () {
        for (const e of events) yield e;
      })();
    };

    const outcome = await runToolLoop(
      [{ role: "user", content: "build" }],
      {
        stream,
        runTool: (n, a) => executeTool(n, a, ctx),
        toolDefs: toolDefsFor(AVAILABILITY),
        maxRounds: budget.limits.maxRounds,
        shouldStop: () => budget.stop(),
      },
      {
        onRoundComplete: (calls) => {
          budget.completeRound(classifyRound(calls));
          budget.noteCalls(calls.map(callSignature));
        },
      },
    );

    expect(outcome.stopReason).toBe("looping");
    expect(outcome.stoppedBy).toContain("repeated three times");
    // Stopped well short of the 20-round cap.
    expect(outcome.rounds).toBeLessThan(6);
  });

  /**
   * The regression that motivated the rewrite of round accounting.
   *
   * The old classifier counted only writes as progress, so `web_search`,
   * `read_project_file`, `github`, `memory` and every connector call were
   * "barren" — and two research rounds halted the build with "no file written".
   * Research, then build, is the normal shape of an end-to-end task, so the
   * guard fired on exactly the runs it existed to protect.
   */
  it("lets a build research for several rounds before it writes anything", async () => {
    const budget = new BuildBudget(limitsFor(true));
    const stores = await bindWorkspace(CONV);
    const ctx = {
      workspace: stores.files,
      tasks: stores.ledger,
      search: async (q: string) => ({
        sources: [{ title: q, url: `https://x.test/${q}`, snippet: "s" }],
      }),
    };

    let i = 0;
    const rounds: WireEvent[][] = [
      [call("1", "web_search", { search_query: "css grid layout" })],
      [call("2", "web_search", { search_query: "accessible colour contrast" })],
      [call("3", "web_search", { search_query: "print stylesheet basics" })],
      [call("4", "workspace", { command: "create", path: "/workspace/i.html", file_text: "<p>x</p>" })],
      [{ type: "delta", text: "Done." }],
    ];
    const stream = () => {
      const events = rounds[Math.min(i, rounds.length - 1)] ?? [];
      i++;
      return (async function* () {
        for (const e of events) yield e;
      })();
    };

    const outcome = await runToolLoop(
      [{ role: "user", content: "research then build" }],
      {
        stream,
        runTool: (n, a) => executeTool(n, a, ctx),
        toolDefs: toolDefsFor(AVAILABILITY),
        maxRounds: budget.limits.maxRounds,
        shouldStop: () => budget.stop(),
      },
      {
        onRoundComplete: (calls) => {
          budget.completeRound(classifyRound(calls));
          budget.noteCalls(calls.map(callSignature));
        },
      },
    );

    expect(outcome.stoppedBy).toBeUndefined();
    expect(outcome.content).toContain("Done.");
    expect((await workspaceSnapshot(CONV)).files.some((f) => f.path === "/workspace/i.html")).toBe(
      true,
    );
  });
});
