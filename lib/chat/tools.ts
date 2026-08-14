"use client";

import { z } from "zod";
import type { ToolDef } from "@/lib/router";
import type { WebSource } from "./types";
import { formatPastChats, searchPastChats } from "./chat-index";
import { formatRecall, recallContext } from "./recall";
import {
  allowSubagentCall,
  isSubagentWorkspaceCommand,
  MAX_AGENTS,
  type SubagentTask,
  type SubagentTurnState,
} from "./subagent";
import type { Embedder } from "./embed";
import { MEMORY_ROOT, memoryCommandSchema, runMemoryCommand } from "./memory-fs";
import { memoryFsStore } from "./memory-repo";
import { renderSkill } from "@/lib/skills/disclosure";
import { getSkill, listEnabledSkills } from "@/lib/skills/registry";
import type { Skill } from "@/lib/skills/parse";
import { isMcpToolName } from "@/lib/mcp/protocol";
import { applyArtifactPatch, describePatchFailure, summarizePatch } from "./artifact-patch";
import { validFencePath } from "./artifact-extract";
import { runFsCommand, type FsStore } from "./fs-commands";
import { WORKSPACE_LIMITS, workspaceCommandSchema } from "./workspace/fs";
import { formatLedger, planTasks, setTaskStatus } from "./workspace/tasks";
import { MAX_TASKS, WORKSPACE_ROOT, type WorkspaceTask } from "./workspace/types";
import type { ExecFile, ExecRuntime } from "./exec/runtime";

/**
 * Tool registry for Atlas Chat.
 *
 * Until now the router supported tools end to end but the chat client never sent
 * a `tools` key, so the tool-call UI rendered results it could never receive.
 * This closes that, and is the prerequisite for memory (P4), skills (P5), MCP
 * (P6) and research (P7), all of which are tool-driven.
 *
 * Design follows spec §6:
 *  - Unambiguous names (`search_query`, not `q`) so the model doesn't guess.
 *  - Strict schemas, Zod-validated on the way IN — a model will eventually send
 *    a malformed argument, and that must be a tool error the model can recover
 *    from, not an exception that kills the turn.
 *  - Small and composable; each does one thing.
 *
 * JSON Schema is derived from the Zod schema via Zod 4's native
 * `z.toJSONSchema()`, so the wire contract and the validator cannot drift apart.
 */

/** What a tool hands back to the model, plus anything the UI should show. */
export interface ToolResult {
  /** Serialized and returned to the model as the tool message content. */
  content: string;
  /** Surfaced as citations on the assistant turn, when the tool produced any. */
  sources?: WebSource[];
  /** True when the tool failed; the model is told, and can try something else. */
  isError?: boolean;
}

/** Ambient values a tool may read. Kept explicit so tools stay testable. */
export interface ToolContext {
  signal?: AbortSignal;
  /**
   * One web search against the backend the user configured.
   *
   * Injected as a function rather than as a key, for two reasons. The key is a
   * secret this module has no business holding, and the host already owns a
   * correct caller — the pre-search path — so duplicating the fetch here is how
   * the two drifted apart in the first place: the tool posted to `/api/v1/search`
   * with no `x-search-key` and no `provider`, so a user who had configured Brave,
   * Tavily or Exa silently got the keyless DuckDuckGo scrape inside the loop.
   *
   * `error` is relayed to the model verbatim. The route always answers 200 with
   * `{ sources: [] }` so a failed search cannot kill a turn, which means a
   * rejected key is indistinguishable from "nothing matched" unless the reason
   * travels with it — and a model told "no results" will obey that and burn
   * rounds rephrasing a query that was never the problem.
   */
  search?: (query: string, count: number) => Promise<{ sources: WebSource[]; error?: string }>;
  /** Concatenated knowledge of the active project, when one is attached. */
  projectFiles?: { name: string; text: string }[];
  /** The conversation in progress, excluded from past-chat search results. */
  conversationId?: string;
  /** Embedder for past-chat search. Injected so the tool stays testable. */
  embed?: Embedder;
  /** Storage for the /memories filesystem. Defaults to the IndexedDB store. */
  memoryStore?: ReturnType<typeof memoryFsStore>;
  /**
   * Tool names the currently-loaded skill permits. `undefined` means no
   * restriction; an EMPTY ARRAY means no tools at all, which is a distinct and
   * meaningful thing for a skill to declare.
   */
  allowedTools?: string[];
  /** Called when a skill is loaded, so the caller can apply its restriction. */
  onSkillLoaded?: (skill: Skill) => void;
  /** Skill lookups, injectable so the tool is testable without IndexedDB. */
  skills?: {
    list: () => Promise<Skill[]>;
    get: (id: string) => Promise<Skill | undefined>;
  };
  /**
   * GitHub token, forwarded once per call to `/api/v1/github`. Absent is a valid
   * state — public repositories read fine without one — so its absence must not
   * disable the tool, only limit what it can reach.
   */
  githubToken?: string;
  /**
   * How to run a connector (MCP) tool, including its approval gate. Absent means
   * connectors are unavailable this turn, and any `mcp__` call is refused rather
   * than falling through to "unknown tool".
   */
  runMcpTool?: (name: string, rawArguments: string) => Promise<ToolResult>;
  /**
   * The artifact currently open in the preview panel, for the `artifact` tool to
   * read and patch. Absent means there is nothing to edit yet.
   */
  artifact?: ArtifactHandle;
  /**
   * Commit new artifact source. Separate from `artifact` so the tool cannot
   * write anywhere the host has not explicitly wired up, and so the whole thing
   * is testable without IndexedDB.
   */
  writeArtifact?: (code: string, path?: string) => Promise<void>;
  /**
   * Remove or move a file of the build (§P15). Separate from `writeArtifact`
   * for the same reason that one is separate from `artifact`: the tool can only
   * reach what the host wired up, and the whole thing stays testable without
   * IndexedDB.
   *
   * `to` present means rename; absent means delete. Returns the same reason
   * codes the repo does, so the tool can say which of four different things
   * went wrong.
   */
  moveArtifact?: (
    from: string,
    to?: string,
  ) => Promise<{ ok: true } | { ok: false; reason: "missing" | "occupied" | "last-file" | "unavailable" }>;
  /**
   * The build workspace for this conversation, already bound to it. Absent means
   * the workspace is unavailable and the `workspace` tool refuses rather than
   * silently writing somewhere else.
   */
  workspace?: FsStore;
  /**
   * The task ledger, likewise pre-bound. Split from `workspace` because the two
   * have different storage shapes and a turn can legitimately have one without
   * the other (a plan before any file exists).
   */
  tasks?: {
    conversationId: string;
    list: () => Promise<WorkspaceTask[]>;
    replace: (tasks: WorkspaceTask[]) => Promise<void>;
    setGoal: (goal: string) => Promise<void>;
  };
  /**
   * Called after any workspace or ledger write. The panel reads from storage
   * rather than from the transcript — a `str_replace` never appears as message
   * text — so without this the UI would not know anything had changed.
   */
  onWorkspaceChanged?: () => void;
  /**
   * The code sandbox for this turn. Absent means `run_python` refuses rather
   * than pretending to have run — see `lib/chat/exec/runtime.ts`.
   */
  exec?: ExecRuntime;
  /**
   * What to place in the interpreter's working directory before a run.
   *
   * A function rather than a value so the mount is read at call time: a build
   * that wrote three files in the previous round should see them.
   */
  execMount?: () => Promise<ExecFile[]>;
  /**
   * Save a file the sandbox produced. Absent means the run still happens and its
   * output is still returned — the model is simply told there is nowhere to put
   * the file, rather than a `.xlsx` being generated and silently discarded.
   */
  onExecFile?: (file: ExecFile) => Promise<void>;
  /**
   * Output as it is produced, for the live terminal in the run panel.
   *
   * Only tools that stream anything call it. A long analysis is exactly where a
   * block of text appearing after the fact is the wrong shape.
   */
  onToolProgress?: (chunk: string) => void;
  /**
   * Run a read-only fan-out. Absent means sub-agents are unavailable this turn.
   *
   * A port rather than an import, for the same reason `search` is one: running a
   * nested model turn needs the route, the key and the budget, none of which
   * this module has any business holding.
   */
  spawnSubagents?: (tasks: SubagentTask[]) => Promise<ToolResult>;
  /**
   * The parent turn's fan-out count, **mutated in place**.
   *
   * On the context rather than in the tool because it must outlive one call:
   * the schema's `.max(3)` bounds a single call and cannot stop three sequential
   * ones, which is the same money by another route.
   */
  subagentTurn?: SubagentTurnState;
  /** Parent budget still unspent, in USD. A fan-out is refused below the floor. */
  subagentHeadroomUsd?: number;
  /**
   * This context belongs to a read-only sub-agent.
   *
   * Most of the read-only guarantee is by omission — a sub-agent's context
   * simply has no `writeArtifact`, no exec runtime, no memory store. `workspace`
   * is the exception, because reading the build is most of what an investigation
   * does, so the one tool that can both read and write needs a flag.
   */
  readOnly?: boolean;
}

/**
 * The one tool a skill can never restrict away.
 *
 * Without this, a skill declaring `allowed-tools: []` would lock the model out
 * of loading any *other* skill for the rest of the turn, including one the user
 * then asks for by name.
 */
const ALWAYS_ALLOWED = "skill";

interface ChatTool<S extends z.ZodType> {
  name: string;
  description: string;
  schema: S;
  execute: (input: z.output<S>, ctx: ToolContext) => Promise<ToolResult>;
}

function defineTool<S extends z.ZodType>(t: ChatTool<S>): ChatTool<S> {
  return t;
}

// ── web_search ──────────────────────────────────────────────────────────────

const webSearch = defineTool({
  name: "web_search",
  description:
    "Search the public web for current information. Use when the answer depends on " +
    "recent events, live data, or facts you are unsure about. Returns titles, URLs " +
    "and snippets — cite them by number in your reply.",
  schema: z.object({
    search_query: z.string().min(1).max(400).describe("The search query, in plain language."),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(8)
      .default(5)
      .describe("How many results to return. Keep small unless breadth is needed."),
  }),
  async execute({ search_query, max_results }, ctx) {
    if (!ctx.search) {
      return {
        content: "Web search is unavailable this turn. Answer from what you already know.",
        isError: true,
      };
    }
    const { sources: found, error } = await ctx.search(search_query, max_results);
    const sources = found.slice(0, max_results);
    // A backend error is reported as an error, not as an empty result set. The
    // difference matters to the model: "no results" invites a rephrase, whereas
    // "Brave needs an API key" is not something a better query can fix, and
    // rephrasing against it is exactly how a turn spends its whole round budget.
    if (error && sources.length === 0) {
      return { content: `Search unavailable: ${error}`, isError: true };
    }
    if (sources.length === 0) {
      return { content: "No results found. Try a different phrasing." };
    }
    // Numbered so the model's inline citations line up with the Sources strip.
    const content = sources
      .map((s, i) => `[${i + 1}] ${s.title}\n${s.url}\n${s.snippet}`)
      .join("\n\n");
    return { content, sources };
  },
});

// ── read_project_file ───────────────────────────────────────────────────────

const readProjectFile = defineTool({
  name: "read_project_file",
  description:
    "Read one file from the knowledge attached to the current project. Use when the " +
    "user refers to their uploaded documents. Call list_project_files first if you " +
    "do not know the exact file name.",
  schema: z.object({
    file_name: z.string().min(1).describe("Exact file name, as given by list_project_files."),
  }),
  async execute({ file_name }, ctx) {
    const files = ctx.projectFiles ?? [];
    if (files.length === 0) {
      return { content: "No project is attached to this conversation.", isError: true };
    }
    const hit =
      files.find((f) => f.name === file_name) ??
      files.find((f) => f.name.toLowerCase() === file_name.toLowerCase());
    if (!hit) {
      return {
        content: `No file named "${file_name}". Available: ${files.map((f) => f.name).join(", ")}`,
        isError: true,
      };
    }
    return { content: hit.text };
  },
});

const listProjectFiles = defineTool({
  name: "list_project_files",
  description:
    "List the files in the current project's knowledge base, with their sizes. " +
    "Use before read_project_file when the exact name is unknown.",
  schema: z.object({}),
  async execute(_input, ctx) {
    const files = ctx.projectFiles ?? [];
    if (files.length === 0) {
      return { content: "No project is attached to this conversation." };
    }
    return {
      content: files.map((f) => `${f.name} (${f.text.length} chars)`).join("\n"),
    };
  },
});

// ── artifact ────────────────────────────────────────────────────────────────

/** Enough of an artifact for the tool to read and patch. */
export interface ArtifactHandle {
  code: string;
  title: string;
  lang: string;
  /**
   * Which file of the build this handle is (§P14). The store keys artifacts by
   * (conversation, path), so this is the address `writeArtifact` writes to when
   * the tool call names no other.
   */
  path: string;
  /**
   * Every file in this conversation's build, newest version of each.
   *
   * Carried on the handle rather than fetched by the tool so `executeTool` stays
   * free of storage: the host already holds these in memory for the panel, and
   * the tool needs them to answer `list` and to patch a file that is not the one
   * on screen.
   */
  files?: { path: string; code: string; lang: string }[];
}

const artifact = defineTool({
  name: "artifact",
  description:
    "Edit the build already open in the preview panel WITHOUT rewriting it. A build can hold " +
    "several files, each addressed by `path` (for example `index.html`, `src/App.jsx`, " +
    "`styles.css`). Omit `path` to act on the file currently on screen. " +
    "`list` shows every file and its size. `read` returns one file's source. " +
    "`update` replaces one exact fragment: `old_str` must appear exactly once, character for " +
    "character including indentation, and is replaced by `new_str`. `rewrite` replaces one " +
    "file entirely, for changes too broad to patch. `create` adds a new file at `path`. " +
    "`rename` moves the file at `path` to `new_path`, keeping its history. `delete` removes " +
    "the file at `path` from the build; the last remaining file cannot be removed. " +
    "Prefer `update` — a page is hundreds of lines and re-emitting all of them to change one " +
    "of them is slow and risks changing things you were not asked to. To start the FIRST " +
    "artifact of a conversation, do not use this tool: write a fenced code block in your reply " +
    "instead.",
  // Flat object with a `command` enum rather than a discriminated union: a union
  // renders as a top-level `anyOf` in JSON Schema, which OpenAI-style function
  // calling rejects. Same shape, and the same reason, as `memory` and `github`.
  schema: z.object({
    command: z.enum(["list", "read", "update", "rewrite", "create", "rename", "delete"]),
    path: z
      .string()
      .max(200)
      .optional()
      .describe("Which file to act on. Omit to use the file open in the panel."),
    new_path: z.string().max(200).optional().describe("Where `rename` moves the file."),
    old_str: z.string().max(20000).optional(),
    new_str: z.string().max(200000).optional(),
    code: z.string().max(400000).optional(),
  }),
  async execute({ command, path, new_path, old_str, new_str, code }, ctx) {
    const current = ctx.artifact;
    if (!current)
      return {
        content:
          "There is no artifact open in this conversation yet. Write one as a fenced code block first.",
        isError: true,
      };

    // The file on screen is the default target, and it stands in for the whole
    // list when the host passed none — so a single-file build behaves exactly as
    // it did before paths existed.
    const files = current.files?.length
      ? current.files
      : [{ path: current.path, code: current.code, lang: current.lang }];

    if (command === "list") {
      const rows = files.map(
        (f) =>
          `${f.path === current.path ? "* " : "  "}${f.path}  (${f.lang}, ${f.code.split("\n").length} lines)`,
      );
      return {
        content: `${files.length} file${files.length === 1 ? "" : "s"} in this build (* = open in the panel):\n${rows.join("\n")}`,
      };
    }

    // A path the tool names must be one the fence parser would also accept.
    // Validating here rather than passing it through keeps every artifact
    // address in a conversation to one shape, and stops `../` or an absolute
    // path becoming a storage key nothing else can reach.
    const named = path?.trim() ? validFencePath(path) : undefined;
    if (path?.trim() && !named)
      return {
        content: `"${path}" is not a usable path. Use a relative path with an extension, like "src/App.jsx".`,
        isError: true,
      };

    if (command === "create") {
      if (!named)
        return { content: '`create` needs a `path`, like "src/App.jsx".', isError: true };
      if (!code?.trim())
        return { content: "`create` needs the file's source in `code`.", isError: true };
      // Refused rather than merged: `create` on an existing path is the model
      // having lost track of what it built, and silently overwriting a file it
      // thought was new would discard work with no version the user asked for.
      if (files.some((f) => f.path === named))
        return {
          content: `"${named}" already exists. Use \`update\` to patch it, or \`rewrite\` to replace it.`,
          isError: true,
        };
      if (!ctx.writeArtifact)
        return { content: "Editing the artifact is unavailable in this context.", isError: true };
      await ctx.writeArtifact(code, named);
      return {
        content: `Created ${named} (${code.split("\n").length} lines). The preview has updated.`,
      };
    }

    if (command === "delete" || command === "rename") {
      const fromPath = named ?? current.path;
      if (!files.some((f) => f.path === fromPath))
        return {
          content: `There is no "${fromPath}" in this build. Files: ${files
            .map((f) => f.path)
            .join(", ")}.`,
          isError: true,
        };
      if (!ctx.moveArtifact)
        return { content: "Editing the artifact is unavailable in this context.", isError: true };

      let to: string | undefined;
      if (command === "rename") {
        to = new_path?.trim() ? validFencePath(new_path) : undefined;
        if (!to)
          return {
            content: `\`rename\` needs a \`new_path\` that is a relative path with an extension, like "src/App.jsx".`,
            isError: true,
          };
        if (files.some((f) => f.path === to))
          return {
            content: `"${to}" already exists. Rename it or pick another name.`,
            isError: true,
          };
      }

      const moved = await ctx.moveArtifact(fromPath, to);
      if (!moved.ok) {
        const why = {
          missing: `There is no "${fromPath}" in this build.`,
          occupied: `"${to}" already exists.`,
          // Named rather than silently refused: the model is usually trying to
          // replace the file, and `rewrite` is the command that does that.
          "last-file": `"${fromPath}" is the only file in this build, so it cannot be removed. Use \`rewrite\` to replace its contents instead.`,
          unavailable: "Editing the artifact is unavailable in this context.",
        }[moved.reason];
        return { content: why, isError: true };
      }
      return {
        content:
          command === "rename"
            ? `Renamed ${fromPath} to ${to}. Its version history moved with it.`
            : `Removed ${fromPath} from the build. Writing to that path again brings it back with its history.`,
      };
    }

    const targetPath = named ?? current.path;
    const target = files.find((f) => f.path === targetPath);
    if (!target)
      return {
        content: `There is no "${targetPath}" in this build. Files: ${files
          .map((f) => f.path)
          .join(", ")}. Use \`create\` to add it.`,
        isError: true,
      };

    if (command === "read")
      return {
        content: `${target.path} (${target.lang}), ${target.code.split("\n").length} lines:\n\n${target.code}`,
      };

    if (!ctx.writeArtifact)
      return { content: "Editing the artifact is unavailable in this context.", isError: true };

    if (command === "rewrite") {
      if (!code?.trim()) return { content: "`rewrite` needs the full new source in `code`.", isError: true };
      await ctx.writeArtifact(code, target.path);
      return {
        content: `Rewrote ${target.path} (${code.split("\n").length} lines). The preview has updated.`,
      };
    }

    const result = applyArtifactPatch(target.code, old_str ?? "", new_str ?? "");
    if (!result.ok)
      return { content: describePatchFailure(result, old_str ?? ""), isError: true };
    await ctx.writeArtifact(result.code, target.path);
    return {
      content: `${summarizePatch(old_str ?? "", new_str ?? "")} in ${target.path}. The preview has updated.`,
    };
  },
});

// ── memory ──────────────────────────────────────────────────────────────────

const memory = defineTool({
  name: "memory",
  description:
    `Read and write your own long-term memory, a small filesystem rooted at ${MEMORY_ROOT}. ` +
    "Use `view` with no path to see what you have already recorded, then `view` a file " +
    "before editing it. Record durable facts about the user and their preferences — not " +
    "transient details of the current task. Six commands: view, create, str_replace, " +
    "insert, delete, rename.",
  schema: memoryCommandSchema,
  async execute(input, ctx) {
    const store = ctx.memoryStore ?? memoryFsStore();
    return runMemoryCommand(input, store);
  },
});

// ── search_past_chats ───────────────────────────────────────────────────────

const searchPastChatsTool = defineTool({
  name: "search_past_chats",
  description:
    "Search the user's earlier conversations with you. Use when they refer to something " +
    "discussed before — \"what did we decide about X\", \"remind me what I said\". Returns " +
    "numbered excerpts with the conversation each came from; cite the conversation title " +
    "when you use one, and say plainly if nothing matched.",
  schema: z.object({
    search_query: z
      .string()
      .min(1)
      .max(400)
      .describe("What to look for, in the words the user is likely to have used."),
    max_results: z.number().int().min(1).max(8).default(5),
  }),
  async execute({ search_query, max_results }, ctx) {
    if (!ctx.embed) {
      return { content: "Past-chat search is unavailable in this session.", isError: true };
    }
    const hits = await searchPastChats(search_query, ctx.embed, {
      excludeConversationId: ctx.conversationId,
      k: max_results,
    });
    // Not an error when empty: "nothing matched" is a real, useful answer, and
    // flagging it as a failure invites the model to retry the same search.
    return { content: formatPastChats(hits) };
  },
});

// ── recall_context ──────────────────────────────────────────────────────────

const recallContextTool = defineTool({
  name: "recall_context",
  description:
    "Read back the exact wording of earlier turns in THIS conversation that were folded " +
    "out of your context to save room. Use it whenever you need a detail the summary above " +
    "does not spell out — a name, a path, a number, a version, or what the user actually " +
    "asked for. Prefer calling this over reconstructing from the summary: the summary is " +
    "lossy and you cannot tell which parts it dropped. Returns verbatim excerpts with the " +
    "turn each came from. This is the current conversation, not a past one — never describe " +
    "a result as something from an earlier chat.",
  schema: z.object({
    search_query: z
      .string()
      .min(1)
      .max(400)
      .describe("What to look for, in the words it was likely said with at the time."),
    max_results: z.number().int().min(1).max(6).default(4),
  }),
  async execute({ search_query, max_results }, ctx) {
    if (!ctx.embed || !ctx.conversationId) {
      return { content: "Recall is unavailable in this session.", isError: true };
    }
    const hits = await recallContext(ctx.conversationId, search_query, ctx.embed, {
      k: max_results,
    });
    // Empty is a real answer, not a failure: flagged as an error, the model
    // retries the same query instead of telling the user it does not know.
    return { content: formatRecall(hits) };
  },
});

// ── spawn_subagents ─────────────────────────────────────────────────────────

const spawnSubagents = defineTool({
  name: "spawn_subagents",
  description:
    "Run up to 3 read-only investigations IN PARALLEL and get their findings back. Use when " +
    "a build needs several independent questions answered before you can proceed — comparing " +
    "approaches, checking three parts of a codebase, gathering facts from different sources. " +
    "Declare every task in ONE call; you only get one call per turn. Sub-agents CANNOT write " +
    "files, edit the artifact, update the plan, save memories or run code — they report, and " +
    "you act. Do not use this for something you can answer in a single search.",
  schema: z.object({
    tasks: z
      .array(
        z.object({
          title: z
            .string()
            .min(1)
            .max(60)
            .describe("Short label for this investigation, shown to the user."),
          instruction: z
            .string()
            .min(1)
            .max(1_500)
            .describe("The one question this sub-agent is to answer, stated in full."),
        }),
      )
      .min(1)
      .max(MAX_AGENTS)
      .describe("Every task in the fan-out. They run at the same time, so keep them independent."),
  }),
  async execute({ tasks }, ctx) {
    if (!ctx.spawnSubagents || !ctx.subagentTurn) {
      return { content: "Sub-agents are unavailable in this turn.", isError: true };
    }
    const verdict = allowSubagentCall(
      ctx.subagentTurn,
      tasks.length,
      ctx.subagentHeadroomUsd ?? Infinity,
    );
    if (!verdict.ok) return { content: verdict.refusal, isError: true };

    // Counted BEFORE the run, and on the shared turn object: a fan-out that
    // fails or is stopped still used its one call. Counting on the way out would
    // let a stopped batch be retried until the money ran out.
    ctx.subagentTurn.calls += 1;
    ctx.subagentTurn.agents += tasks.length;

    return ctx.spawnSubagents(tasks);
  },
});

// ── skill ───────────────────────────────────────────────────────────────────

const skill = defineTool({
  name: "skill",
  description:
    "Load a skill's full instructions. The system prompt lists each skill's id and " +
    "description; call this with the id BEFORE starting a task that matches one, then " +
    "follow what it says. Call with no id to re-list what is available.",
  schema: z.object({
    skill_id: z
      .string()
      .max(64)
      .optional()
      .describe("Id of the skill to load, exactly as listed. Omit to list all skills."),
  }),
  async execute({ skill_id }, ctx) {
    const source = ctx.skills ?? { list: listEnabledSkills, get: getSkill };
    if (!skill_id) {
      const all = await source.list();
      if (all.length === 0) return { content: "No skills are installed." };
      return { content: all.map((s) => `${s.id}: ${s.name} — ${s.description}`).join("\n") };
    }
    const found = await source.get(skill_id);
    if (!found || !found.enabled) {
      const all = await source.list();
      return {
        content:
          `No enabled skill with id "${skill_id}".` +
          (all.length ? ` Available: ${all.map((s) => s.id).join(", ")}` : ""),
        isError: true,
      };
    }
    // Signalled to the caller BEFORE returning, so the restriction is already in
    // force for any tool the model calls in reaction to what it just read.
    ctx.onSkillLoaded?.(found);
    return { content: renderSkill(found) };
  },
});

// ── github ──────────────────────────────────────────────────────────────────

/** Entries shown for one `list`. Enough to orient in a repo, not a whole tree. */
const MAX_LISTED_ENTRIES = 80;

const github = defineTool({
  name: "github",
  description:
    "Read a GitHub repository. `list` shows the files in a directory, `read` returns one " +
    "file's text. Use it when the user names a repository or asks what some project's code " +
    "does. Start with `list` at the root unless you already know the exact path. " +
    "READ-ONLY: this cannot commit, push, open a pull request or change anything.",
  // One flat object with a `command` enum, not a discriminated union: a union
  // renders as a top-level `anyOf` in JSON Schema, which OpenAI-style function
  // calling rejects. Same shape, and same reason, as the `memory` tool.
  schema: z.object({
    command: z.enum(["list", "read"]).describe("`list` a directory, or `read` one file."),
    repo: z
      .string()
      .min(1)
      .max(200)
      .describe('The repository as "owner/repo", or a github.com URL.'),
    path: z
      .string()
      .max(400)
      .default("")
      .describe("Path inside the repository. Empty lists the repository root."),
    ref: z
      .string()
      .max(255)
      .optional()
      .describe("Branch, tag or commit SHA. Omit for the default branch."),
  }),
  async execute({ command, repo, path, ref }, ctx) {
    if (command === "read" && !path.trim()) {
      return { content: "`read` needs a path. Use `list` to see what is there.", isError: true };
    }
    const res = await fetch("/api/v1/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // BYOK (§1.3): held in this browser, forwarded once, never stored.
        ...(ctx.githubToken ? { "x-github-token": ctx.githubToken } : {}),
      },
      body: JSON.stringify({ repo, path, ...(ref ? { ref } : {}) }),
      signal: ctx.signal,
    });
    const data = (await res.json().catch(() => null)) as {
      error?: string;
      entries?: { path: string; type: "file" | "dir"; size?: number }[];
      file?: { path: string; text: string; truncated: boolean };
    } | null;
    if (!data) return { content: "GitHub returned an unreadable response.", isError: true };
    // The route already turns every GitHub failure into a sentence the model can
    // act on ("may be private — connect a token"), so it is relayed as-is rather
    // than replaced with a status code.
    if (data.error) return { content: data.error, isError: true };

    if (data.entries) {
      if (data.entries.length === 0) {
        return { content: `"${path || "/"}" is empty.` };
      }
      const shown = data.entries.slice(0, MAX_LISTED_ENTRIES);
      const lines = shown.map((e) =>
        e.type === "dir" ? `dir   ${e.path}/` : `file  ${e.path}${e.size ? ` (${e.size} B)` : ""}`,
      );
      if (data.entries.length > shown.length) {
        lines.push(`… ${data.entries.length - shown.length} more entries not shown`);
      }
      // A `read` that landed on a directory is answered rather than refused: the
      // listing is what the model needed to pick the right path anyway.
      const prefix = command === "read" ? `"${path}" is a directory. Its contents:\n` : "";
      return { content: prefix + lines.join("\n") };
    }

    if (data.file) {
      return { content: data.file.text };
    }
    return { content: "GitHub returned nothing for that path.", isError: true };
  },
});

// ── workspace ───────────────────────────────────────────────────────────────

const workspace = defineTool({
  name: "workspace",
  description:
    `Read and write the files of the thing you are building, a filesystem rooted at ${WORKSPACE_ROOT}. ` +
    "Everything here survives this conversation being compacted, so it is where deliverables " +
    "belong — a page, a stylesheet, a component, a report. Seven commands: view, create, " +
    "append, str_replace, insert, delete, rename. " +
    "Use `append` to write a file that is longer than one reply can hold: send it in chunks " +
    "rather than stopping partway. Use `str_replace` to change part of an existing file — " +
    "re-sending a 900-line file to edit one line is slow and risks changing things you were " +
    "not asked to. `view` with no path lists what you have already written.",
  schema: workspaceCommandSchema,
  async execute(input, ctx) {
    if (!ctx.workspace) {
      return {
        content: "The build workspace is unavailable in this context.",
        isError: true,
      };
    }
    // Enforced here rather than by handing sub-agents a crippled store, because
    // this is the one place that knows a command's intent. `view` is the whole
    // read-only surface of this tool; everything else mutates the one workspace
    // that three parallel agents would be writing to at once.
    if (ctx.readOnly && !isSubagentWorkspaceCommand(input.command)) {
      return {
        content:
          `Sub-agents are read-only: \`${input.command}\` is not allowed. ` +
          `Report what needs to change and the parent agent will write it.`,
        isError: true,
      };
    }
    const result = await runFsCommand(input, ctx.workspace, WORKSPACE_LIMITS);
    // The panel reads from storage, not from the transcript, so it has to be
    // told that storage changed. Only on a successful write: a rejected path
    // must not cause a re-render that suggests something happened.
    if (!result.isError && input.command !== "view") ctx.onWorkspaceChanged?.();
    return result;
  },
});

// ── tasks ───────────────────────────────────────────────────────────────────

const tasks = defineTool({
  name: "tasks",
  description:
    "Your build plan, which persists for the whole conversation and is shown back to you on " +
    "every turn. Call `plan` once with the full list of steps before starting a multi-step " +
    "build, then `start` a step as you begin it and `complete` it when it is done — that " +
    "record is how you know where you are if earlier messages are no longer visible. " +
    "`block` a step that cannot proceed, with a note saying why. Refer to a step by its " +
    "number or by enough of its title to be unambiguous.",
  // Flat object with a `command` enum rather than a discriminated union, for the
  // same reason as `memory`, `github` and `artifact`: a union renders as a
  // top-level `anyOf`, which OpenAI-style function calling rejects.
  schema: z.object({
    command: z.enum(["plan", "start", "complete", "block", "list"]),
    steps: z
      .array(z.string().min(1).max(300))
      .max(MAX_TASKS)
      .optional()
      .describe("plan: the full list of steps, in order. Replaces any existing plan."),
    goal: z
      .string()
      .max(1000)
      .optional()
      .describe("plan: one sentence on what the finished thing is. Recorded alongside the steps."),
    step: z
      .string()
      .max(300)
      .optional()
      .describe("start/complete/block: the step's number, or enough of its title to identify it."),
    note: z
      .string()
      .max(300)
      .optional()
      .describe("A short line on what happened. Required in spirit for `block`."),
  }),
  async execute({ command, steps, goal, step, note }, ctx) {
    const ledger = ctx.tasks;
    if (!ledger) {
      return { content: "The build plan is unavailable in this context.", isError: true };
    }
    const current = await ledger.list();

    if (command === "list") {
      return {
        content: current.length ? formatLedger(current) : "No plan yet. Call `plan` with the steps.",
      };
    }

    if (command === "plan") {
      if (!steps?.length) {
        return { content: "`plan` needs a `steps` array.", isError: true };
      }
      const result = planTasks(ledger.conversationId, steps, current);
      if (result.isError) return { content: result.message, isError: true };
      await ledger.replace(result.tasks);
      if (goal?.trim()) await ledger.setGoal(goal.trim());
      ctx.onWorkspaceChanged?.();
      return { content: `${result.message}\n${formatLedger(result.tasks)}` };
    }

    if (!step?.trim()) {
      return { content: `\`${command}\` needs a \`step\`.`, isError: true };
    }
    const status = command === "start" ? "active" : command === "complete" ? "done" : "blocked";
    const result = setTaskStatus(current, step, status, note);
    if (result.isError) return { content: result.message, isError: true };
    await ledger.replace(result.tasks);
    ctx.onWorkspaceChanged?.();
    return { content: `${result.message}\n${formatLedger(result.tasks)}` };
  },
});

// ── run_python ──────────────────────────────────────────────────────────────

const runPython = defineTool({
  name: "run_python",
  description:
    "Run Python in a sandbox and get back stdout, errors, and any files it wrote. The build " +
    "workspace is mounted in the working directory, so `open('data.csv')` reads a file the " +
    "user attached or you created, and anything you write — including binary formats like " +
    ".xlsx, .docx and .pdf — is saved back as a real file the user can download. Variables " +
    "persist between calls in one conversation, so you can load data once and work with it " +
    "over several turns. Use this for anything computed rather than recalled: analysing data, " +
    "producing spreadsheets and documents, checking arithmetic, generating charts. There is " +
    "no network access inside the sandbox.",
  schema: z.object({
    code: z
      .string()
      .min(1)
      .max(40_000)
      .describe("The Python source to run. Print what you want to see; a trailing expression is also shown."),
    install: z
      .array(z.string().min(1).max(60))
      .max(8)
      .optional()
      .describe(
        "Extra packages to install first, e.g. ['python-docx', 'reportlab']. numpy, pandas, " +
          "matplotlib, scipy, openpyxl and pillow are already available.",
      ),
  }),
  async execute({ code, install }, ctx) {
    // An honest refusal rather than a fabricated result, matching the pattern
    // `MemoryWorkspace.exec` sets in lib/code/workspace.ts. A tool that silently
    // pretends to have run is the one failure mode worse than not having it.
    if (!ctx.exec || ctx.exec.kind === "unavailable") {
      return {
        content:
          "The Python sandbox is not running. Ask the user to turn on Code execution in the " +
          "composer menu, or answer without running code.",
        isError: true,
      };
    }

    const mount = (await ctx.execMount?.()) ?? [];
    const run = await ctx.exec.runPython(code, mount, {
      install,
      onChunk: (text) => ctx.onToolProgress?.(text),
      signal: ctx.signal,
    });

    // Written back before the result is composed, so a script whose output is
    // purely a file still reports something the user can act on.
    let saved: string[] = [];
    if (run.files.length && ctx.onExecFile) {
      saved = [];
      for (const f of run.files) {
        try {
          await ctx.onExecFile(f);
          saved.push(f.path);
        } catch {
          /* reported by its absence from `saved`, below */
        }
      }
    }

    const parts: string[] = [];
    if (run.installed.length) parts.push(`Installed: ${run.installed.join(", ")}`);
    if (run.output.trim()) parts.push(run.output.trimEnd());
    if (saved.length) parts.push(`Saved to the workspace: ${saved.join(", ")}`);
    if (run.files.length && !ctx.onExecFile) {
      parts.push(
        "Files were produced but there is nowhere to save them in this context; print what you need instead.",
      );
    }
    if (run.skippedNote) parts.push(run.skippedNote);

    if (run.error) {
      // The traceback last, so the model reads its own output first and then the
      // failure — the order in which a person debugs.
      parts.push(run.error);
      return { content: parts.join("\n\n") || run.error, isError: true };
    }

    // A script that printed nothing and wrote nothing ran fine and said nothing,
    // which the model must not mistake for a failure.
    return { content: parts.join("\n\n") || "Ran with no output." };
  },
});

// ── registry ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous schemas
const REGISTRY: ChatTool<any>[] = [
  webSearch,
  listProjectFiles,
  readProjectFile,
  artifact,
  workspace,
  tasks,
  memory,
  searchPastChatsTool,
  recallContextTool,
  spawnSubagents,
  skill,
  github,
  runPython,
];

export const TOOL_NAMES = REGISTRY.map((t) => t.name);

/** Which tools the user's current toggles permit this turn. */
export interface ToolAvailability {
  /** The composer's Web toggle. Gates `web_search`. */
  webSearch: boolean;
  /** Whether a project is attached. Gates the project tools. */
  hasProject: boolean;
  /** The Memory toggle. Gates `memory` and `search_past_chats`. */
  memory: boolean;
  /** Whether any enabled skill exists. Gates the `skill` tool. */
  hasSkills: boolean;
  /** The GitHub toggle. Gates the `github` tool. */
  github: boolean;
  /**
   * Whether this conversation has an artifact open. Gates the `artifact` tool:
   * offering an editor for a document that does not exist only invites a call
   * that can answer "there is nothing to edit".
   */
  hasArtifact: boolean;
  /**
   * The composer's Build toggle. Gates `workspace` and `tasks`.
   *
   * Off by default. A build turn raises the round and output budgets and adds a
   * block to every system prompt, so it is opted into rather than out of — the
   * same reasoning that keeps research off by default.
   */
  buildMode: boolean;
  /**
   * The composer's Code execution toggle. Gates `run_python`.
   *
   * Its own switch rather than riding build mode: running code is useful in an
   * ordinary conversation ("what's the compound return on this?") and a build
   * can be a static page that never needs an interpreter. Off by default only
   * because the runtime is a ~10MB download the user should choose to pay for.
   */
  codeExecution: boolean;
  /**
   * Whether this conversation has folded turns that can be recalled. Gates
   * `recall_context`.
   *
   * Same argument as `hasArtifact` and `hasSkills`: a tool whose only possible
   * answer is "there is nothing here" costs a round to discover that. It is
   * deliberately **not** gated on the Memory toggle — that switch governs mining
   * other conversations, and reading back the thread you are currently in is not
   * that.
   */
  hasFoldedContext: boolean;
  /**
   * Whether a read-only fan-out may be spawned. Gates `spawn_subagents`.
   *
   * Build mode only, and behind `chatSubagents`. Three parallel model runs is
   * the most expensive thing a single tool call in this app can do, so it is
   * offered only where the user has already opted into a mode that carries a
   * dollar ceiling and shows a meter.
   */
  subagents: boolean;
}

/**
 * Wire definitions for the tools available in this turn.
 *
 * Availability is driven by the user's own toggles, not just by what exists.
 * If someone turns Web search off, the model must not be handed a search tool —
 * letting it search anyway would override an explicit choice and make network
 * requests the user declined. Likewise, offering project tools with no project
 * attached only invites a call that can answer "no project is attached".
 *
 * The Memory toggle gates both memory tools. Turning memory off has to mean the
 * model cannot read the user's remembered notes OR mine their past
 * conversations — leaving `search_past_chats` on would let it reconstruct most of
 * what the toggle was supposed to withhold.
 */
export function toolDefsFor(opts: ToolAvailability): ToolDef[] {
  const allowed = REGISTRY.filter((t) => {
    if (t.name === "web_search") return opts.webSearch;
    if (t.name.includes("project")) return opts.hasProject;
    if (t.name === "memory" || t.name === "search_past_chats") return opts.memory;
    // Offering `skill` with nothing installed only invites a call that can
    // answer "no skills are installed".
    if (t.name === "skill") return opts.hasSkills;
    // Reaching api.github.com is an outbound request with the user's repository
    // names in it, so it follows the same rule as web search: their toggle
    // decides, not the model's judgement.
    if (t.name === "github") return opts.github;
    if (t.name === "artifact") return opts.hasArtifact;
    // Not under the Memory toggle, deliberately: this reads back the folded part
    // of the conversation the user is looking at, which is not "mining their
    // history" by any reading. Withholding it would leave the model with a lossy
    // summary and no way to check it — which is how confident fabrication starts.
    if (t.name === "recall_context") return opts.hasFoldedContext;
    if (t.name === "spawn_subagents") return opts.subagents;
    // Both build tools ride the one toggle. Offering `workspace` without `tasks`
    // would give the model somewhere to write files and no way to record why,
    // which is the half of the pair that survives compaction.
    if (t.name === "workspace" || t.name === "tasks") return opts.buildMode;
    if (t.name === "run_python") return opts.codeExecution;
    return true;
  });
  return allowed.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: z.toJSONSchema(t.schema, { io: "input" }) as Record<string, unknown>,
    },
  }));
}

/**
 * Run one tool call.
 *
 * Never throws. Every failure path — unknown name, unparseable arguments, schema
 * violation, network error — comes back as `isError` content, because the model
 * can react to that and cannot react to an exception.
 */
export async function executeTool(
  name: string,
  rawArguments: string,
  ctx: ToolContext,
): Promise<ToolResult> {
  // Connector tools are namespaced and handled by the MCP bridge, which owns the
  // approval gate. Checked BEFORE the skill restriction below so the two compose
  // in the right order: a skill can withhold a connector tool, but a skill can
  // never grant one — the user's approval is still required either way.
  if (isMcpToolName(name)) {
    if (ctx.allowedTools && !ctx.allowedTools.includes(name)) {
      return {
        content:
          ctx.allowedTools.length === 0
            ? `The skill you are following permits no tools, including "${name}".`
            : `The skill you are following permits only: ${ctx.allowedTools.join(", ")}.`,
        isError: true,
      };
    }
    if (!ctx.runMcpTool) {
      return {
        content: `Connector tool "${name}" is unavailable — the connector is disabled or was removed.`,
        isError: true,
      };
    }
    return ctx.runMcpTool(name, rawArguments);
  }

  const tool = REGISTRY.find((t) => t.name === name);
  if (!tool) {
    return {
      content: `Unknown tool "${name}". Available: ${TOOL_NAMES.join(", ")}`,
      isError: true,
    };
  }

  // A loaded skill's `allowed-tools` is enforced here rather than by filtering
  // the tool definitions, for two reasons. The definitions were already sent
  // when the turn started, so a mid-turn restriction cannot retract them; and
  // this is the choke point every call passes through, so the restriction holds
  // even if a model calls a tool it was never offered. Checked before parsing
  // arguments, so a forbidden call cannot have side effects on the way to being
  // refused.
  if (ctx.allowedTools && name !== ALWAYS_ALLOWED && !ctx.allowedTools.includes(name)) {
    return {
      content:
        ctx.allowedTools.length === 0
          ? `The skill you are following permits no tools. Answer from the instructions instead of calling "${name}".`
          : `The skill you are following permits only: ${ctx.allowedTools.join(", ")}. "${name}" is not one of them.`,
      isError: true,
    };
  }

  let parsedJson: unknown;
  try {
    // Models sometimes emit "" for a no-argument call.
    parsedJson = rawArguments.trim() ? JSON.parse(rawArguments) : {};
  } catch {
    return {
      content: `Arguments for "${name}" were not valid JSON. Send a JSON object matching the schema.`,
      isError: true,
    };
  }

  const parsed = tool.schema.safeParse(parsedJson);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i: z.core.$ZodIssue) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { content: `Invalid arguments for "${name}" — ${issues}`, isError: true };
  }

  try {
    return await tool.execute(parsed.data, ctx);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e; // user stopped the turn
    return { content: `Tool "${name}" failed: ${(e as Error).message}`, isError: true };
  }
}
