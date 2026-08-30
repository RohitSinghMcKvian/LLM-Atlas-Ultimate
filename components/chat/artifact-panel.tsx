"use client";

import * as React from "react";
import {
  X,
  Code2,
  Eye,
  Copy,
  Check,
  Download,
  ExternalLink,
  GitCompareArrows,
  ChevronLeft,
  ChevronRight,
  Wand2,
  Undo2,
  AlertTriangle,
  FileWarning,
  Printer,
  Monitor,
  Tablet,
  Smartphone,
  FolderDown,
  CopyPlus,
} from "lucide-react";
import { Markdown } from "@/components/markdown";
import { MermaidBlock } from "@/components/mermaid";
import { DiffViewer } from "@/components/diff-viewer";
import { DocumentView, SlidesView } from "@/components/chat/document-view";
import { cn } from "@/lib/utils";
import {
  attachArtifactBridge,
  attachArtifactErrorListener,
  errorClientScript,
  storageClientScript,
} from "@/lib/chat/artifact-bridge";
import { fileSlug } from "@/lib/chat/document";
import { useInlinedRuntime } from "./use-inlined-runtime";
import { printClientScript, printRenderedNode, requestFramePrint } from "@/lib/chat/print";
import {
  ARTIFACT_PREVIEW_KEY,
  ARTIFACT_SANDBOX,
  docFor,
  isExecutable,
  isProse,
  optionalLibTags,
  printModeFor,
  withCsp,
  type Artifact,
  type ArtifactType,
} from "@/lib/chat/artifact-sandbox";

// The sandbox/CSP rules and the fence scanner both live in lib/ so they can be
// unit tested; re-exported here so existing importers of this module keep
// working.
export {
  ARTIFACT_PREVIEW_KEY,
  ARTIFACT_SANDBOX,
  docFor,
  isExecutable,
  type Artifact,
  type ArtifactType,
};
export { extractArtifact, stripArtifactBlock } from "@/lib/chat/artifact-extract";

const EXT: Record<ArtifactType, string> = {
  html: "html",
  svg: "svg",
  markdown: "md",
  code: "txt",
  mermaid: "mmd",
  react: "jsx",
  document: "md",
  slides: "md",
};

/** One iframe reload per this many ms while the code is still streaming in. */
const STREAM_RELOAD_MS = 400;

/**
 * Preview widths.
 *
 * This is what "build me a mobile app" resolves to: a real multi-screen React
 * app, shown at phone width with device chrome. The alternative — emitting React
 * Native source nothing in a browser can run — would look more like a mobile app
 * and be less of one, because the user could never see it work.
 */
const VIEWPORTS = {
  desktop: { label: "Desktop", width: "100%", icon: Monitor },
  tablet: { label: "Tablet", width: 768, icon: Tablet },
  phone: { label: "Phone", width: 390, icon: Smartphone },
} as const;

type ViewportId = keyof typeof VIEWPORTS;

/**
 * One file of a build, with its own version history.
 *
 * The panel used to take a flat `versions: Artifact[]` — a single evolving
 * document. A build has several files, and each has its own history, so the
 * shape gains one dimension: pick a file, then scrub its versions.
 */
export interface ArtifactFile {
  path: string;
  versions: Artifact[];
}

export function ArtifactPanel({
  files,
  selectedPath,
  onSelectPath,
  onClose,
  onEdit,
  artifactId,
  onRevert,
  onFix,
  onErrors,
  onRemix,
  embedded = false,
}: {
  /** Every file in the build. One entry is the ordinary single-artifact case. */
  files: ArtifactFile[];
  selectedPath?: string | null;
  onSelectPath?: (path: string) => void;
  onClose: () => void;
  onEdit?: (instruction: string) => void;
  /** Namespace for `window.storage`. Omitted ⇒ the shim is not injected. */
  artifactId?: string | null;
  /** Make an earlier version current. Receives a 1-based version number. */
  onRevert?: (versionNumber: number) => void;
  /** Ask the model to fix the errors the running artifact reported. */
  onFix?: (errors: string[]) => void;
  /**
   * Copy the whole build into a fresh conversation and switch to it.
   *
   * Takes no argument: a remix is of the build, not of the file on screen.
   * Splitting one file out of a build would leave its imports dangling, and the
   * thing the user is looking at is the build.
   */
  onRemix?: () => void;
  /** Report the current error set, so the transcript's card can show a count. */
  onErrors?: (errors: string[]) => void;
  /**
   * Rendered inside the shared rail rather than as its own panel.
   *
   * Drops the left border and the Close button, both of which the rail already
   * provides — two close buttons in one header, one of which closes the whole
   * rail and one of which closes a tab inside it, is a coin toss.
   */
  embedded?: boolean;
}) {
  const active =
    files.find((f) => f.path === selectedPath) ?? files[files.length - 1] ?? { path: "", versions: [] };
  const versions = active.versions;
  const [idx, setIdx] = React.useState(versions.length - 1);
  const [tab, setTab] = React.useState<"preview" | "code" | "diff">("preview");
  const [copied, setCopied] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [editText, setEditText] = React.useState("");
  const [errors, setErrors] = React.useState<string[]>([]);
  const [viewport, setViewport] = React.useState<ViewportId>("desktop");

  // The CSP and the runtime <script> tags need an absolute origin, because the
  // frame is opaque-origin and cannot resolve `'self'` or a root-relative path
  // back to Atlas. Resolved after mount so SSR and hydration agree on the empty
  // string, and the iframe is held back until it is known.
  const [origin, setOrigin] = React.useState("");
  React.useEffect(() => setOrigin(window.location.origin), []);

  // Follow the latest version as new ones stream in. Keyed on the path too, so
  // switching files lands on that file's newest version rather than carrying
  // the previous file's scrub position across.
  const lastKey = React.useRef(`${active.path}:${versions.length}`);
  React.useEffect(() => {
    const key = `${active.path}:${versions.length}`;
    if (key !== lastKey.current) {
      setIdx(versions.length - 1);
      lastKey.current = key;
    }
  }, [active.path, versions.length]);

  // A fallback rather than an early return: hooks follow, so bailing out here
  // would change the hook order between renders. The panel is only mounted when
  // there is something to show, so this is a guard, not a state to design for.
  const artifact: Artifact = versions[Math.min(Math.max(idx, 0), versions.length - 1)] ?? {
    type: "code",
    lang: "text",
    code: "",
    title: active.path || "Artifact",
  };
  // Two different senses of "preview", kept apart since prose artifacts arrived:
  // `canRun` is "needs a sandboxed frame", `canPreview` is "has something better
  // to show than its own source".
  const canRun = isExecutable(artifact.type);
  const canPreview = canRun || isProse(artifact.type) || artifact.type === "mermaid";
  const prev = idx > 0 ? versions[idx - 1] : null;
  const streaming = artifact.complete === false;

  const headScript =
    (artifactId ? storageClientScript() : "") + errorClientScript() + printClientScript();

  /**
   * The finished artifact is built by the shared builder; a still-streaming one
   * keeps the cheap synchronous path.
   *
   * Both single- and multi-file artifacts now go through `buildArtifactDoc`, so
   * a lone `.jsx` component resolves its imports by exactly the same rules a
   * ten-file project does. That is the fix for "Rocket is not defined": the old
   * single-file path deleted every import line and left the names undeclared.
   *
   * Streaming is excluded rather than throttled. Half-written code is a syntax
   * error by definition, so bundling it would replace the live preview with a
   * build failure on every flush; `docFor` renders the fragment as far as it
   * parses, which is what makes a streaming preview worth showing at all.
   */
  const canBuild = canRun && !streaming;
  const [built, setBuilt] = React.useState<{
    doc: string;
    errors: string[];
    warnings: string[];
  } | null>(null);

  React.useEffect(() => {
    if (!canBuild || !origin) {
      setBuilt(null);
      return;
    }
    let alive = true;
    void (async () => {
      const mod = await import("@/lib/chat/artifact-doc");
      if (!alive) return;

      const map =
        files.length > 1
          ? new Map(files.map((f) => [f.path, f.versions[f.versions.length - 1]?.code ?? ""]))
          : mod.singleFileMap(active.path, artifact.code);

      // Babel is ~3MB and imported on demand, so a conversation that only ever
      // renders HTML pages never downloads it. `needsTransform` is the builder's
      // own predicate rather than a second copy of the rule.
      const transform = mod.needsTransform(active.path, artifact.type, map.size)
        ? ((await import("@babel/standalone")).transform as unknown as Parameters<
            typeof mod.buildArtifactDoc
          >[0]["transform"])
        : undefined;
      if (!alive) return;

      const result = mod.buildArtifactDoc({
        files: map,
        entry: active.path,
        artifact,
        origin,
        head: headScript,
        transform,
      });
      if (!alive) return;
      setBuilt({ doc: result.doc, errors: result.errors, warnings: result.warnings });
    })();
    return () => {
      alive = false;
    };
    // `files` identity churns while streaming; the guard above already excludes
    // that case, and the path/version key is what actually changes a build.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canBuild,
    origin,
    active.path,
    artifact.type,
    artifact.code,
    files.map((f) => f.versions.length).join(","),
    headScript,
  ]);

  const liveDoc =
    !origin || !canRun ? "" : built ? built.doc : docFor(artifact, origin, headScript);

  // The panel now previews an artifact *while it is being written*, which is the
  // whole point — an artifact that only appears once the turn ends is one the
  // user has to go looking for. But `srcDoc` reloads the frame on every change,
  // and the stream flushes every ~48ms, so the raw document is throttled into
  // one reload per STREAM_RELOAD_MS. Once the code is complete it commits at once.
  const [doc, setDoc] = React.useState("");
  const lastReload = React.useRef(0);
  React.useEffect(() => {
    if (!streaming) {
      lastReload.current = Date.now();
      setDoc(liveDoc);
      return;
    }
    const wait = Math.max(0, STREAM_RELOAD_MS - (Date.now() - lastReload.current));
    const t = setTimeout(() => {
      lastReload.current = Date.now();
      setDoc(liveDoc);
    }, wait);
    return () => clearTimeout(t);
  }, [liveDoc, streaming]);

  /**
   * The document the frame actually gets, with the runtime spliced in when the
   * origin requires it. A no-op on a public origin; see
   * `lib/chat/artifact-runtime-inline.ts` for why a private one does.
   *
   * Deliberately *after* the throttle rather than before it. Splicing operates on
   * the whole document, and a React artifact's runtime is ~3MB — doing it on
   * `liveDoc` would run a multi-megabyte string replace on every ~48ms stream
   * flush instead of once per committed reload.
   */
  const frameDoc = useInlinedRuntime(doc, origin);

  // window.storage and the error channel: both served by the parent over
  // postMessage, because the frame is origin-isolated and has neither storage
  // nor a way to reach us otherwise. Both listeners are bound to this exact
  // frame and torn down when the document changes, so a swapped artifact can't
  // keep answering on the old namespace or attribute its errors to the new one.
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  React.useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !artifactId) return;
    return attachArtifactBridge(frame, artifactId);
  }, [artifactId, doc, tab]);

  React.useEffect(() => {
    setErrors([]);
    const frame = frameRef.current;
    // Half-written code throws constantly and none of it means anything, so
    // errors are only collected once the artifact is complete.
    if (!frame || !doc || streaming) return;
    return attachArtifactErrorListener(frame, (e) =>
      setErrors((prevErrors) => {
        const text = e.line ? `${e.message} (line ${e.line})` : e.message;
        return prevErrors.includes(text) ? prevErrors : [...prevErrors, text];
      }),
    );
  }, [doc, tab, streaming]);

  // A bundle that failed to build is shown through the same channel as a runtime
  // error, so "Fix these" works on "cannot resolve import './Nav'" exactly as it
  // does on a thrown exception. Both are things the model wrote and can correct.
  const allErrors = React.useMemo(
    () => [...(built?.errors ?? []), ...errors],
    [built?.errors, errors],
  );

  /**
   * Things the page rendered in spite of.
   *
   * Kept out of `allErrors` on purpose. A missing sibling file used to blank the
   * preview and shout "2 errors" in red over an empty frame, which said the
   * build was broken when it was merely unfinished — and it is unfinished for
   * most of every multi-file build, since a model writes the page before the
   * files the page links to. The page now renders and this says what is still
   * missing, in the state hue rather than the failure one.
   */
  const notices = React.useMemo(() => built?.warnings ?? [], [built?.warnings]);

  // Reported upward in an effect, not from inside the listener: calling a parent
  // setter during another component's render phase is what React warns about.
  //
  // Notices go up with the errors: the activity row's job is to say what is
  // wrong with the turn's output, and "the page has no stylesheet" belongs
  // there even though the frame did not throw.
  const reportErrors = React.useRef(onErrors);
  reportErrors.current = onErrors;
  React.useEffect(() => {
    reportErrors.current?.([...allErrors, ...notices]);
  }, [allErrors, notices]);

  React.useEffect(() => {
    setTab((t) => (t === "diff" && !prev ? "code" : t));
    if (!canPreview && tab === "preview") setTab("code");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, artifact.type]);

  function download() {
    const blob = new Blob([artifact.code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileSlug(artifact.title, "atlas-artifact")}.${EXT[artifact.type]}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * The whole build as an archive.
   *
   * One file at a time was right when a conversation could hold one artifact.
   * For a page plus its stylesheet plus its script it means three downloads and
   * the user rebuilding the directory layout by hand — so a multi-file build
   * gets a zip that already has the layout.
   */
  function downloadAll() {
    void import("@/lib/chat/zip").then(({ downloadZip }) => {
      downloadZip(
        files
          .map((f) => ({
            path: f.path,
            content: f.versions[f.versions.length - 1]?.code ?? "",
          }))
          .filter((e) => e.content),
        fileSlug(files[0]?.path ?? "atlas-project", "atlas-project"),
      );
    });
  }

  // PDF export, without a PDF library: the browser's own print pipeline writes
  // it. See lib/chat/print.ts for why that is the design and not a shortcut.
  const proseRef = React.useRef<HTMLDivElement>(null);
  const printMode = printModeFor(artifact.type);
  const canPrint = printMode === "frame" ? tab === "preview" && !!doc : printMode !== null;

  function print() {
    if (printMode === "frame") {
      if (frameRef.current) requestFramePrint(frameRef.current);
      return;
    }
    const host = proseRef.current;
    if (!host) return;
    const root = host.querySelector<HTMLElement>("[data-print-root]") ?? host;
    printRenderedNode(root, artifact.title, artifact.type === "slides" ? "slides" : "document");
  }

  // A `blob:` URL inherits the creating document's origin, so opening the
  // artifact directly in a tab used to run model-generated code at Atlas's own
  // origin with no sandbox at all — strictly worse than the iframe, since a
  // top-level document can't be sandboxed after the fact. Instead we hand the
  // code to a first-party shell page that re-hosts it in the same locked-down
  // iframe the panel uses. sessionStorage is the transport: same-origin, and it
  // keeps the payload out of the URL.
  function openTab() {
    if (!docFor(artifact, origin)) return;
    try {
      sessionStorage.setItem(
        ARTIFACT_PREVIEW_KEY,
        JSON.stringify({ type: artifact.type, lang: artifact.lang, code: artifact.code, title: artifact.title }),
      );
    } catch {
      return; // quota or disabled storage — fail closed rather than unsandboxed
    }
    window.open("/artifact/preview", "_blank", "noopener");
  }

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-surface",
        !embedded && "border-l border-border",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2 border-b border-border px-3",
          embedded ? "h-11" : "h-14",
        )}
      >
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-action/10">
            <Code2 className="size-3.5 text-action" />
          </span>
          <span className="truncate">{artifact.title}</span>
          {streaming && (
            <span className="shrink-0 text-2xs font-normal text-muted-foreground">writing…</span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {canRun && (
            <IconBtn title="Open in new tab" onClick={openTab}>
              <ExternalLink className="size-4" />
            </IconBtn>
          )}
          {canPrint && (
            <IconBtn title="Print / Save as PDF" onClick={print}>
              <Printer className="size-4" />
            </IconBtn>
          )}
          <IconBtn
            title={files.length > 1 ? `Download this file (${active.path})` : "Download source"}
            onClick={download}
          >
            <Download className="size-4" />
          </IconBtn>
          {files.length > 1 && (
            <IconBtn title={`Download all ${files.length} files as a zip`} onClick={downloadAll}>
              <FolderDown className="size-4" />
            </IconBtn>
          )}
          {onRemix && (
            <IconBtn
              title={
                files.length > 1
                  ? `Remix all ${files.length} files into a new chat`
                  : "Remix into a new chat"
              }
              onClick={onRemix}
            >
              <CopyPlus className="size-4" />
            </IconBtn>
          )}
          <IconBtn
            title="Copy"
            onClick={() => {
              navigator.clipboard.writeText(artifact.code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
          </IconBtn>
          {/* The rail owns closing when embedded. Two close buttons in one
              header — one for the tab, one for the panel — is a coin toss. */}
          {!embedded && (
            <IconBtn title="Close" onClick={onClose}>
              <X className="size-4" />
            </IconBtn>
          )}
        </div>
      </div>

      {/* File switcher. Only when there is more than one — a single-file
          artifact should look exactly as it did before multi-file existed. */}
      {files.length > 1 && (
        <div className="flex gap-1 overflow-x-auto border-b border-border px-3 py-1.5">
          {files.map((f) => (
            <button
              key={f.path}
              onClick={() => onSelectPath?.(f.path)}
              className={cn(
                "shrink-0 rounded-lg px-2 py-1 font-mono text-2xs transition-colors",
                f.path === active.path
                  ? "bg-surface-2 text-action"
                  : "text-muted-foreground hover:bg-surface-2/60 hover:text-foreground",
              )}
            >
              {f.path}
            </button>
          ))}
        </div>
      )}

      {/* Tabs + version nav */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <div className="inline-flex rounded-lg border border-border bg-surface-2/60 p-0.5 text-xs">
          {canPreview && (
            <TabBtn active={tab === "preview"} onClick={() => setTab("preview")}>
              <Eye className="size-3.5" /> Preview
            </TabBtn>
          )}
          <TabBtn active={tab === "code"} onClick={() => setTab("code")}>
            <Code2 className="size-3.5" /> Code
          </TabBtn>
          {prev && (
            <TabBtn active={tab === "diff"} onClick={() => setTab("diff")}>
              <GitCompareArrows className="size-3.5" /> Diff
            </TabBtn>
          )}
        </div>
        {canRun && tab === "preview" && (
          <div className="inline-flex rounded-lg border border-border bg-surface-2/60 p-0.5">
            {(Object.keys(VIEWPORTS) as ViewportId[]).map((id) => {
              const V = VIEWPORTS[id];
              const Icon = V.icon;
              return (
                <button
                  key={id}
                  onClick={() => setViewport(id)}
                  title={V.label}
                  aria-label={`Preview at ${V.label} width`}
                  aria-pressed={viewport === id}
                  className={cn(
                    "grid size-6 place-items-center rounded transition-colors",
                    viewport === id
                      ? "bg-surface-3 text-action"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                </button>
              );
            })}
          </div>
        )}
        {versions.length > 1 && (
          <div className="flex items-center gap-1 text-2xs text-muted-foreground">
            <button
              disabled={idx === 0}
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
              className="grid size-6 place-items-center rounded hover:bg-surface-2 disabled:opacity-40"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <span className="tabular-nums">
              v{idx + 1}/{versions.length}
            </span>
            <button
              disabled={idx === versions.length - 1}
              onClick={() => setIdx((i) => Math.min(versions.length - 1, i + 1))}
              className="grid size-6 place-items-center rounded hover:bg-surface-2 disabled:opacity-40"
            >
              <ChevronRight className="size-3.5" />
            </button>
            {/* Only meaningful while looking at an older version. Reverting
                moves the pointer; later versions stay in the history. */}
            {onRevert && idx < versions.length - 1 && (
              <button
                onClick={() => onRevert(idx + 1)}
                title={`Make v${idx + 1} the current version (later versions are kept)`}
                className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-action hover:bg-surface-2"
              >
                <Undo2 className="size-3" /> Revert
              </button>
            )}
          </div>
        )}
      </div>

      {/* Runtime errors, reported by the artifact itself over postMessage. The
          model wrote this code and until now had no way to find out whether it
          ran; this is that channel surfaced.

          `allErrors`, not `errors`: the count and the Fix payload both use the
          merged list, so listing only the runtime half meant a pure bundle
          failure — "cannot resolve import framer-motion", the most common one —
          rendered as "1 error" above an empty list. */}
      <IssueStrip
        tone="danger"
        items={allErrors}
        label={allErrors.length === 1 ? "1 error" : `${allErrors.length} errors`}
        onFix={onFix}
      />

      {/* Separate strip, separate hue. The page in the frame below is rendering;
          these are the parts of it that have not been written yet. */}
      <IssueStrip
        tone="warning"
        items={notices}
        label={notices.length === 1 ? "Missing 1 file" : `Missing ${notices.length} files`}
        onFix={onFix}
      />


      <div className="min-h-0 flex-1 overflow-auto" ref={proseRef}>
        {tab === "diff" && prev ? (
          <div className="p-3">
            <DiffViewer oldText={prev.code} newText={artifact.code} />
          </div>
        ) : tab === "code" ? (
          <div className="p-3">
            <Markdown>{`\`\`\`${artifact.lang}\n${artifact.code}\n\`\`\``}</Markdown>
          </div>
        ) : canRun ? (
          doc ? (
            // The device frame is host-side only: the width changes, the
            // document does not. A page that responds to its viewport therefore
            // responds to this, and "show me the mobile layout" costs no
            // re-render of the artifact itself.
            <div
              className={cn(
                "h-full min-h-[300px] w-full",
                viewport !== "desktop" && "grid place-items-start justify-center overflow-auto bg-surface-2/40 p-4",
              )}
            >
              <iframe
                ref={frameRef}
                title={artifact.title}
                srcDoc={frameDoc}
                // Deliberately no `allow-same-origin` — see cspFor() above. Adding
                // it back would hand model-generated code the parent's storage.
                sandbox={ARTIFACT_SANDBOX}
                style={viewport === "desktop" ? undefined : { width: VIEWPORTS[viewport].width }}
                className={cn(
                  "bg-white",
                  viewport === "desktop"
                    ? "h-full min-h-[300px] w-full"
                    : "h-[min(100%,860px)] min-h-[420px] rounded-xl border border-border shadow-lg",
                )}
              />
            </div>
          ) : (
            <div className="h-full min-h-[300px] w-full bg-white" />
          )
        ) : artifact.type === "slides" ? (
          <SlidesView code={artifact.code} streaming={streaming} />
        ) : isProse(artifact.type) ? (
          <DocumentView code={artifact.code} streaming={streaming} />
        ) : artifact.type === "mermaid" ? (
          <div className="p-4" data-print-root>
            <MermaidBlock code={artifact.code} />
          </div>
        ) : (
          <div className="p-3" data-print-root>
            <Markdown>{`\`\`\`${artifact.lang}\n${artifact.code}\n\`\`\``}</Markdown>
          </div>
        )}
      </div>

      {/* Edit-in-place */}
      {onEdit && (
        <div className="border-t border-border p-2.5">
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && editText.trim()) {
                    onEdit(editText.trim());
                    setEditText("");
                    setEditing(false);
                  } else if (e.key === "Escape") setEditing(false);
                }}
                placeholder="Describe a change… (e.g. make the header sticky)"
                className="h-9 flex-1 rounded-lg border border-border bg-surface-2/50 px-3 text-sm outline-none focus:border-action/40"
              />
              <button
                onClick={() => {
                  if (editText.trim()) {
                    onEdit(editText.trim());
                    setEditText("");
                    setEditing(false);
                  }
                }}
                className="grid size-9 place-items-center rounded-lg bg-action text-action-foreground"
              >
                <Wand2 className="size-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2 text-sm text-muted-foreground transition-colors hover:border-action/40 hover:text-foreground"
            >
              <Wand2 className="size-4 text-action" /> Edit this artifact
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One band of things that are wrong with the artifact.
 *
 * Two tones, because two different facts need telling apart and the old single
 * red strip could not: `danger` is "this did not run", `warning` is "this ran,
 * and here is what it is still missing". Both keep the icon beside the hue, per
 * the token rules in globals.css, so the distinction never rests on colour.
 *
 * The warning text is a sentence naming the file and the fix, not a stack line,
 * so it wraps instead of truncating into uselessness at the panel's 320px floor.
 */
function IssueStrip({
  tone,
  items,
  label,
  onFix,
}: {
  tone: "danger" | "warning";
  items: string[];
  label: string;
  onFix?: (errors: string[]) => void;
}) {
  if (items.length === 0) return null;
  const danger = tone === "danger";
  const Icon = danger ? AlertTriangle : FileWarning;
  return (
    <div
      className={cn(
        "border-b px-3 py-2",
        danger ? "border-danger/25 bg-danger/10" : "border-warning/25 bg-warning/10",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn("size-3.5 shrink-0", danger ? "text-danger" : "text-warning")} />
        <span
          className={cn("text-2xs font-medium", danger ? "text-danger" : "text-warning")}
        >
          {label}
        </span>
        {onFix && (
          <button
            onClick={() => onFix(items)}
            className={cn(
              // 44px on touch, the original 27px once there is a pointer: the
              // panel is reachable from the mobile bottom sheet, where the
              // strip's own button was the last sub-target left in it.
              "ml-auto inline-flex min-h-11 shrink-0 items-center rounded-md border px-3 text-2xs transition-colors sm:min-h-0 sm:px-2 sm:py-1",
              danger
                ? "border-danger/30 text-danger hover:bg-danger/15"
                : "border-warning/30 text-warning hover:bg-warning/15",
            )}
          >
            Fix these
          </button>
        )}
      </div>
      <ul className="mt-1 space-y-0.5">
        {items.slice(0, 3).map((e) => (
          <li
            key={e}
            title={e}
            className={cn(
              "min-w-0 text-2xs",
              danger
                ? "truncate font-mono text-danger/80"
                : "break-words text-warning/90",
            )}
          >
            {e}
          </li>
        ))}
      </ul>
    </div>
  );
}

function IconBtn({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      // 44px on touch, 32px once there is a pointer: the toolbar is reachable
      // from the mobile bottom sheet, where 32px is under the minimum target.
      className="grid size-11 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground sm:size-8"
    >
      {children}
    </button>
  );
}

function TabBtn({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1",
        active && "bg-surface shadow-sm",
      )}
    >
      {children}
    </button>
  );
}
