"use client";

/**
 * Pyodide as chat's execution runtime.
 *
 * Reuses `lib/code/pyodide.ts`'s interpreter singleton — one 10MB download and
 * one WASM instance for the whole tab, whichever page asked for it first — but
 * not its sync policy. Atlas Code syncs one way on purpose: there the durable
 * output is whatever the agent then writes with `write_file`. In chat the file
 * Python produced *is* the deliverable, so this mounts, runs, and writes back
 * whatever changed.
 *
 * The interpreter is a REPL: globals persist between calls within a session, so
 * a model can load a dataframe in one round and chart it in the next without
 * re-reading the CSV. That is deliberate, and it is why the working directory is
 * cleaned between runs rather than the interpreter being torn down.
 */

import { getPyodide } from "@/lib/code/pyodide";
import {
  diffMount,
  hashContent,
  isBinaryPath,
  planExport,
  describeSkipped,
  type MountEntry,
} from "./mount";
import { UNAVAILABLE_RUNTIME, type ExecFile, type ExecRuntime } from "./runtime";

/**
 * Where the mount lands.
 *
 * Deliberately NOT `/home/pyodide`. The interpreter is a page-wide singleton
 * shared with Atlas Code, whose own `syncFiles` writes the code workspace into
 * that directory — and `clearTree` below unlinks everything in the mount before
 * every run. Sharing the path meant chat could delete a `/code` user's synced
 * files. A separate directory makes that impossible rather than merely unlikely.
 */
const CWD = "/atlas-chat";

const MAX_OUTPUT = 24_000;
/** Files bigger than this are not mounted; the model is told which. */
const MAX_MOUNT_FILE_BYTES = 2 * 1024 * 1024;

/** Packages that ship with Pyodide and never need micropip. */
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

/** Read the interpreter's working directory back as a listing. */
function readTree(py: any, dir = CWD, base = ""): MountEntry[] {
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
      // Pyodide keeps its own machinery under cwd; walking into it would mount
      // the standard library into the user's workspace.
      if (name.startsWith(".") || name === "__pycache__") continue;
      out.push(...readTree(py, full, rel));
      continue;
    }
    if (name.startsWith(".")) continue;
    // Hashing text is enough to detect a rewrite. Binary files are fingerprinted
    // by length *and* mtime instead of being decoded — decoding a .xlsx to UTF-8
    // just to hash it would be expensive and lossy. Size alone was not enough:
    // a script regenerating a spreadsheet with a corrected number produces the
    // same byte length, and that file was silently never exported.
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

/** Remove everything the previous run left, so each call starts from the mount. */
function clearTree(py: any) {
  for (const entry of readTree(py)) {
    try {
      py.FS.unlink(`${CWD}/${entry.path}`);
    } catch {
      /* best effort; a file we cannot remove simply persists into the next run */
    }
  }
}

function writeInto(py: any, file: ExecFile) {
  const full = `${CWD}/${file.path}`;
  const dir = full.split("/").slice(0, -1).join("/");
  try {
    if (dir && dir !== CWD) py.FS.mkdirTree(dir);
    py.FS.writeFile(full, file.bytes ?? (file.text ?? ""));
  } catch {
    /* a file that will not mount is reported by its absence, not by a throw */
  }
}

/**
 * Install packages the script asked for.
 *
 * Two paths, because they cost very different things. `loadPackagesFromImports`
 * covers everything Pyodide ships with and is a local WASM load; micropip
 * reaches PyPI over the network, which is how `python-docx` and `reportlab`
 * become available and also why it is only used for names the model named.
 */
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
    // Pushed inside the `try`, not after it. This used to report success
    // unconditionally, so the model was told "Installed: openpyxl" immediately
    // before a `ModuleNotFoundError` it had no way to explain.
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

/**
 * The runtime for this environment.
 *
 * Returns `UNAVAILABLE_RUNTIME` when there is no document to inject the loader
 * script into — server rendering, or a worker. Without this the `kind` was a
 * constant `"pyodide"`, so `run_python`'s `kind === "unavailable"` guard could
 * never fire and the honest refusal it was written for was unreachable code.
 *
 * A *boot* failure is not knowable synchronously — the download happens on first
 * use — so `runPython` catches that separately and returns the same payload.
 * Both paths give the model the same sentence.
 */
export function createPyodideRuntime(): ExecRuntime {
  if (typeof document === "undefined") return UNAVAILABLE_RUNTIME;
  return {
    kind: "pyodide",

    async runPython(code, mount, opts) {
      let py: any;
      try {
        py = await getPyodide();
      } catch {
        return UNAVAILABLE_RUNTIME.runPython(code, mount, opts);
      }

      // Chat's own directory, and Python's working directory for the run — so
      // `open("data.csv")` finds the mounted file without the model having to
      // know where it landed.
      try {
        py.FS.mkdirTree(CWD);
        py.FS.chdir(CWD);
      } catch {
        /* an existing directory is the normal case after the first run */
      }

      // Each call starts from the mount rather than from whatever the last one
      // left lying around. The interpreter's *globals* persist — that is what
      // makes it a REPL — but a stale file from three rounds ago masquerading as
      // this run's output would be read back into the workspace as a change.
      clearTree(py);
      const skippedMounts: string[] = [];
      for (const f of mount) {
        const size = f.bytes?.byteLength ?? (f.text?.length ?? 0);
        if (size > MAX_MOUNT_FILE_BYTES) {
          skippedMounts.push(f.path);
          continue;
        }
        writeInto(py, f);
      }
      const before = readTree(py);

      let out = "";
      const capture = (s: string) => {
        if (out.length >= MAX_OUTPUT) return;
        out += s + "\n";
        opts?.onChunk?.(s + "\n");
      };
      py.setStdout({ batched: capture });
      py.setStderr({ batched: capture });

      let error: string | undefined;
      let installed: string[] = [];
      let failedInstalls: string[] = [];
      try {
        const packages = await install(py, code, opts?.install ?? []);
        installed = packages.installed;
        failedInstalls = packages.failed;
        if (opts?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const result = await py.runPythonAsync(code);
        // The repr of a trailing expression, so `df.head()` prints like a REPL.
        if (result !== undefined && result !== null) {
          const repr = String(result);
          if (repr && repr !== "undefined") capture(repr);
        }
      } catch (e) {
        // An abort is the user pressing Stop; it must propagate rather than
        // becoming a result the model then reasons about.
        if ((e as Error).name === "AbortError") {
          py.setStdout();
          py.setStderr();
          throw e;
        }
        error = String(e).slice(0, 6000);
      } finally {
        py.setStdout();
        py.setStderr();
      }

      const after = readTree(py);
      const { created, modified } = diffMount(before, after);
      const plan = planExport([...created, ...modified], after);

      const files: ExecFile[] = [];
      for (const path of plan.paths) {
        const full = `${CWD}/${path}`;
        try {
          if (isBinaryPath(path)) {
            files.push({ path, bytes: py.FS.readFile(full) as Uint8Array });
          } else {
            files.push({ path, text: py.FS.readFile(full, { encoding: "utf8" }) as string });
          }
        } catch {
          /* unreadable after the run; reported by its absence from `files` */
        }
      }

      const notes = [describeSkipped(plan.skipped)];
      if (skippedMounts.length) {
        notes.push(
          `Not mounted (too large): ${skippedMounts.join(", ")}.`,
        );
      }
      // Said explicitly rather than left for the model to infer from a
      // `ModuleNotFoundError` it cannot explain.
      if (failedInstalls.length) {
        notes.push(`Could not install: ${failedInstalls.join(", ")}.`);
      }

      return {
        output: out.slice(0, MAX_OUTPUT),
        error,
        files,
        skippedNote: notes.filter(Boolean).join(" "),
        installed,
      };
    },

    dispose() {
      // Deliberately not tearing down the interpreter. It is shared with Atlas
      // Code and page-wide by design; disposing it here would make the next run
      // — on either page — pay the 10MB download again.
    },
  };
}
