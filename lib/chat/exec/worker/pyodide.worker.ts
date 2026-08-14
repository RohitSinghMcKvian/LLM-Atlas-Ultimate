/// <reference lib="webworker" />

/**
 * Python, off the main thread.
 *
 * The reason this file exists is Stop. `runPythonAsync` is synchronous WASM, so
 * on the main thread an abort signal is checked once and then the thread is gone
 * until the script finishes — pressing Stop during `while True:` did nothing, and
 * a thirty-second pandas job froze the composer, the elapsed clock and the
 * streaming flush along with it. Pyodide's own interrupt needs `SharedArrayBuffer`,
 * which needs cross-origin isolation, which `lib/chat/exec/runtime.ts` rules out
 * in writing because COEP on `/chat` is inherited by every artifact iframe. That
 * leaves `worker.terminate()` as the only mechanism that can actually stop a
 * running script — and terminate needs a worker.
 *
 * It also ends the shared-interpreter problem: `/code` keeps its main-thread
 * singleton at `/home/pyodide`, chat gets its own here, and neither can clear
 * the other's files.
 *
 * The FS walk below is the same code as `lib/chat/exec/pyodide-runtime.ts`. The
 * pure half — `diffMount`, `planExport`, `hashContent` — is imported rather than
 * duplicated, so the two runtimes cannot disagree about what changed.
 */

import {
  diffMount,
  hashContent,
  isBinaryPath,
  planExport,
  describeSkipped,
  type MountEntry,
} from "../mount";
import type { WorkerFile, WorkerRequest, WorkerResponse } from "./protocol";

const PYODIDE_VERSION = "0.26.4";
const INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

const MAX_OUTPUT = 24_000;
const MAX_MOUNT_FILE_BYTES = 2 * 1024 * 1024;

const BUILTIN = new Set([
  "numpy",
  "pandas",
  "matplotlib",
  "scipy",
  "scikit-learn",
  "sympy",
  "pillow",
  "openpyxl",
  "lxml",
  "beautifulsoup4",
  "regex",
  "pyyaml",
]);

declare const self: DedicatedWorkerGlobalScope & {
  loadPyodide?: (opts: { indexURL: string }) => Promise<any>;
  importScripts: (src: string) => void;
};

let pyPromise: Promise<any> | null = null;

function loadPyodide(): Promise<any> {
  if (!pyPromise) {
    pyPromise = (async () => {
      self.importScripts(`${INDEX_URL}pyodide.js`);
      if (!self.loadPyodide) throw new Error("Pyodide loader missing after importScripts");
      return self.loadPyodide({ indexURL: INDEX_URL });
    })().catch((e) => {
      // Not memoised on failure: a transient CDN blip must not disable Python
      // for the life of the worker.
      pyPromise = null;
      throw e;
    });
  }
  return pyPromise;
}

function post(msg: WorkerResponse) {
  self.postMessage(msg);
}

// ── Filesystem ───────────────────────────────────────────────────────────────

function readTree(py: any, cwd: string, dir = cwd, base = ""): MountEntry[] {
  const out: MountEntry[] = [];
  let names: string[];
  try {
    names = py.FS.readdir(dir).filter((n: string) => n !== "." && n !== "..");
  } catch {
    return out;
  }
  for (const name of names) {
    const full = `${dir}/${name}`;
    const rel = base ? `${base}/${name}` : name;
    let stat: { mode: number; size: number; mtime?: Date | number };
    try {
      stat = py.FS.stat(full);
    } catch {
      continue;
    }
    if (py.FS.isDir(stat.mode)) {
      if (name.startsWith(".") || name === "__pycache__") continue;
      out.push(...readTree(py, cwd, full, rel));
      continue;
    }
    if (name.startsWith(".")) continue;
    if (isBinaryPath(rel)) {
      const mtime = stat.mtime ? Number(stat.mtime) : 0;
      out.push({ path: rel, size: stat.size, hash: `b:${stat.size}:${mtime}` });
      continue;
    }
    let text = "";
    try {
      text = py.FS.readFile(full, { encoding: "utf8" }) as string;
    } catch {
      out.push({ path: rel, size: stat.size, hash: `x:${stat.size}` });
      continue;
    }
    out.push({ path: rel, text, size: stat.size, hash: hashContent(text) });
  }
  return out;
}

function clearTree(py: any, cwd: string) {
  for (const entry of readTree(py, cwd)) {
    try {
      py.FS.unlink(`${cwd}/${entry.path}`);
    } catch {
      /* best effort */
    }
  }
}

function writeInto(py: any, cwd: string, file: WorkerFile) {
  const full = `${cwd}/${file.path}`;
  const dir = full.split("/").slice(0, -1).join("/");
  try {
    if (dir && dir !== cwd) py.FS.mkdirTree(dir);
    py.FS.writeFile(full, file.bytes ?? (file.text ?? ""));
  } catch {
    /* a file that will not mount is reported by its absence */
  }
}

async function install(
  py: any,
  code: string,
  requested: string[],
): Promise<{ installed: string[]; failed: string[] }> {
  const installed: string[] = [];
  const failed: string[] = [];
  await py.loadPackagesFromImports(code).catch(() => {});

  const viaMicropip = requested.filter((p) => !BUILTIN.has(p.toLowerCase()));
  const builtin = requested.filter((p) => BUILTIN.has(p.toLowerCase()));
  if (builtin.length) {
    try {
      await py.loadPackage(builtin);
      installed.push(...builtin);
    } catch {
      failed.push(...builtin);
    }
  }
  if (viaMicropip.length) {
    try {
      await py.loadPackage("micropip");
      const micropip = py.pyimport("micropip");
      await micropip.install(viaMicropip);
      installed.push(...viaMicropip);
    } catch {
      failed.push(...viaMicropip);
    }
  }
  return { installed, failed };
}

// ── Run ──────────────────────────────────────────────────────────────────────

async function run(req: Extract<WorkerRequest, { type: "run" }>) {
  const { runId, code, mount, cwd } = req;
  let py: any;
  try {
    py = await loadPyodide();
  } catch (e) {
    post({ type: "failed", runId, message: (e as Error).message });
    return;
  }

  try {
    py.FS.mkdirTree(cwd);
    py.FS.chdir(cwd);
  } catch {
    /* already present after the first run */
  }

  clearTree(py, cwd);
  const skippedMounts: string[] = [];
  for (const f of mount) {
    const size = f.bytes?.byteLength ?? (f.text?.length ?? 0);
    if (size > MAX_MOUNT_FILE_BYTES) {
      skippedMounts.push(f.path);
      continue;
    }
    writeInto(py, cwd, f);
  }
  const before = readTree(py, cwd);

  let out = "";
  const capture = (s: string) => {
    if (out.length >= MAX_OUTPUT) return;
    out += s + "\n";
    // Streamed as it happens. On the main thread this arrived in one lump when
    // the script finished, because nothing else could run until then.
    post({ type: "chunk", runId, text: s + "\n" });
  };
  py.setStdout({ batched: capture });
  py.setStderr({ batched: capture });

  let error: string | undefined;
  let installed: string[] = [];
  let failedInstalls: string[] = [];
  try {
    const packages = await install(py, code, req.install ?? []);
    installed = packages.installed;
    failedInstalls = packages.failed;
    const result = await py.runPythonAsync(code);
    if (result !== undefined && result !== null) {
      const repr = String(result);
      if (repr && repr !== "undefined") capture(repr);
    }
  } catch (e) {
    error = String(e).slice(0, 6000);
  } finally {
    py.setStdout();
    py.setStderr();
  }

  const after = readTree(py, cwd);
  const { created, modified } = diffMount(before, after);
  const plan = planExport([...created, ...modified], after);

  const files: WorkerFile[] = [];
  for (const path of plan.paths) {
    const full = `${cwd}/${path}`;
    try {
      if (isBinaryPath(path)) {
        files.push({ path, bytes: py.FS.readFile(full) as Uint8Array });
      } else {
        files.push({ path, text: py.FS.readFile(full, { encoding: "utf8" }) as string });
      }
    } catch {
      /* unreadable after the run; reported by its absence */
    }
  }

  const notes = [describeSkipped(plan.skipped)];
  if (skippedMounts.length) notes.push(`Not mounted (too large): ${skippedMounts.join(", ")}.`);
  if (failedInstalls.length) notes.push(`Could not install: ${failedInstalls.join(", ")}.`);

  post({
    type: "done",
    runId,
    output: out.slice(0, MAX_OUTPUT),
    error,
    files,
    skippedNote: notes.filter(Boolean).join(" "),
    installed,
  });
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (!req || typeof req !== "object") return;
  if (req.type === "boot") {
    void loadPyodide().then(
      () => post({ type: "ready", runId: req.runId }),
      (err: Error) => post({ type: "failed", runId: req.runId, message: err.message }),
    );
    return;
  }
  if (req.type === "run") {
    void run(req).catch((err: Error) =>
      post({ type: "failed", runId: req.runId, message: err.message }),
    );
  }
};

export {};
