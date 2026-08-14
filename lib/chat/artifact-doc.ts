import {
  bundleModules,
  inlineHtmlAssets,
  isHtmlEntry,
  buildBundledDoc,
  type FileMap,
  type Transform,
} from "./artifact-bundle";
import {
  cspFor,
  isExecutable,
  optionalLibTags,
  withCsp,
  type Artifact,
  type ArtifactType,
} from "./artifact-sandbox";
import { entryPathOf } from "./workspace/mirror";

/**
 * The one place an artifact document is built.
 *
 * Doc construction used to live in the panel's effect, which was fine while the
 * panel was the only thing that rendered an artifact. It stopped being fine the
 * moment anything else needed to *run* one: a verifier that builds its own
 * document is not verifying what the user sees, it is verifying a plausible
 * lookalike, and every verdict it produces is fiction. So the panel and the
 * headless runner call this, and the only thing they are allowed to differ on is
 * the `head` they inject.
 *
 * Pure — no React, no DOM, Babel injected — so the fidelity claim above is a unit
 * test rather than a comment.
 */

export interface DocInput {
  /** Every file of the build, newest version of each, keyed by relative path. */
  files: FileMap;
  /** Which file to render. */
  entry: string;
  /** The entry's type, used to pick markup / module / wrapper handling. */
  artifact: Pick<Artifact, "type" | "code">;
  /** Absolute origin — an opaque-origin frame cannot resolve `'self'`. */
  origin: string;
  /** Markup injected right after the CSP: the error shim, storage, print. */
  head?: string;
  /**
   * Babel. Omitted only by callers that know the entry is not a module graph;
   * a module entry without it is an error rather than a silently empty doc.
   */
  transform?: Transform;
}

export type DocMode = "module" | "html" | "svg" | "none";

export interface DocResult {
  /** The full document, or "" when `errors` is non-empty. */
  doc: string;
  /** Fatal build problems. Non-empty means `doc` must not be run. */
  errors: string[];
  mode: DocMode;
}

/**
 * A single file, as a one-entry workspace.
 *
 * This is the whole fix for the single-file path. `buildReactDoc` rendered a lone
 * component by **deleting every `import … from` line** and hoping the names
 * resolved as globals. They did not: `import { Rocket } from "lucide-react"`
 * became a reference to an undeclared `Rocket`, and the page died with
 * "Rocket is not defined" — an error that read as the model's mistake and was
 * ours. Treating one file as a one-file project routes it through the same Babel
 * CommonJS transform and `require` registry that multi-file builds already use,
 * so imports resolve by the same rules whether a build has one file or ten.
 */
export function singleFileMap(entry: string, code: string): FileMap {
  return new Map([[entry, code]]);
}

/** A plausible filename for an artifact that never had one. */
function entryNameFor(type: ArtifactType): string {
  if (type === "html") return "index.html";
  if (type === "svg") return "image.svg";
  return "App.jsx";
}

/**
 * Whether this artifact's entry is a module graph, and so needs Babel.
 *
 * Exported because the caller has to answer it *before* calling
 * `buildArtifactDoc` — Babel is ~3MB and is imported on demand, so a chat that
 * only ever renders HTML pages should never pay for it. Two copies of this
 * predicate would drift, and the failure when they drift is bad in both
 * directions: markup handed to Babel dies with a syntax error nobody expects,
 * and a module graph without a transform does not build at all.
 */
export function needsTransform(
  entry: string,
  type: ArtifactType,
  fileCount: number,
): boolean {
  if (!isExecutable(type) || type === "svg") return false;
  if (isHtmlEntry(entry)) return false;
  if (type === "html" && fileCount <= 1) return false;
  return true;
}

/**
 * Build the document for one artifact, single-file or multi-file alike.
 *
 * Three shapes, decided by the entry rather than by the file count, because the
 * count does not tell you what kind of thing you have:
 *
 *  - **markup** (`.html`): the entry is a page. Its relative `<link>` and
 *    `<script src>` are inlined, because the frame is at an opaque origin with
 *    `connect-src 'none'` and has nothing to fetch them from. Feeding markup to
 *    Babel would try to parse it as JavaScript.
 *  - **module** (`.jsx`/`.tsx`/`.js`/`.ts`): a module graph, transformed and
 *    assembled.
 *  - **svg**: neither; wrapped in a centring document.
 */
export function buildArtifactDoc(input: DocInput): DocResult {
  const { files, entry, artifact, origin, head = "", transform } = input;

  if (!isExecutable(artifact.type)) return { doc: "", errors: [], mode: "none" };

  if (artifact.type === "svg") {
    return {
      doc: withCsp(
        `<!DOCTYPE html><html><head><style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#101112}</style></head><body>${artifact.code}</body></html>`,
        origin,
        head,
      ),
      errors: [],
      mode: "svg",
    };
  }

  if (isHtmlEntry(entry) || (artifact.type === "html" && files.size <= 1)) {
    // A lone HTML artifact has no siblings to inline, but it goes through the
    // same call so that gaining a sibling is not a change of code path.
    const { html, errors } = files.has(entry)
      ? inlineHtmlAssets(entry, files)
      : { html: artifact.code, errors: [] as string[] };
    if (errors.length) return { doc: "", errors, mode: "html" };
    return {
      doc: withCsp(html, origin, head + optionalLibTags(html, origin)),
      errors: [],
      mode: "html",
    };
  }

  if (!transform) {
    return {
      doc: "",
      errors: [`Cannot build "${entry}": no JavaScript transform was provided.`],
      mode: "module",
    };
  }

  const bundle = bundleModules(entry, files, transform);
  if (bundle.errors.length) return { doc: "", errors: bundle.errors, mode: "module" };

  return {
    doc: buildBundledDoc({
      bundle,
      origin,
      head,
      // Detection reads every file, not just the entry: a chart lives in the
      // component that draws it, and loading Recharts because only the entry
      // mentioned it would miss most real projects.
      detectSource: [...files.values()].join("\n"),
    }),
    errors: [],
    mode: "module",
  };
}

/** One file of a build, with its version history. Mirrors the panel's shape. */
export interface ArtifactFileLike {
  path: string;
  versions: { code: string; type: ArtifactType; complete?: boolean }[];
}

export interface VerifyTarget {
  files: FileMap;
  entry: string;
  artifact: { type: ArtifactType; code: string };
}

/**
 * What, if anything, is worth running from a set of artifact files.
 *
 * Returns `null` when there is nothing executable — a report, a deck, a diagram
 * or a snippet. Those render through the app's own trusted Markdown renderer and
 * have no runtime to fail in, so verifying them would be spending a frame to
 * learn nothing.
 *
 * Only the newest version of each file is considered. A build's history is per
 * file, and mixing version 3 of one file with version 1 of another would produce
 * a combination that never existed.
 */
export function verifyEntryOf(files: ArtifactFileLike[]): VerifyTarget | null {
  const latest = new Map<string, { code: string; type: ArtifactType; complete?: boolean }>();
  for (const f of files) {
    const v = f.versions[f.versions.length - 1];
    if (v) latest.set(f.path, v);
  }
  if (latest.size === 0) return null;

  // A half-written fence is not a failure to report — it is a response still
  // arriving, or one the provider truncated. Either way the code is a fragment
  // and running it would manufacture errors the model did not make.
  for (const v of latest.values()) if (v.complete === false) return null;

  const runnable = [...latest.entries()].filter(([, v]) => isExecutable(v.type));
  if (runnable.length === 0) return null;

  const entry = entryPathOf(runnable.map(([p]) => p));
  if (!entry) return null;
  const artifact = latest.get(entry);
  if (!artifact) return null;

  // The map keeps every file, not just the runnable ones: a page imports its
  // stylesheet, and a component tree reaches modules that are not entries.
  return {
    files: new Map([...latest].map(([p, v]) => [p, v.code])),
    entry,
    artifact: { type: artifact.type, code: artifact.code },
  };
}

/**
 * A verify target for a single artifact that has no path of its own.
 *
 * The unnamed artifact — one fence, no `path=` — predates multi-file builds and
 * is still the common case in ordinary chat.
 */
export function verifyTargetOf(artifact: Artifact): VerifyTarget | null {
  if (!isExecutable(artifact.type) || artifact.complete === false) return null;
  const entry = artifact.path || entryNameFor(artifact.type);
  return {
    files: singleFileMap(entry, artifact.code),
    entry,
    artifact: { type: artifact.type, code: artifact.code },
  };
}

/** Re-exported so callers building a doc do not also need the sandbox module. */
export { cspFor, isExecutable };
