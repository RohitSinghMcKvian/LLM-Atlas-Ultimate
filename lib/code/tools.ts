"use client";

// The Atlas Code agent's tool belt (§6): OpenAI-format definitions the router
// forwards to the model, plus the browser-side executor that runs each call
// against the workspace. Every mutation returns a ChangeRecord so the UI can
// show diffs and per-file reverts.

import type { ToolDef } from "@/lib/router";
import { diffLines, diffStat } from "@/lib/diff";
import { runPython } from "./pyodide";
import { isTextPath, type Workspace } from "./workspace";
import { describeSecretBlock, scanSecrets, shouldScanPath } from "@/lib/engine/security";

export interface ChangeRecord {
  id: string;
  path: string;
  /** null = file did not exist before (created). */
  before: string | null;
  /** null = file deleted. */
  after: string | null;
  tool: "write_file" | "edit_file" | "delete_file" | "editor";
  ts: number;
}

export interface ToolExecution {
  /** Result text fed back to the model. */
  result: string;
  isError?: boolean;
  /** Filesystem mutation, when one happened. */
  change?: ChangeRecord;
  /** Short human summary for the UI chip (falls back to result). */
  display?: string;
}

const MAX_READ = 24_000;
const MAX_EXEC_OUTPUT = 8_000;

export const AGENT_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "list_files",
      description:
        "List every file in the workspace with sizes (node_modules/.git excluded). Start here to orient yourself.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a text file from the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative path, e.g. lib/stats.js" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create or fully overwrite a file. For small changes to an existing file prefer edit_file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string", description: "Full new file content." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Exact string replacement in a file. old_string must appear exactly once (or pass replace_all). Read the file first so old_string matches exactly, including whitespace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
          replace_all: { type: "boolean", description: "Replace every occurrence (default false)." },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file from the workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Run a shell command in the workspace (jsh: node, npm, ls, cat, etc). Returns stdout+stderr and exit code. 60s timeout. Use for running code and tests.",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "e.g. npm test" } },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_python",
      description:
        "Execute Python 3 (Pyodide, browser-side). Workspace text files are synced INTO the Python cwd before running, so open('data.csv') works. Files Python writes are NOT synced back — return results via print() and persist with write_file. Globals persist across calls. Common scientific packages auto-load on import.",
      parameters: {
        type: "object",
        properties: { code: { type: "string", description: "Python source to execute." } },
        required: ["code"],
      },
    },
  },
];

/**
 * Delegated research: a nested agent with read-only tools and its own budget.
 * Executed inside the agent loop (agent.ts), not by executeTool — it needs the
 * model/stream plumbing.
 */
export const SUBAGENT_TOOL: ToolDef = {
  type: "function",
  function: {
    name: "spawn_subagent",
    description:
      "Delegate a focused task to a role-scoped subagent that reports back a summary — use it to explore or verify without filling your own context. Roles: explorer (read-only codebase mapping, default), tester (writes/runs tests ONLY), reviewer (read-only diff critique), researcher (read-only investigation). Workspaces may define more under .atlas/agents/.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description:
            "Self-contained instructions, e.g. 'Read every file under lib/ and summarize the exported API.'",
        },
        role: {
          type: "string",
          description: "Role id (default: explorer).",
        },
      },
      required: ["task"],
    },
  },
};

const READONLY_NAMES = new Set(["list_files", "read_file"]);

/** Read-only subset — plan mode and subagents run with these. */
export const READONLY_TOOLS: ToolDef[] = AGENT_TOOLS.filter((t) =>
  READONLY_NAMES.has(t.function.name),
);

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} kB`;
}

function normalizePath(p: unknown): string {
  const s = String(p ?? "").trim().replace(/^\.?\//, "");
  if (!s) throw new Error("path is required");
  if (s.includes("..")) throw new Error("path may not contain ..");
  return s;
}

function statLine(before: string | null, after: string | null): string {
  const { added, removed } = diffStat(diffLines(before ?? "", after ?? ""));
  return `+${added} -${removed}`;
}

/** Execute one tool call against the workspace. Never throws. */
export async function executeTool(
  workspace: Workspace,
  name: string,
  argsJson: string,
  onTerminal?: (text: string) => void,
): Promise<ToolExecution> {
  let args: any = {};
  try {
    args = argsJson.trim() ? JSON.parse(argsJson) : {};
  } catch {
    return { result: `Invalid JSON arguments for ${name}: ${argsJson.slice(0, 200)}`, isError: true };
  }

  try {
    switch (name) {
      case "list_files": {
        const files = await workspace.listFiles();
        if (files.length === 0) return { result: "(empty workspace)" };
        const lines = files.map((f) => `${f.path} (${fmtBytes(f.size)})`);
        return {
          result: lines.join("\n").slice(0, MAX_READ),
          display: `${files.length} files`,
        };
      }

      case "read_file": {
        const path = normalizePath(args.path);
        const content = await workspace.readFile(path);
        const truncated = content.length > MAX_READ;
        return {
          result: truncated
            ? `${content.slice(0, MAX_READ)}\n… (truncated, ${content.length} chars total)`
            : content,
          display: `${path} (${fmtBytes(content.length)}${truncated ? ", truncated" : ""})`,
        };
      }

      case "write_file": {
        const path = normalizePath(args.path);
        const content = String(args.content ?? "");
        if (shouldScanPath(path)) {
          const findings = scanSecrets(content);
          if (findings.length)
            return { result: describeSecretBlock(path, findings), isError: true, display: "blocked: secret" };
        }
        const before = (await workspace.exists(path))
          ? await workspace.readFile(path).catch(() => null)
          : null;
        await workspace.writeFile(path, content);
        const change: ChangeRecord = {
          id: uid(), path, before, after: content, tool: "write_file", ts: Date.now(),
        };
        return {
          result: `Wrote ${path} (${content.length} chars, ${statLine(before, content)})`,
          display: `${path} ${statLine(before, content)}`,
          change,
        };
      }

      case "edit_file": {
        const path = normalizePath(args.path);
        const oldStr = String(args.old_string ?? "");
        const newStr = String(args.new_string ?? "");
        if (!oldStr) throw new Error("old_string is required and may not be empty");
        const before = await workspace.readFile(path);
        const count = before.split(oldStr).length - 1;
        if (count === 0)
          throw new Error(
            `old_string not found in ${path}. Read the file again — it must match exactly, including whitespace.`,
          );
        if (count > 1 && !args.replace_all)
          throw new Error(
            `old_string appears ${count} times in ${path}. Provide more context to make it unique, or set replace_all: true.`,
          );
        const after = args.replace_all
          ? before.split(oldStr).join(newStr)
          : before.replace(oldStr, newStr);
        if (shouldScanPath(path)) {
          // Only flag secrets introduced by THIS edit, not pre-existing ones.
          const introduced = scanSecrets(after).filter(
            (f) => !scanSecrets(before).some((b) => b.kind === f.kind),
          );
          if (introduced.length)
            return { result: describeSecretBlock(path, introduced), isError: true, display: "blocked: secret" };
        }
        await workspace.writeFile(path, after);
        const change: ChangeRecord = {
          id: uid(), path, before, after, tool: "edit_file", ts: Date.now(),
        };
        return {
          result: `Edited ${path} (${count} replacement${count === 1 ? "" : "s"}, ${statLine(before, after)})`,
          display: `${path} ${statLine(before, after)}`,
          change,
        };
      }

      case "delete_file": {
        const path = normalizePath(args.path);
        const before = await workspace.readFile(path).catch(() => null);
        await workspace.deleteFile(path);
        const change: ChangeRecord = {
          id: uid(), path, before, after: null, tool: "delete_file", ts: Date.now(),
        };
        return { result: `Deleted ${path}`, display: path, change };
      }

      case "run_command": {
        const command = String(args.command ?? "").trim();
        if (!command) throw new Error("command is required");
        onTerminal?.(`$ ${command}\n`);
        const res = await workspace.exec(command, onTerminal);
        const tail =
          res.output.length > MAX_EXEC_OUTPUT
            ? `… (truncated)\n${res.output.slice(-MAX_EXEC_OUTPUT)}`
            : res.output;
        const status = res.timedOut
          ? "TIMED OUT after 60s"
          : `exit code ${res.code}`;
        return {
          result: `${tail.trim() || "(no output)"}\n\n[${status}]`,
          isError: res.code !== 0,
          display: `${command} → ${status}`,
        };
      }

      case "run_python": {
        const code = String(args.code ?? "");
        if (!code.trim()) throw new Error("code is required");
        onTerminal?.(`>>> python (${code.split("\n").length} lines)\n`);
        const res = await runPython(code, workspace);
        if (res.output.trim()) onTerminal?.(res.output.trimEnd() + "\n");
        if (res.error) onTerminal?.(res.error + "\n");
        const body = [res.output.trim(), res.error].filter(Boolean).join("\n");
        return {
          result: body || "(no output — use print())",
          isError: !!res.error,
          display: res.error ? "python error" : "python ok",
        };
      }

      default:
        return { result: `Unknown tool: ${name}`, isError: true };
    }
  } catch (e) {
    return { result: `Error: ${(e as Error).message}`, isError: true };
  }
}
