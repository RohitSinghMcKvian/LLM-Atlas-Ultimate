"use client";

// The Atlas Code workspace — a real, browser-side filesystem + runtime the
// agent operates on (§6). Two backends behind one interface:
//
//  - WebContainerWorkspace: StackBlitz WebContainer (real Node 20 + jsh shell,
//    npm works). Requires cross-origin isolation (COOP/COEP on /code).
//  - MemoryWorkspace: plain in-memory FS fallback when isolation/browser
//    support is missing. File tools + Python (Pyodide) still work; Node
//    command execution reports unavailable instead of pretending.
//
// Everything is capped and truncated defensively: agent tool results feed
// straight back into model context.

export interface FileEntry {
  path: string;
  size: number;
}

export interface ExecResult {
  code: number;
  output: string;
  timedOut?: boolean;
}

export interface Workspace {
  readonly kind: "webcontainer" | "memory";
  listFiles(): Promise<FileEntry[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Run a shell command (jsh). onChunk receives live output for the terminal. */
  exec(
    command: string,
    onChunk?: (text: string) => void,
    timeoutMs?: number,
  ): Promise<ExecResult>;
  /** Kill the currently running exec, if any. */
  killActive(): void;
  /**
   * Subscribe to dev servers coming up inside the workspace (WebContainer
   * `server-ready`). No-op on backends without a runtime.
   */
  onServerReady(cb: (port: number, url: string) => void): void;
}

/** Directories never listed, read, snapshotted, or synced to Python. */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".next", "__pycache__"]);

const TEXT_EXT = new Set([
  "js", "mjs", "cjs", "jsx", "ts", "tsx", "json", "md", "txt", "css", "html",
  "htm", "svg", "py", "yml", "yaml", "toml", "xml", "csv", "env", "gitignore",
  "sh", "lock",
]);

export function isTextPath(path: string): boolean {
  const base = path.split("/").pop() ?? "";
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  return ext === "" || TEXT_EXT.has(ext);
}

export const MAX_FILE_BYTES = 400_000;

/** ANSI escape + cursor control stripper for shell output. */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;?]*[a-zA-Z]/g, "").replace(/\][^]*/g, "");
}

// ── Starter project ──────────────────────────────────────────────────────────

export const STARTER_FILES: Record<string, string> = {
  "README.md": `# Atlas workspace

A small Node.js project the Atlas Code agent can explore, modify, and run.

- \`npm start\` → runs index.js
- \`npm test\` → runs test.js (plain node asserts)

Python is also available via the agent's run_python tool (Pyodide).
`,
  "package.json": `{
  "name": "atlas-workspace",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node index.js",
    "test": "node test.js"
  }
}
`,
  "index.js": `import { mean, median } from "./lib/stats.js";

const samples = [4, 8, 15, 16, 23, 42];
console.log("samples:", samples.join(", "));
console.log("mean:", mean(samples));
console.log("median:", median(samples));
`,
  "lib/stats.js": `/** Arithmetic mean of a non-empty number array. */
export function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Median of a non-empty number array. */
export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
`,
  "test.js": `import assert from "node:assert";
import { mean, median } from "./lib/stats.js";

assert.equal(mean([2, 4, 6]), 4);
assert.equal(median([1, 2, 3]), 2);
assert.equal(median([1, 2, 3, 4]), 2.5);

console.log("all tests passed");
`,
};

// ── WebContainer backend ─────────────────────────────────────────────────────

type WC = import("@webcontainer/api").WebContainer;

/** Convert flat {path: content} into WebContainer's nested FileSystemTree. */
function toFsTree(files: Record<string, string>): any {
  const root: any = {};
  for (const [path, contents] of Object.entries(files)) {
    const parts = path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      node[parts[i]] ??= { directory: {} };
      node = node[parts[i]].directory;
    }
    node[parts[parts.length - 1]] = { file: { contents } };
  }
  return root;
}

class WebContainerWorkspace implements Workspace {
  readonly kind = "webcontainer" as const;
  private active: { kill: () => void } | null = null;

  constructor(private wc: WC) {}

  async listFiles(): Promise<FileEntry[]> {
    const out: FileEntry[] = [];
    const walk = async (dir: string) => {
      const entries = await this.wc.fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = dir === "/" ? `/${e.name}` : `${dir}/${e.name}`;
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) await walk(full);
        } else {
          let size = 0;
          try {
            const data = await this.wc.fs.readFile(full);
            size = data.byteLength;
          } catch {
            /* unreadable — list with size 0 */
          }
          out.push({ path: full.slice(1), size });
        }
      }
    };
    await walk("/");
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async readFile(path: string): Promise<string> {
    if (!isTextPath(path)) throw new Error(`${path} is not a text file`);
    return this.wc.fs.readFile(`/${path}`, "utf-8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (content.length > MAX_FILE_BYTES)
      throw new Error(`content too large (${content.length} chars, max ${MAX_FILE_BYTES})`);
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir) await this.wc.fs.mkdir(`/${dir}`, { recursive: true });
    await this.wc.fs.writeFile(`/${path}`, content);
  }

  async deleteFile(path: string): Promise<void> {
    await this.wc.fs.rm(`/${path}`);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.wc.fs.readFile(`/${path}`);
      return true;
    } catch {
      return false;
    }
  }

  async exec(
    command: string,
    onChunk?: (text: string) => void,
    timeoutMs = 60_000,
  ): Promise<ExecResult> {
    const proc = await this.wc.spawn("jsh", ["-c", command]);
    let output = "";
    let timedOut = false;
    this.active = { kill: () => proc.kill() };

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);

    proc.output
      .pipeTo(
        new WritableStream<string>({
          write: (data) => {
            const clean = stripAnsi(data);
            output += clean;
            onChunk?.(clean);
          },
        }),
      )
      .catch(() => {});

    const code = await proc.exit;
    clearTimeout(timer);
    this.active = null;
    return { code, output, timedOut };
  }

  killActive() {
    this.active?.kill();
    this.active = null;
  }

  onServerReady(cb: (port: number, url: string) => void) {
    this.wc.on("server-ready", (port, url) => cb(port, url));
  }
}

// ── In-memory fallback backend ───────────────────────────────────────────────

class MemoryWorkspace implements Workspace {
  readonly kind = "memory" as const;
  private files = new Map<string, string>(Object.entries(STARTER_FILES));

  async listFiles(): Promise<FileEntry[]> {
    return [...this.files.entries()]
      .map(([path, c]) => ({ path, size: c.length }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async readFile(path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`ENOENT: ${path} does not exist`);
    return f;
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (content.length > MAX_FILE_BYTES)
      throw new Error(`content too large (${content.length} chars, max ${MAX_FILE_BYTES})`);
    this.files.set(path, content);
  }

  async deleteFile(path: string): Promise<void> {
    if (!this.files.delete(path)) throw new Error(`ENOENT: ${path} does not exist`);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async exec(): Promise<ExecResult> {
    return {
      code: 127,
      output:
        "Shell unavailable: this browser session lacks cross-origin isolation, so the Node runtime (WebContainer) could not start. File tools and run_python still work.",
    };
  }

  killActive() {}

  onServerReady() {}
}

// ── Boot ─────────────────────────────────────────────────────────────────────

export interface WorkspaceBoot {
  workspace: Workspace;
  /** Human-readable note about the runtime that actually started. */
  note: string;
}

declare global {
  // Survives HMR + React strict-mode double effects: WebContainer.boot() may
  // only ever be called once per page.
  // eslint-disable-next-line no-var
  var __atlasWorkspace: Promise<WorkspaceBoot> | undefined;
}

async function bootInner(): Promise<WorkspaceBoot> {
  if (typeof window === "undefined")
    throw new Error("workspace is browser-only");

  if (!crossOriginIsolated) {
    return {
      workspace: new MemoryWorkspace(),
      note: "In-memory FS (no cross-origin isolation — reload /code directly to enable the Node runtime)",
    };
  }

  try {
    const { WebContainer } = await import("@webcontainer/api");
    const wc = await WebContainer.boot();
    await wc.mount(toFsTree(STARTER_FILES));
    return { workspace: new WebContainerWorkspace(wc), note: "Node (WebContainer) + jsh + Python (Pyodide)" };
  } catch (e) {
    console.warn("[code] WebContainer boot failed, using in-memory FS", e);
    return {
      workspace: new MemoryWorkspace(),
      note: `In-memory FS (WebContainer boot failed: ${(e as Error).message?.slice(0, 120)})`,
    };
  }
}

/** Boot (or reuse) the page-wide workspace singleton. */
export function getWorkspace(): Promise<WorkspaceBoot> {
  if (!globalThis.__atlasWorkspace) globalThis.__atlasWorkspace = bootInner();
  return globalThis.__atlasWorkspace;
}
