import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { executeTool, toolDefsFor, TOOL_NAMES, type ToolAvailability } from "./tools";
import type { Skill } from "@/lib/skills/parse";
import type { WebSource } from "./types";
import type { ExecRuntime, PythonRun } from "./exec/runtime";
import { lexicalEmbedder } from "./embed";

const PROJECT = [
  { name: "spec.md", text: "the specification body" },
  { name: "Notes.TXT", text: "some notes" },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

const ALL: ToolAvailability = {
  webSearch: true,
  hasProject: true,
  memory: true,
  hasSkills: true,
  github: true,
  hasArtifact: true,
  buildMode: true,
  codeExecution: true,
  hasFoldedContext: true,
  subagents: true,
};
/** Every flag off. Written out rather than derived, so adding one fails here. */
const NONE: ToolAvailability = {
  webSearch: false,
  hasProject: false,
  memory: false,
  hasSkills: false,
  github: false,
  hasArtifact: false,
  buildMode: false,
  codeExecution: false,
  hasFoldedContext: false,
  subagents: false,
};
const names = (o: Partial<ToolAvailability>) =>
  toolDefsFor({ ...ALL, ...o }).map((d) => d.function.name);

describe("toolDefsFor", () => {
  it("emits OpenAI-shaped function defs", () => {
    const defs = toolDefsFor(ALL);
    expect(defs.length).toBeGreaterThan(0);
    for (const d of defs) {
      expect(d.type).toBe("function");
      expect(typeof d.function.name).toBe("string");
      expect(typeof d.function.description).toBe("string");
      expect(d.function.parameters).toMatchObject({ type: "object" });
    }
  });

  it("withholds project tools when no project is attached", () => {
    const n = names({ hasProject: false });
    expect(n).toContain("web_search");
    expect(n).not.toContain("read_project_file");
    expect(n).not.toContain("list_project_files");
  });

  it("offers project tools when one is attached", () => {
    expect(names({})).toEqual(expect.arrayContaining(TOOL_NAMES));
  });

  // The user's toggle is authoritative: with Web search off the model must not
  // be handed a search tool, or it would make requests they explicitly declined.
  it("withholds web_search when the user has web search off", () => {
    expect(names({ webSearch: false })).not.toContain("web_search");
  });

  // Memory off has to withhold BOTH memory tools. Leaving past-chat search on
  // would let the model reconstruct most of what the toggle withholds.
  it("withholds both memory tools when memory is off", () => {
    const n = names({ memory: false });
    expect(n).not.toContain("memory");
    expect(n).not.toContain("search_past_chats");
    expect(n).toContain("web_search");
  });

  it("offers both memory tools when memory is on", () => {
    const n = names({ memory: true });
    expect(n).toContain("memory");
    expect(n).toContain("search_past_chats");
  });

  it("withholds the skill tool when nothing is installed", () => {
    expect(names({ hasSkills: false })).not.toContain("skill");
  });

  /**
   * The drift guard.
   *
   * `chat-client.tsx` used to decide "is there anything to offer" with a
   * hand-maintained OR-chain over these same flags. `codeExecution` was added
   * here and never there, so a user with only Code execution on was handed no
   * tools at all. The call site now derives that from `toolDefsFor`, and this
   * asserts the other half: every flag must actually gate something, so a tool
   * added without a gate — or a gate added without a tool — fails here.
   */
  it("gives every availability flag something to unlock", () => {
    for (const key of Object.keys(ALL) as (keyof ToolAvailability)[]) {
      expect(names({ ...NONE, [key]: true }), key).not.toEqual([]);
    }
  });

  it("offers exactly run_python for the code-execution flag", () => {
    expect(toolDefsFor({ ...NONE, codeExecution: true }).map((d) => d.function.name)).toEqual([
      "run_python",
    ]);
  });

  it("offers nothing at all when every toggle is off", () => {
    expect(
      names({
        webSearch: false,
        hasProject: false,
        memory: false,
        hasSkills: false,
        github: false,
        hasArtifact: false,
        buildMode: false,
        codeExecution: false,
        hasFoldedContext: false,
        subagents: false,
      }),
    ).toEqual([]);
  });

  it("offers both build tools together, or neither", () => {
    expect(names({ buildMode: true })).toEqual(
      expect.arrayContaining(["workspace", "tasks"]),
    );
    const off = names({ buildMode: false });
    expect(off).not.toContain("workspace");
    expect(off).not.toContain("tasks");
  });

  it("derives a JSON Schema that documents required args", () => {
    const def = toolDefsFor({ ...ALL, hasProject: false }).find(
      (d) => d.function.name === "web_search",
    )!;
    const params = def.function.parameters as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(params.properties).toHaveProperty("search_query");
    expect(params.properties).toHaveProperty("max_results");
    // max_results has a default, so only the query is required of the model.
    expect(params.required).toEqual(["search_query"]);
  });
});

describe("run_python", () => {
  const runtime = (over: Partial<PythonRun> = {}): ExecRuntime => ({
    kind: "pyodide",
    runPython: async () => ({
      output: "",
      files: [],
      skippedNote: "",
      installed: [],
      ...over,
    }),
    dispose() {},
  });

  it("returns stdout", async () => {
    const r = await executeTool("run_python", JSON.stringify({ code: "print(1)" }), {
      exec: runtime({ output: "1\n" }),
    });
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("1");
  });

  // Honest refusal rather than a fabricated result, matching the pattern
  // `MemoryWorkspace.exec` sets. A tool that silently pretends to have run is
  // the one failure mode worse than not having the tool.
  it("refuses when no runtime is wired up", async () => {
    const r = await executeTool("run_python", JSON.stringify({ code: "print(1)" }), {});
    expect(r.isError).toBe(true);
    expect(r.content).toContain("not running");
  });

  it("refuses an unavailable runtime the same way", async () => {
    const r = await executeTool("run_python", JSON.stringify({ code: "x" }), {
      exec: { ...runtime(), kind: "unavailable" as const },
    });
    expect(r.isError).toBe(true);
  });

  it("mounts what the host provides", async () => {
    const seen: unknown[] = [];
    const r = await executeTool("run_python", JSON.stringify({ code: "x" }), {
      exec: {
        kind: "pyodide",
        runPython: async (_code, mount) => {
          seen.push(mount);
          return { output: "ok", files: [], skippedNote: "", installed: [] };
        },
        dispose() {},
      },
      execMount: async () => [{ path: "data.csv", text: "a,b" }],
    });
    expect(seen[0]).toEqual([{ path: "data.csv", text: "a,b" }]);
    expect(r.isError).toBeUndefined();
  });

  // The payoff of the two-way sync: the .xlsx bytes ARE the answer, and a
  // one-way mount would leave the model describing a file that does not exist.
  it("saves produced files and names them", async () => {
    const saved: string[] = [];
    const r = await executeTool("run_python", JSON.stringify({ code: "x" }), {
      exec: runtime({ files: [{ path: "report.xlsx", bytes: new Uint8Array([1, 2]) }] }),
      onExecFile: async (f) => {
        saved.push(f.path);
      },
    });
    expect(saved).toEqual(["report.xlsx"]);
    expect(r.content).toContain("report.xlsx");
  });

  it("says so when a file was produced with nowhere to put it", async () => {
    const r = await executeTool("run_python", JSON.stringify({ code: "x" }), {
      exec: runtime({ files: [{ path: "a.xlsx", bytes: new Uint8Array([1]) }] }),
    });
    expect(r.content).toContain("nowhere to save");
  });

  it("reports a traceback as a tool error the model can act on", async () => {
    const r = await executeTool("run_python", JSON.stringify({ code: "1/0" }), {
      exec: runtime({ output: "before\n", error: "ZeroDivisionError: division by zero" }),
    });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("ZeroDivisionError");
    // The model's own output comes first, then the failure — the order in which
    // a person debugs.
    expect(r.content.indexOf("before")).toBeLessThan(r.content.indexOf("ZeroDivision"));
  });

  // A script that printed nothing and wrote nothing ran fine and said nothing,
  // which the model must not mistake for a failure.
  it("distinguishes silence from failure", async () => {
    const r = await executeTool("run_python", JSON.stringify({ code: "x = 1" }), {
      exec: runtime(),
    });
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("no output");
  });

  it("passes the cap warnings through", async () => {
    const r = await executeTool("run_python", JSON.stringify({ code: "x" }), {
      exec: runtime({ skippedNote: "big.bin was not saved — over the 2MB per-file limit." }),
    });
    expect(r.content).toContain("was not saved");
  });

  it("streams output to the caller while it runs", async () => {
    const chunks: string[] = [];
    await executeTool("run_python", JSON.stringify({ code: "x" }), {
      exec: {
        kind: "pyodide",
        runPython: async (_c, _m, opts) => {
          opts?.onChunk?.("line one\n");
          opts?.onChunk?.("line two\n");
          return { output: "line one\nline two\n", files: [], skippedNote: "", installed: [] };
        },
        dispose() {},
      },
      onToolProgress: (c) => chunks.push(c),
    });
    expect(chunks).toEqual(["line one\n", "line two\n"]);
  });

  it("forwards requested packages and reports what was installed", async () => {
    let asked: string[] | undefined;
    const r = await executeTool(
      "run_python",
      JSON.stringify({ code: "import docx", install: ["python-docx"] }),
      {
        exec: {
          kind: "pyodide",
          runPython: async (_c, _m, opts) => {
            asked = opts?.install;
            return { output: "", files: [], skippedNote: "", installed: ["python-docx"] };
          },
          dispose() {},
        },
      },
    );
    expect(asked).toEqual(["python-docx"]);
    expect(r.content).toContain("python-docx");
  });

  it("is withheld when code execution is off", () => {
    expect(names({ codeExecution: false })).not.toContain("run_python");
    expect(names({ codeExecution: true })).toContain("run_python");
  });
});

describe("executeTool — argument handling", () => {
  it("reports an unknown tool without throwing", async () => {
    const r = await executeTool("nope", "{}", {});
    expect(r.isError).toBe(true);
    expect(r.content).toContain("Unknown tool");
    // The model is told what it *could* have called.
    expect(r.content).toContain("web_search");
  });

  it("reports unparseable JSON as a recoverable tool error", async () => {
    const r = await executeTool("web_search", "{not json", {});
    expect(r.isError).toBe(true);
    expect(r.content).toContain("not valid JSON");
  });

  it("reports schema violations with the offending path", async () => {
    const r = await executeTool("web_search", JSON.stringify({ search_query: 123 }), {});
    expect(r.isError).toBe(true);
    expect(r.content).toContain("search_query");
  });

  it("rejects an empty query rather than searching for nothing", async () => {
    const r = await executeTool("web_search", JSON.stringify({ search_query: "" }), {});
    expect(r.isError).toBe(true);
  });

  it("treats an empty argument string as {} for a no-arg tool", async () => {
    const r = await executeTool("list_project_files", "", { projectFiles: PROJECT });
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("spec.md");
  });
});

describe("web_search", () => {
  /** The host's keyed, provider-aware caller, stubbed. */
  const searchWith = (sources: WebSource[], error?: string) =>
    vi.fn(async () => ({ sources, error }));

  it("numbers results so inline citations line up, and returns sources", async () => {
    const search = searchWith([
      { title: "First", url: "https://a.test", snippet: "one" },
      { title: "Second", url: "https://b.test", snippet: "two" },
    ]);
    const r = await executeTool("web_search", JSON.stringify({ search_query: "atlas" }), {
      search,
    });
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("[1] First");
    expect(r.content).toContain("[2] Second");
    expect(r.sources).toHaveLength(2);
  });

  // The count reaches the backend, not just the slice. A provider billed per
  // result should not be asked for eight when the model wanted two.
  it("passes max_results through to the host and honours it", async () => {
    const search = searchWith(
      Array.from({ length: 8 }, (_, i) => ({
        title: `T${i}`,
        url: `https://x${i}.test`,
        snippet: "s",
      })),
    );
    const r = await executeTool(
      "web_search",
      JSON.stringify({ search_query: "q", max_results: 2 }),
      { search },
    );
    expect(search).toHaveBeenCalledWith("q", 2);
    expect(r.sources).toHaveLength(2);
  });

  it("tells the model to rephrase when there are no hits", async () => {
    const r = await executeTool("web_search", JSON.stringify({ search_query: "zzz" }), {
      search: searchWith([]),
    });
    expect(r.content).toContain("No results");
    expect(r.isError).toBeUndefined();
  });

  // The regression this whole change exists for. The route answers 200 with an
  // empty list on every failure, so without the reason a rejected key is
  // indistinguishable from "nothing matched" — and the model rephrases its way
  // through the round budget against a problem no query can fix.
  it("relays a backend failure as an error rather than as no results", async () => {
    const r = await executeTool("web_search", JSON.stringify({ search_query: "q" }), {
      search: searchWith([], "Brave Search needs an API key. Add one in settings."),
    });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("needs an API key");
    expect(r.content).not.toContain("Try a different phrasing");
  });

  // A degraded provider that still returned something is not a failure. The
  // results are worth more to the model than the warning.
  it("prefers results over a reason when both arrive", async () => {
    const r = await executeTool("web_search", JSON.stringify({ search_query: "q" }), {
      search: searchWith([{ title: "T", url: "https://a.test", snippet: "s" }], "partial"),
    });
    expect(r.isError).toBeUndefined();
    expect(r.sources).toHaveLength(1);
  });

  // Withheld rather than broken: the tool must not fall back to an unkeyed
  // fetch of its own, which is exactly how it came to ignore the user's
  // configured provider in the first place.
  it("refuses when the host wired up no search", async () => {
    const r = await executeTool("web_search", JSON.stringify({ search_query: "q" }), {});
    expect(r.isError).toBe(true);
    expect(r.content).toContain("unavailable");
  });

  it("surfaces a thrown search as a tool error", async () => {
    const r = await executeTool("web_search", JSON.stringify({ search_query: "q" }), {
      search: async () => {
        throw new Error("offline");
      },
    });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("offline");
  });

  // Aborting is the user pressing Stop; it must propagate, not be swallowed
  // into a tool result the model would then try to reason about.
  it("rethrows an abort", async () => {
    await expect(
      executeTool("web_search", JSON.stringify({ search_query: "q" }), {
        search: async () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          throw e;
        },
      }),
    ).rejects.toThrow(/aborted/);
  });
});

describe("project tools", () => {
  it("lists files with sizes", async () => {
    const r = await executeTool("list_project_files", "{}", { projectFiles: PROJECT });
    expect(r.content).toContain("spec.md");
    expect(r.content).toContain("Notes.TXT");
  });

  it("reads a file by exact name", async () => {
    const r = await executeTool(
      "read_project_file",
      JSON.stringify({ file_name: "spec.md" }),
      { projectFiles: PROJECT },
    );
    expect(r.content).toBe("the specification body");
  });

  it("falls back to a case-insensitive match, since models retype names", async () => {
    const r = await executeTool(
      "read_project_file",
      JSON.stringify({ file_name: "notes.txt" }),
      { projectFiles: PROJECT },
    );
    expect(r.isError).toBeUndefined();
    expect(r.content).toBe("some notes");
  });

  it("lists the available names when the file is missing", async () => {
    const r = await executeTool(
      "read_project_file",
      JSON.stringify({ file_name: "ghost.md" }),
      { projectFiles: PROJECT },
    );
    expect(r.isError).toBe(true);
    expect(r.content).toContain("spec.md");
  });

  it("explains itself when no project is attached", async () => {
    const r = await executeTool("read_project_file", JSON.stringify({ file_name: "x" }), {});
    expect(r.isError).toBe(true);
    expect(r.content).toContain("No project");
  });
});

// ── P4 tools ────────────────────────────────────────────────────────────────

/** In-memory MemoryFsStore, injected so these never touch IndexedDB. */
function fakeMemoryStore() {
  const files = new Map<string, { path: string; text: string; updatedAt: number }>();
  return {
    files,
    store: {
      async list() {
        return [...files.values()];
      },
      async read(path: string) {
        return files.get(path);
      },
      async write(path: string, text: string) {
        files.set(path, { path, text, updatedAt: 1 });
      },
      async remove(path: string) {
        files.delete(path);
      },
    },
  };
}

describe("memory tool", () => {
  it("routes a command through to the store", async () => {
    const m = fakeMemoryStore();
    const r = await executeTool(
      "memory",
      JSON.stringify({ command: "create", path: "/memories/prefs.md", file_text: "metric" }),
      { memoryStore: m.store },
    );
    expect(r.isError).toBeUndefined();
    expect(m.files.get("/memories/prefs.md")?.text).toBe("metric");
  });

  // The Zod layer is what stops a malformed command reaching the executor.
  it("rejects an unknown command as a recoverable tool error", async () => {
    const m = fakeMemoryStore();
    const r = await executeTool("memory", JSON.stringify({ command: "exec" }), {
      memoryStore: m.store,
    });
    expect(r.isError).toBe(true);
  });

  it("rejects a traversal path and writes nothing", async () => {
    const m = fakeMemoryStore();
    const r = await executeTool(
      "memory",
      JSON.stringify({ command: "create", path: "/memories/../keys", file_text: "x" }),
      { memoryStore: m.store },
    );
    expect(r.isError).toBe(true);
    expect(m.files.size).toBe(0);
  });

  it("accepts a bare view, which lists the directory", async () => {
    const m = fakeMemoryStore();
    const r = await executeTool("memory", JSON.stringify({ command: "view" }), {
      memoryStore: m.store,
    });
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("/memories");
  });
});

describe("search_past_chats", () => {
  const embed = async (texts: string[]) =>
    texts.map(() => ({ vector: [1, 0], dims: 2, model: "test" }));

  it("errors clearly when no embedder is available", async () => {
    const r = await executeTool("search_past_chats", JSON.stringify({ search_query: "x" }), {});
    expect(r.isError).toBe(true);
    expect(r.content).toContain("unavailable");
  });

  // "Nothing matched" is a real answer. Flagging it as an error just invites the
  // model to retry the identical search.
  it("returns a plain no-match message rather than an error", async () => {
    const r = await executeTool(
      "search_past_chats",
      JSON.stringify({ search_query: "anything" }),
      { embed },
    );
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("No past conversations matched");
  });

  it("requires a non-empty query", async () => {
    const r = await executeTool("search_past_chats", JSON.stringify({ search_query: "" }), {
      embed,
    });
    expect(r.isError).toBe(true);
  });
});

// ── P5: skills ──────────────────────────────────────────────────────────────

const RESEARCH: Skill = {
  id: "research",
  name: "Research brief",
  description: "Use for current information.",
  body: "Search before writing.",
  allowedTools: ["web_search"],
  source: "user",
  enabled: true,
  updatedAt: 1,
};
const OFFLINE: Skill = { ...RESEARCH, id: "offline", name: "Offline", allowedTools: [] };
const OPEN: Skill = { ...RESEARCH, id: "open", name: "Open", allowedTools: undefined };
const DISABLED: Skill = { ...RESEARCH, id: "off", name: "Off", enabled: false };

/** Injected skill source, so these never touch IndexedDB. */
function skillSource(list: Skill[]) {
  return {
    list: async () => list.filter((s) => s.enabled),
    get: async (id: string) => list.find((s) => s.id === id),
  };
}

describe("skill tool", () => {
  it("lists installed skills when called with no id", async () => {
    const r = await executeTool("skill", "{}", { skills: skillSource([RESEARCH, OPEN]) });
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("research");
    expect(r.content).toContain("Use for current information.");
  });

  it("loads a skill body by id", async () => {
    const r = await executeTool("skill", JSON.stringify({ skill_id: "research" }), {
      skills: skillSource([RESEARCH]),
    });
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("Search before writing.");
  });

  it("reports an unknown id and lists what is available", async () => {
    const r = await executeTool("skill", JSON.stringify({ skill_id: "ghost" }), {
      skills: skillSource([RESEARCH]),
    });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("research");
  });

  it("refuses to load a disabled skill", async () => {
    const r = await executeTool("skill", JSON.stringify({ skill_id: "off" }), {
      skills: skillSource([DISABLED]),
    });
    expect(r.isError).toBe(true);
  });

  // The caller has to learn about the restriction at load time, not after the
  // model has already made a forbidden call.
  it("signals the loaded skill to the caller", async () => {
    const seen: Skill[] = [];
    await executeTool("skill", JSON.stringify({ skill_id: "research" }), {
      skills: skillSource([RESEARCH]),
      onSkillLoaded: (s) => seen.push(s),
    });
    expect(seen.map((s) => s.id)).toEqual(["research"]);
  });

  it("does not signal when the load failed", async () => {
    const seen: Skill[] = [];
    await executeTool("skill", JSON.stringify({ skill_id: "ghost" }), {
      skills: skillSource([RESEARCH]),
      onSkillLoaded: (s) => seen.push(s),
    });
    expect(seen).toEqual([]);
  });
});

describe("allowed-tools enforcement", () => {
  it("permits a tool the skill allows", async () => {
    const r = await executeTool("web_search", JSON.stringify({ search_query: "q" }), {
      search: async () => ({ sources: [] }),
      allowedTools: RESEARCH.allowedTools,
    });
    expect(r.isError).toBeUndefined();
  });

  it("refuses a tool outside the allowed set and names what is permitted", async () => {
    const r = await executeTool("memory", JSON.stringify({ command: "view" }), {
      allowedTools: ["web_search"],
    });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("web_search");
  });

  // The refusal must land before arguments are parsed, so a forbidden call
  // cannot have a side effect on its way to being refused.
  it("refuses before executing, leaving no side effect", async () => {
    const m = fakeMemoryStore();
    const r = await executeTool(
      "memory",
      JSON.stringify({ command: "create", path: "/memories/x.md", file_text: "written" }),
      { allowedTools: [], memoryStore: m.store },
    );
    expect(r.isError).toBe(true);
    expect(m.files.size).toBe(0);
  });

  it("an empty allowed list forbids everything, and says so distinctly", async () => {
    const r = await executeTool("web_search", JSON.stringify({ search_query: "q" }), {
      allowedTools: OFFLINE.allowedTools,
    });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("permits no tools");
  });

  it("an absent allowed list means unrestricted", async () => {
    const m = fakeMemoryStore();
    const r = await executeTool("memory", JSON.stringify({ command: "view" }), {
      allowedTools: OPEN.allowedTools,
      memoryStore: m.store,
    });
    expect(r.isError).toBeUndefined();
  });

  // Otherwise a skill declaring `allowed-tools: []` would lock the model out of
  // loading any other skill for the rest of the turn.
  it("never restricts the skill tool itself", async () => {
    const r = await executeTool("skill", JSON.stringify({ skill_id: "research" }), {
      allowedTools: [],
      skills: skillSource([RESEARCH]),
    });
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("Search before writing.");
  });

  // The definitions were already sent when the turn began, so a mid-turn
  // restriction cannot retract them — enforcement has to hold regardless.
  it("blocks a tool that was offered before the skill was loaded", async () => {
    const offered = toolDefsFor(ALL).map((d) => d.function.name);
    expect(offered).toContain("web_search");
    const r = await executeTool("web_search", JSON.stringify({ search_query: "q" }), {
      allowedTools: [],
    });
    expect(r.isError).toBe(true);
  });
});

// ── P6: connector tool routing ──────────────────────────────────────────────

describe("connector tool routing", () => {
  const MCP_NAME = "mcp__calendar__create_event";

  it("routes a namespaced call to the MCP bridge", async () => {
    const runMcpTool = vi.fn(async () => ({ content: "created" }));
    const r = await executeTool(MCP_NAME, "{}", { runMcpTool });
    expect(runMcpTool).toHaveBeenCalledWith(MCP_NAME, "{}");
    expect(r.content).toBe("created");
  });

  // Without this it would fall through to "unknown tool", which reads as a
  // typo rather than as a connector that is gone.
  it("explains a connector call when no bridge is available", async () => {
    const r = await executeTool(MCP_NAME, "{}", {});
    expect(r.isError).toBe(true);
    expect(r.content).toContain("unavailable");
  });

  it("does not treat a built-in name as a connector call", async () => {
    const runMcpTool = vi.fn(async () => ({ content: "x" }));
    await executeTool("list_project_files", "{}", { runMcpTool, projectFiles: PROJECT });
    expect(runMcpTool).not.toHaveBeenCalled();
  });

  // A skill may withhold a connector tool; it can never grant one, because the
  // approval gate lives inside the bridge and runs regardless.
  it("lets a skill restriction withhold a connector tool", async () => {
    const runMcpTool = vi.fn(async () => ({ content: "x" }));
    const r = await executeTool(MCP_NAME, "{}", { runMcpTool, allowedTools: ["web_search"] });
    expect(r.isError).toBe(true);
    expect(runMcpTool).not.toHaveBeenCalled();
  });

  it("permits a connector tool the active skill allows", async () => {
    const runMcpTool = vi.fn(async () => ({ content: "ok" }));
    const r = await executeTool(MCP_NAME, "{}", { runMcpTool, allowedTools: [MCP_NAME] });
    expect(r.content).toBe("ok");
    expect(runMcpTool).toHaveBeenCalled();
  });
});

// ── P9: the github tool ─────────────────────────────────────────────────────

describe("github tool", () => {
  /** Capture the request the tool made, so headers can be asserted. */
  function stubGithub(body: unknown) {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return { ok: true, json: async () => body };
      }),
    );
    return calls;
  }

  const args = (o: Record<string, unknown>) => JSON.stringify(o);

  it("is offered only when the toggle is on", () => {
    expect(names({})).toContain("github");
    expect(names({ github: false })).not.toContain("github");
  });

  // Providers reject a top-level `anyOf`, which is what a discriminated union
  // over `command` would emit. Same regression guard as the memory tool.
  it("emits a flat object schema, not a union", () => {
    const def = toolDefsFor(ALL).find((d) => d.function.name === "github")!;
    const params = def.function.parameters as Record<string, unknown>;
    expect(params.type).toBe("object");
    expect(params.anyOf).toBeUndefined();
    expect(params.oneOf).toBeUndefined();
  });

  it("lists a directory", async () => {
    stubGithub({
      entries: [
        { path: "lib", type: "dir" },
        { path: "package.json", type: "file", size: 42 },
      ],
    });
    const r = await executeTool("github", args({ command: "list", repo: "vercel/next.js" }), {});
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("dir   lib/");
    expect(r.content).toContain("file  package.json (42 B)");
  });

  it("reads a file", async () => {
    stubGithub({ file: { path: "a.ts", text: "export const x = 1;", truncated: false } });
    const r = await executeTool(
      "github",
      args({ command: "read", repo: "a/b", path: "a.ts" }),
      {},
    );
    expect(r.content).toBe("export const x = 1;");
  });

  // A token in a query string ends up in logs; and a call without one must still
  // work, because public repositories need no credential at all.
  it("sends the token as a header, and only when there is one", async () => {
    const withToken = stubGithub({ entries: [] });
    await executeTool("github", args({ command: "list", repo: "a/b" }), {
      githubToken: "ghp_SECRET",
    });
    const headers = withToken[0].init.headers as Record<string, string>;
    expect(headers["x-github-token"]).toBe("ghp_SECRET");
    expect(withToken[0].url).not.toContain("ghp_SECRET");

    vi.unstubAllGlobals();
    const anon = stubGithub({ entries: [] });
    await executeTool("github", args({ command: "list", repo: "a/b" }), {});
    expect(anon[0].init.headers).not.toHaveProperty("x-github-token");
  });

  it("relays the route's explanation rather than a status code", async () => {
    stubGithub({ error: "Not found: a/b. The repository may be private — connect a GitHub token" });
    const r = await executeTool("github", args({ command: "list", repo: "a/b" }), {});
    expect(r.isError).toBe(true);
    expect(r.content).toContain("private");
  });

  // The listing is what the model needed to pick a path anyway, so answering
  // beats refusing.
  it("answers a read that landed on a directory with its listing", async () => {
    stubGithub({ entries: [{ path: "lib/a.ts", type: "file" }] });
    const r = await executeTool("github", args({ command: "read", repo: "a/b", path: "lib" }), {});
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain("is a directory");
    expect(r.content).toContain("lib/a.ts");
  });

  it("refuses a read with no path before making a request", async () => {
    const calls = stubGithub({});
    const r = await executeTool("github", args({ command: "read", repo: "a/b" }), {});
    expect(r.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("rejects a command it does not have", async () => {
    const r = await executeTool("github", args({ command: "write", repo: "a/b" }), {});
    expect(r.isError).toBe(true);
    expect(r.content).toContain("Invalid arguments");
  });

  it("caps a very large listing instead of dumping the tree", async () => {
    stubGithub({
      entries: Array.from({ length: 200 }, (_, i) => ({ path: `f${i}.ts`, type: "file" })),
    });
    const r = await executeTool("github", args({ command: "list", repo: "a/b" }), {});
    expect(r.content).toContain("more entries not shown");
    expect(r.content.split("\n").length).toBeLessThan(100);
  });
});

// ── artifact ────────────────────────────────────────────────────────────────
// The long-context path: change one heading in a 900-line page without
// re-emitting the other 899 lines.

describe("artifact tool", () => {
  const PAGE = '<h1 class="hero">Old</h1>\n<p>Body</p>';
  const handle = { code: PAGE, title: "HTML preview", lang: "html", path: "index.html" };

  function ctx() {
    const written: string[] = [];
    return {
      written,
      base: { artifact: handle, writeArtifact: async (c: string) => void written.push(c) },
    };
  }

  const call = (args: object, extra: object = {}) =>
    executeTool("artifact", JSON.stringify(args), { ...ctx().base, ...extra });

  it("is offered only when the conversation has an artifact", () => {
    expect(names({ hasArtifact: true })).toContain("artifact");
    expect(names({ hasArtifact: false })).not.toContain("artifact");
  });

  describe("recall_context", () => {
    it("is offered only when something has been folded", () => {
      expect(names({ hasFoldedContext: true })).toContain("recall_context");
      expect(names({ hasFoldedContext: false })).not.toContain("recall_context");
    });

    /**
     * The Memory toggle governs mining *other* conversations. Reading back the
     * folded part of the thread on screen is not that, and gating it there would
     * leave the model holding a lossy summary with no way to check it — which is
     * where confident fabrication comes from.
     */
    it("does not ride the Memory toggle", () => {
      const n = names({ memory: false, hasFoldedContext: true });
      expect(n).toContain("recall_context");
      expect(n).not.toContain("search_past_chats");
    });

    it("says it is this conversation, not a past one", () => {
      const def = toolDefsFor(ALL).find((d) => d.function.name === "recall_context")!;
      expect(def.function.description).toContain("THIS conversation");
    });

    it("reports honestly when there is nothing to search", async () => {
      const r = await executeTool(
        "recall_context",
        JSON.stringify({ search_query: "the port number" }),
        { conversationId: "c1", embed: lexicalEmbedder },
      );
      expect(r.isError).toBeFalsy();
      expect(r.content).toContain("do not fill the gap");
    });

    it("refuses rather than silently returning nothing when unwired", async () => {
      const r = await executeTool("recall_context", JSON.stringify({ search_query: "x" }), {});
      expect(r.isError).toBe(true);
    });
  });

  describe("spawn_subagents", () => {
    const tasks = (n: number) =>
      JSON.stringify({
        tasks: Array.from({ length: n }, (_, i) => ({
          title: `t${i}`,
          instruction: `find out about ${i}`,
        })),
      });

    const wired = (over: Record<string, unknown> = {}) => {
      const spawned: unknown[] = [];
      return {
        spawned,
        ctx: {
          subagentTurn: { calls: 0, agents: 0 },
          subagentHeadroomUsd: 5,
          spawnSubagents: async (t: unknown) => {
            spawned.push(t);
            return { content: "reports" };
          },
          ...over,
        },
      };
    };

    it("is offered only in build mode with the flag on", () => {
      expect(names({ subagents: true })).toContain("spawn_subagents");
      expect(names({ subagents: false })).not.toContain("spawn_subagents");
    });

    it("caps the fan-out in the schema itself", () => {
      const def = toolDefsFor(ALL).find((d) => d.function.name === "spawn_subagents")!;
      const params = def.function.parameters as {
        properties: { tasks: { maxItems?: number; minItems?: number } };
      };
      expect(params.properties.tasks.maxItems).toBe(3);
      expect(params.properties.tasks.minItems).toBe(1);
    });

    it("tells the model outright that sub-agents cannot write", () => {
      const def = toolDefsFor(ALL).find((d) => d.function.name === "spawn_subagents")!;
      expect(def.function.description).toContain("CANNOT write");
    });

    it("runs the fan-out and hands back the reports", async () => {
      const w = wired();
      const r = await executeTool("spawn_subagents", tasks(2), w.ctx);
      expect(r.isError).toBeFalsy();
      expect(r.content).toBe("reports");
      expect(w.spawned).toHaveLength(1);
    });

    /**
     * The reason the counter lives on the context rather than in the tool: the
     * schema's `.max(3)` bounds one call and cannot stop three sequential ones,
     * which is the same money arriving by a different route.
     */
    it("refuses a second fan-out in the same turn", async () => {
      const w = wired();
      await executeTool("spawn_subagents", tasks(1), w.ctx);
      const second = await executeTool("spawn_subagents", tasks(1), w.ctx);
      expect(second.isError).toBe(true);
      expect(w.spawned).toHaveLength(1);
    });

    // A stopped or failed batch still used its one call. Counting on the way out
    // would let it be retried until the money ran out.
    it("counts the call before running it", async () => {
      const ctx = {
        subagentTurn: { calls: 0, agents: 0 },
        subagentHeadroomUsd: 5,
        spawnSubagents: async () => {
          throw new Error("stopped");
        },
      };
      const r = await executeTool("spawn_subagents", tasks(2), ctx);
      expect(r.isError).toBe(true);
      expect(ctx.subagentTurn).toEqual({ calls: 1, agents: 2 });
    });

    it("refuses when the build cannot afford it, and does not spawn", async () => {
      const w = wired({ subagentHeadroomUsd: 0.05 });
      const r = await executeTool("spawn_subagents", tasks(2), w.ctx);
      expect(r.isError).toBe(true);
      expect(r.content).toContain("budget");
      expect(w.spawned).toHaveLength(0);
    });

    it("refuses when the host wired nothing up", async () => {
      const r = await executeTool("spawn_subagents", tasks(1), {});
      expect(r.isError).toBe(true);
    });
  });

  /**
   * The read-only guarantee, at the one tool that can both read and write.
   * Everything else is read-only by omission — a sub-agent's context simply has
   * no `writeArtifact`, no exec runtime, no memory store.
   */
  describe("workspace under readOnly", () => {
    const store = () => {
      const files = new Map<string, string>([["/workspace/app.js", "const x = 1;"]]);
      const file = (path: string) => ({ path, text: files.get(path)!, updatedAt: 1 });
      return {
        read: async (p: string) => (files.has(p) ? file(p) : undefined),
        write: async (p: string, text: string) => void files.set(p, text),
        list: async () => [...files.keys()].map(file),
        remove: async (p: string) => void files.delete(p),
        files,
      };
    };

    it("allows a read", async () => {
      const s = store();
      const r = await executeTool(
        "workspace",
        JSON.stringify({ command: "view", path: "/workspace/app.js" }),
        { workspace: s, readOnly: true },
      );
      expect(r.isError).toBeFalsy();
      expect(r.content).toContain("const x = 1;");
    });

    it("refuses every write, and writes nothing", async () => {
      for (const command of ["create", "append", "str_replace", "insert", "delete", "rename"]) {
        const s = store();
        const before = new Map(s.files);
        const r = await executeTool(
          "workspace",
          JSON.stringify({
            command,
            path: "/workspace/app.js",
            file_text: "nope",
            new_str: "nope",
            old_str: "const x = 1;",
            insert_line: 0,
            new_path: "/workspace/other.js",
          }),
          { workspace: s, readOnly: true },
        );
        expect(r.isError, command).toBe(true);
        expect(r.content, command).toContain("read-only");
        expect([...s.files], command).toEqual([...before]);
      }
    });

    it("leaves the parent's own workspace writes alone", async () => {
      const s = store();
      const r = await executeTool(
        "workspace",
        JSON.stringify({ command: "create", path: "/workspace/new.js", file_text: "ok" }),
        { workspace: s },
      );
      expect(r.isError).toBeFalsy();
      expect(s.files.get("/workspace/new.js")).toBe("ok");
    });
  });

  // A discriminated union renders as a top-level `anyOf`, which OpenAI-style
  // function calling rejects outright.
  it("declares a flat object schema, not a top-level anyOf", () => {
    const def = toolDefsFor(ALL).find((d) => d.function.name === "artifact")!;
    expect(def.function.parameters).toMatchObject({ type: "object" });
    expect(def.function.parameters).not.toHaveProperty("anyOf");
  });

  it("reads the current source", async () => {
    const r = await call({ command: "read" });
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain(PAGE);
  });

  it("patches one fragment and commits the result", async () => {
    const c = ctx();
    const r = await executeTool(
      "artifact",
      JSON.stringify({ command: "update", old_str: "<h1 class=\"hero\">Old</h1>", new_str: "<h1 class=\"hero\">New</h1>" }),
      c.base,
    );
    expect(r.isError).toBeFalsy();
    expect(c.written).toHaveLength(1);
    expect(c.written[0]).toContain("New");
    expect(c.written[0]).toContain("<p>Body</p>");
  });

  it("refuses a patch that does not match and writes nothing", async () => {
    const c = ctx();
    const r = await executeTool(
      "artifact",
      JSON.stringify({ command: "update", old_str: "nothing like this", new_str: "x" }),
      c.base,
    );
    expect(r.isError).toBe(true);
    expect(r.content).toContain("Could not find");
    expect(c.written).toEqual([]);
  });

  it("rewrites when asked, and refuses an empty rewrite", async () => {
    const c = ctx();
    await executeTool("artifact", JSON.stringify({ command: "rewrite", code: "<p>all new</p>" }), c.base);
    expect(c.written).toEqual(["<p>all new</p>"]);
    expect((await call({ command: "rewrite", code: "  " })).isError).toBe(true);
  });

  it("says so plainly when there is no artifact to edit", async () => {
    const r = await executeTool("artifact", JSON.stringify({ command: "read" }), {});
    expect(r.isError).toBe(true);
    expect(r.content).toContain("no artifact open");
  });

  it("refuses to write when the host wired up no writer", async () => {
    const r = await executeTool(
      "artifact",
      JSON.stringify({ command: "update", old_str: "Old", new_str: "New" }),
      { artifact: handle },
    );
    expect(r.isError).toBe(true);
  });

  it("rejects an unknown command through schema validation", async () => {
    // `delete` used to be the unknown command here; P15 made it real.
    const r = await call({ command: "publish" });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("Invalid arguments");
  });

  // ── multi-file addressing (§P14) ──────────────────────────────────────────
  // Storage and the panel have keyed artifacts by path since P10; the tool
  // could still only ever reach whichever file was on screen, so iterating on a
  // four-file build meant re-emitting fences for the other three.

  describe("addressing files by path", () => {
    const files = [
      { path: "index.html", code: PAGE, lang: "html" },
      { path: "styles.css", code: ".hero { color: red }", lang: "css" },
      { path: "src/App.jsx", code: "export default function App() { return null }", lang: "jsx" },
    ];
    const multi = { ...handle, files };

    /** Captures both the code and the path each write targeted. */
    function multiCtx() {
      const writes: { code: string; path?: string }[] = [];
      return {
        writes,
        base: {
          artifact: multi,
          writeArtifact: async (code: string, path?: string) => void writes.push({ code, path }),
        },
      };
    }

    it("lists every file and marks the one on screen", async () => {
      const r = await executeTool("artifact", JSON.stringify({ command: "list" }), multiCtx().base);
      expect(r.isError).toBeFalsy();
      expect(r.content).toContain("3 files");
      expect(r.content).toContain("* index.html");
      expect(r.content).toContain("styles.css");
      expect(r.content).toContain("src/App.jsx");
    });

    it("lists the single file of a build that has no file map", async () => {
      // A host that passes no `files` must still behave as it did before paths,
      // not report an empty build.
      const r = await executeTool("artifact", JSON.stringify({ command: "list" }), ctx().base);
      expect(r.content).toContain("1 file");
      expect(r.content).toContain("index.html");
    });

    it("reads a file that is not the one open in the panel", async () => {
      const r = await executeTool(
        "artifact",
        JSON.stringify({ command: "read", path: "styles.css" }),
        multiCtx().base,
      );
      expect(r.content).toContain(".hero { color: red }");
      expect(r.content).not.toContain("<h1");
    });

    it("patches a named file and writes back to that path", async () => {
      const c = multiCtx();
      const r = await executeTool(
        "artifact",
        JSON.stringify({ command: "update", path: "styles.css", old_str: "red", new_str: "blue" }),
        c.base,
      );
      expect(r.isError).toBeFalsy();
      expect(c.writes).toEqual([{ code: ".hero { color: blue }", path: "styles.css" }]);
    });

    it("still defaults to the open file when no path is given", async () => {
      const c = multiCtx();
      await executeTool(
        "artifact",
        JSON.stringify({ command: "update", old_str: "Old", new_str: "New" }),
        c.base,
      );
      expect(c.writes[0].path).toBe("index.html");
      expect(c.writes[0].code).toContain("New");
    });

    it("creates a new file", async () => {
      const c = multiCtx();
      const r = await executeTool(
        "artifact",
        JSON.stringify({ command: "create", path: "src/Nav.jsx", code: "export const Nav = 1" }),
        c.base,
      );
      expect(r.isError).toBeFalsy();
      expect(c.writes).toEqual([{ code: "export const Nav = 1", path: "src/Nav.jsx" }]);
    });

    it("refuses to create over a file that already exists", async () => {
      // Silently overwriting would discard a version the user never asked to
      // replace, and `rewrite` is right there.
      const c = multiCtx();
      const r = await executeTool(
        "artifact",
        JSON.stringify({ command: "create", path: "styles.css", code: "x" }),
        c.base,
      );
      expect(r.isError).toBe(true);
      expect(r.content).toContain("already exists");
      expect(c.writes).toHaveLength(0);
    });

    it("names the files it does have when asked for one it does not", async () => {
      const r = await executeTool(
        "artifact",
        JSON.stringify({ command: "read", path: "missing.js" }),
        multiCtx().base,
      );
      expect(r.isError).toBe(true);
      expect(r.content).toContain("styles.css");
    });

    it.each(["../secret.js", "/etc/passwd", "C:/x.js", "noextension", "a/../../b.js"])(
      "refuses the path %s",
      async (bad) => {
        const c = multiCtx();
        const r = await executeTool(
          "artifact",
          JSON.stringify({ command: "create", path: bad, code: "x" }),
          c.base,
        );
        expect(r.isError).toBe(true);
        expect(c.writes).toHaveLength(0);
      },
    );

    it("rewrites a named file without touching the others", async () => {
      const c = multiCtx();
      await executeTool(
        "artifact",
        JSON.stringify({ command: "rewrite", path: "src/App.jsx", code: "export default 1" }),
        c.base,
      );
      expect(c.writes).toEqual([{ code: "export default 1", path: "src/App.jsx" }]);
    });
  });

  // ── delete and rename (§P15) ──────────────────────────────────────────────

  describe("removing and moving files", () => {
    const files = [
      { path: "index.html", code: PAGE, lang: "html" },
      { path: "styles.css", code: ".hero { color: red }", lang: "css" },
    ];

    /** Records the moves, and answers `ok` unless told otherwise. */
    function moveCtx(reply: { ok: true } | { ok: false; reason: any } = { ok: true }) {
      const moves: { from: string; to?: string }[] = [];
      return {
        moves,
        base: {
          artifact: { ...handle, files },
          writeArtifact: async () => {},
          moveArtifact: async (from: string, to?: string) => {
            moves.push({ from, to });
            return reply;
          },
        },
      };
    }

    it("deletes the named file", async () => {
      const c = moveCtx();
      const r = await executeTool(
        "artifact",
        JSON.stringify({ command: "delete", path: "styles.css" }),
        c.base,
      );
      expect(r.isError).toBeFalsy();
      expect(c.moves).toEqual([{ from: "styles.css", to: undefined }]);
      // The recovery route is stated, because the delete is soft and the model
      // would otherwise re-create the file under a new name to get it back.
      expect(r.content).toContain("brings it back");
    });

    it("deletes the file on screen when no path is given", async () => {
      const c = moveCtx();
      await executeTool("artifact", JSON.stringify({ command: "delete" }), c.base);
      expect(c.moves).toEqual([{ from: "index.html", to: undefined }]);
    });

    it("renames to a new path", async () => {
      const c = moveCtx();
      const r = await executeTool(
        "artifact",
        JSON.stringify({ command: "rename", path: "styles.css", new_path: "src/theme.css" }),
        c.base,
      );
      expect(r.isError).toBeFalsy();
      expect(c.moves).toEqual([{ from: "styles.css", to: "src/theme.css" }]);
    });

    it("refuses a rename with no new_path", async () => {
      const c = moveCtx();
      const r = await executeTool(
        "artifact",
        JSON.stringify({ command: "rename", path: "styles.css" }),
        c.base,
      );
      expect(r.isError).toBe(true);
      expect(c.moves).toHaveLength(0);
    });

    it.each(["../x.css", "/abs.css", "noextension"])(
      "refuses to rename onto %s",
      async (bad) => {
        const c = moveCtx();
        const r = await executeTool(
          "artifact",
          JSON.stringify({ command: "rename", path: "styles.css", new_path: bad }),
          c.base,
        );
        expect(r.isError).toBe(true);
        expect(c.moves).toHaveLength(0);
      },
    );

    it("refuses to rename onto a file that exists, without asking the host", async () => {
      const c = moveCtx();
      const r = await executeTool(
        "artifact",
        JSON.stringify({ command: "rename", path: "styles.css", new_path: "index.html" }),
        c.base,
      );
      expect(r.isError).toBe(true);
      expect(r.content).toContain("already exists");
      expect(c.moves).toHaveLength(0);
    });

    it("refuses a path that is not in the build", async () => {
      const c = moveCtx();
      const r = await executeTool(
        "artifact",
        JSON.stringify({ command: "delete", path: "ghost.js" }),
        c.base,
      );
      expect(r.isError).toBe(true);
      expect(c.moves).toHaveLength(0);
    });

    it("points at `rewrite` when the last file cannot be removed", async () => {
      const c = moveCtx({ ok: false, reason: "last-file" });
      const r = await executeTool(
        "artifact",
        JSON.stringify({ command: "delete", path: "styles.css" }),
        c.base,
      );
      expect(r.isError).toBe(true);
      expect(r.content).toContain("`rewrite`");
    });

    it("refuses to move when the host wired up no mover", async () => {
      const r = await executeTool("artifact", JSON.stringify({ command: "delete" }), {
        artifact: { ...handle, files },
        writeArtifact: async () => {},
      });
      expect(r.isError).toBe(true);
    });
  });
});
