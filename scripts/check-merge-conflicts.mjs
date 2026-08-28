// Fails fast when the working tree still contains unresolved conflict markers.
//
// Why this exists: an interrupted `git merge`, `git rebase` or `git stash pop`
// leaves `<<<<<<<` / `=======` / `>>>>>>>` lines in the file. Nothing in the
// toolchain treats that as a special case — SWC just hits a token it cannot
// parse and reports a *syntax error*, once per compile pass, with the marker
// lines quoted back as if they were code. The real cause (a merge you never
// finished) is nowhere in that output, and the wall of errors buries the one
// fact that matters: which file, and how to fix it.
//
// Running this from `predev`/`prebuild` turns a 200-line parser dump into one
// actionable message before the dev server ever starts.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Built by repetition rather than written literally, so this file does not
// contain the very markers it searches for — otherwise the guard would flag
// itself, and so would every `git grep` a developer runs for them.
const OURS = "<".repeat(7);
const SEP = "=".repeat(7);
const THEIRS = ">".repeat(7);

// `<<<<<<<` and `>>>>>>>` at the start of a line are the reliable signal: they
// are not valid in any language this repo uses, and a scan of all 941 tracked
// files finds zero legitimate occurrences.
//
// A bare `=======` line is deliberately NOT a trigger on its own — it is a
// valid Markdown h1 underline. It is only reported once a file has already
// been flagged by one of the other two, which is why the separator shows up in
// the output but never causes a failure by itself.
const TRIGGERS = [OURS, THEIRS];

// Extensions where a marker breaks the build outright. Anything else (docs,
// CI config) is reported as a warning: still an unfinished merge worth
// resolving, but not a reason to refuse to start the dev server.
const BLOCKING = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".css", ".scss", ".html",
]);

// Text formats worth reading at all. Skips images, fonts and lockfile-sized
// binaries without needing to sniff their contents.
const SCANNED = new Set([
  ...BLOCKING,
  ".md", ".mdx", ".yml", ".yaml", ".svg", ".txt", ".sql", ".toml",
]);

function trackedFiles() {
  try {
    // `git ls-files` honours .gitignore for free, so node_modules, .next and
    // every build cache are excluded without maintaining a second ignore list.
    const out = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    return out.split("\0").filter(Boolean);
  } catch {
    // Not a git checkout (a tarball export, a Docker build context). The guard
    // is a convenience, not a gate — never block a build over its absence.
    return null;
  }
}

const files = trackedFiles();
if (files === null) {
  process.exit(0);
}

/** @type {{ file: string, line: number, text: string, blocking: boolean }[]} */
const hits = [];

for (const file of files) {
  if (!SCANNED.has(extname(file).toLowerCase())) continue;

  let content;
  try {
    content = readFileSync(resolve(root, file), "utf8");
  } catch {
    // Tracked but absent from the working tree (a staged deletion), or not
    // decodable as UTF-8. Neither is this script's problem.
    continue;
  }

  // Cheap pre-filter: skip the line-by-line walk for the ~99.9% of files that
  // cannot possibly match.
  if (!TRIGGERS.some((t) => content.includes(t))) continue;

  const blocking = BLOCKING.has(extname(file).toLowerCase());
  const lines = content.split(/\r?\n/);
  lines.forEach((text, i) => {
    const isTrigger = TRIGGERS.some((t) => text.startsWith(t));
    const isSep = text.trimEnd() === SEP;
    if (isTrigger || isSep) {
      hits.push({ file, line: i + 1, text: text.trimEnd(), blocking });
    }
  });
}

if (hits.length === 0) {
  process.exit(0);
}

const blockingHits = hits.filter((h) => h.blocking);
const affected = [...new Set(hits.map((h) => h.file))];
const label = affected.length === 1 ? "file" : "files";

const stream = blockingHits.length > 0 ? console.error : console.warn;
const mark = blockingHits.length > 0 ? "✖" : "⚠";

stream(
  `\n${mark} Unresolved merge conflict markers in ${affected.length} ${label}:\n`,
);
for (const h of hits) {
  stream(`    ${h.file}:${h.line}  ${h.text}`);
}

stream(`
  These are left behind by an interrupted \`git merge\`, \`git rebase\`, or
  \`git stash pop\` — the "Updated upstream / Stashed changes" wording comes
  from a stash pop specifically. The merge was started but never finished, so
  both sides are still sitting in the file.

  To resolve, pick one:

    • Discard the local side and take the committed version:
        git checkout HEAD -- ${affected[0]}

    • Or edit the file and delete the ${OURS} / ${SEP} / ${THEIRS} lines,
      keeping whichever side you want to survive.

  A conflicted \`git stash pop\` does NOT drop the stash — your work is still
  there. Check it with \`git stash list\` before discarding anything.
`);

if (blockingHits.length > 0) {
  stream(
    "  Refusing to start: the compiler cannot parse these files.\n",
  );
  process.exit(1);
}
process.exit(0);
