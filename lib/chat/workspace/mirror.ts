import type { ArtifactType } from "../artifact-sandbox";
import { toRelativePath } from "./fs";
import type { WorkspaceFile } from "./types";

/**
 * Making a workspace file show up as an artifact.
 *
 * This closes a gap that made build mode useless on its own. The workspace and
 * the artifact panel had no connection: `recordVersion` was called from exactly
 * three places — the fence backfill, the `artifact` tool's patch path, and the
 * post-turn scan of the reply text — and none of them knew about the
 * filesystem. So a model that followed the BUILD instructions to the letter,
 * writing every deliverable through `workspace.create`, produced files that
 * appeared in the workspace strip and **rendered nothing at all**. The panel had
 * no artifact to show.
 *
 * The fix is to treat the workspace as the source of truth for a build and
 * mirror it: every file becomes an artifact keyed by its relative path, which is
 * the same identity the fence path already produces. That gets version history,
 * revert, the file switcher and the bundler for free, because all of them are
 * already keyed that way.
 *
 * Pure classification here; the write itself is injected, so this is testable
 * without IndexedDB.
 */

/**
 * What a file renders as, from its extension.
 *
 * The two prose kinds are why this is not just a lookup. `document` and `slides`
 * are the paginated, printable kinds P11 added, and they are what a research
 * report and a deck have to become — a deck rendered as ordinary markdown is a
 * long scrolling page, not slides. Markdown alone cannot say which one it is, so
 * a deck is named `*.slides.md` and everything else `.md`. That convention is
 * stated in the BUILD prompt; a model that ignores it gets a document, which is
 * the safe direction to be wrong in.
 */
export function kindForPath(path: string): ArtifactType {
  const lower = path.toLowerCase();
  if (lower.endsWith(".slides.md") || lower.endsWith(".deck.md")) return "slides";

  const ext = lower.slice(lower.lastIndexOf(".") + 1);
  switch (ext) {
    case "html":
    case "htm":
      return "html";
    case "jsx":
    case "tsx":
      return "react";
    case "svg":
      return "svg";
    case "mmd":
    case "mermaid":
      return "mermaid";
    case "md":
    case "markdown":
      // `document`, not `markdown`: in a build a .md file is a deliverable, so
      // it should paginate and print rather than render as a transcript block.
      return "document";
    default:
      // CSS, JS, TS, JSON and everything else. Not renderable alone, but still a
      // file of the build: the switcher lists it and the bundler resolves it.
      return "code";
  }
}

/** The `lang` a code view should highlight with. */
export function langForPath(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (!ext || ext === path.toLowerCase()) return "text";
  return ext === "htm" ? "html" : ext;
}

/**
 * Which file a multi-file build should open on.
 *
 * An entry point, not just the first alphabetically: opening a build on
 * `app.css` because it sorts first would bury the thing the user asked for.
 */
export function entryPathOf(paths: string[]): string | null {
  if (paths.length === 0) return null;
  const byPreference = [
    (p: string) => p === "index.html",
    (p: string) => p === "index.jsx" || p === "index.tsx",
    (p: string) => p === "App.jsx" || p === "App.tsx",
    (p: string) => p.endsWith(".html"),
    (p: string) => p.endsWith(".jsx") || p.endsWith(".tsx"),
    (p: string) => p.endsWith(".md"),
  ];
  // A deck or a report is usually the only deliverable, so it wins over a
  // stylesheet but loses to a page that would link to it.
  for (const match of byPreference) {
    const hit = paths.find(match);
    if (hit) return hit;
  }
  return paths[0];
}

export interface MirrorInput {
  path: string;
  kind: ArtifactType;
  lang: string;
  title: string;
  code: string;
}

/**
 * Turn workspace files into artifact writes.
 *
 * Empty files are skipped: a `create` with no body yet is a placeholder, and
 * recording it would put a blank version in the history the user can revert to.
 */
export function mirrorInputs(files: WorkspaceFile[]): MirrorInput[] {
  const out: MirrorInput[] = [];
  for (const f of files) {
    if (!f.content.trim()) continue;
    const path = toRelativePath(f.path);
    out.push({
      path,
      kind: kindForPath(path),
      lang: langForPath(path),
      title: path,
      code: f.content,
    });
  }
  return out;
}
