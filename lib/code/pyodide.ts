"use client";

// Python runtime for Atlas Code, via Pyodide loaded lazily from jsDelivr
// (which serves CORP/CORS headers, so it loads fine on the cross-origin
// isolated /code page). The interpreter is a singleton: globals persist
// across run_python calls within a session, like a REPL.
//
// The Pyodide FS is separate from the workspace. Before each run we one-way
// sync the workspace's text files into the interpreter's cwd so Python can
// `open("data.csv")` naturally. Files Python writes are NOT synced back —
// the tool description tells the model to use write_file for durable output.

import { isTextPath, type Workspace } from "./workspace";

const PYODIDE_VERSION = "0.26.4";
const INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

declare global {
  // eslint-disable-next-line no-var
  var __atlasPyodide: Promise<any> | undefined;
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.crossOrigin = "anonymous";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("failed to load Pyodide from CDN"));
    document.head.appendChild(s);
  });
}

async function loadInner(): Promise<any> {
  await injectScript(`${INDEX_URL}pyodide.js`);
  const loadPyodide = (window as any).loadPyodide;
  if (!loadPyodide) throw new Error("Pyodide loader missing after script load");
  return loadPyodide({ indexURL: INDEX_URL });
}

/** Load (or reuse) the page-wide Pyodide interpreter. */
export function getPyodide(): Promise<any> {
  if (!globalThis.__atlasPyodide) globalThis.__atlasPyodide = loadInner();
  return globalThis.__atlasPyodide;
}

export function isPyodideLoaded(): boolean {
  return !!globalThis.__atlasPyodide;
}

const MAX_SYNC_FILE = 200_000;
const MAX_OUTPUT = 16_000;

/** One-way sync: workspace text files → Pyodide FS (cwd /home/pyodide). */
async function syncFiles(py: any, workspace: Workspace) {
  const entries = await workspace.listFiles();
  for (const e of entries) {
    if (!isTextPath(e.path) || e.size > MAX_SYNC_FILE) continue;
    let content: string;
    try {
      content = await workspace.readFile(e.path);
    } catch {
      continue;
    }
    const full = `/home/pyodide/${e.path}`;
    const dir = full.split("/").slice(0, -1).join("/");
    try {
      py.FS.mkdirTree(dir);
      py.FS.writeFile(full, content);
    } catch {
      /* best-effort sync */
    }
  }
}

export interface PythonResult {
  output: string;
  error?: string;
}

/** Execute Python with captured stdout/stderr + the repr of a final expression. */
export async function runPython(
  code: string,
  workspace: Workspace | null,
): Promise<PythonResult> {
  const py = await getPyodide();
  if (workspace) await syncFiles(py, workspace);

  let out = "";
  const capture = (s: string) => {
    if (out.length < MAX_OUTPUT) out += s + "\n";
  };
  py.setStdout({ batched: capture });
  py.setStderr({ batched: capture });

  try {
    await py.loadPackagesFromImports(code).catch(() => {});
    const result = await py.runPythonAsync(code);
    if (result !== undefined && result !== null) {
      const repr = String(result);
      if (repr && repr !== "undefined") out += repr + "\n";
    }
    return { output: out.slice(0, MAX_OUTPUT) };
  } catch (e) {
    return { output: out.slice(0, MAX_OUTPUT), error: String(e).slice(0, 4000) };
  } finally {
    // Restore default handlers so unrelated logs don't get captured.
    py.setStdout();
    py.setStderr();
  }
}
