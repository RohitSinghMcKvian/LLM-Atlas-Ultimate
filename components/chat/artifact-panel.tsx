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
} from "lucide-react";
import { Markdown } from "@/components/markdown";
import { MermaidBlock } from "@/components/mermaid";
import { DiffViewer } from "@/components/diff-viewer";
import { cn } from "@/lib/utils";

export type ArtifactType =
  | "html"
  | "svg"
  | "markdown"
  | "code"
  | "mermaid"
  | "react";

export interface Artifact {
  type: ArtifactType;
  lang: string;
  code: string;
  title: string;
}

const EXT: Record<ArtifactType, string> = {
  html: "html",
  svg: "svg",
  markdown: "md",
  code: "txt",
  mermaid: "mmd",
  react: "jsx",
};

// This scans the full message body with a global regex and materializes every
// code block. It runs once per assistant bubble per render, and again over the
// whole thread every streaming flush — but it is a pure function of a string,
// and while a response streams only the last message's content is new, so
// nearly every call is a repeat of one already answered.
//
// Bounded so a long session can't grow this without limit; insertion order
// makes the oldest key the first one Map iteration yields.
const artifactCache = new Map<string, Artifact | null>();
const ARTIFACT_CACHE_MAX = 200;

/** Extract the best renderable artifact from an assistant message. */
export function extractArtifact(content: string): Artifact | null {
  if (artifactCache.has(content)) return artifactCache.get(content)!;
  const result = computeArtifact(content);
  if (artifactCache.size >= ARTIFACT_CACHE_MAX) {
    const oldest = artifactCache.keys().next().value;
    if (oldest !== undefined) artifactCache.delete(oldest);
  }
  artifactCache.set(content, result);
  return result;
}

function computeArtifact(content: string): Artifact | null {
  const re = /```(\w+)?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  const blocks: { lang: string; code: string }[] = [];
  while ((match = re.exec(content))) {
    blocks.push({ lang: (match[1] ?? "").toLowerCase(), code: match[2].trim() });
  }
  // Prefer visual/interactive artifacts, then long code, then standalone docs.
  for (const b of blocks) {
    if (b.lang === "html" || b.code.startsWith("<!DOCTYPE") || /<html[\s>]/i.test(b.code))
      return { type: "html", lang: "html", code: b.code, title: "HTML preview" };
    if (b.lang === "svg" || b.code.startsWith("<svg"))
      return { type: "svg", lang: "svg", code: b.code, title: "SVG" };
    if (b.lang === "mermaid")
      return { type: "mermaid", lang: "mermaid", code: b.code, title: "Diagram" };
    if (["jsx", "tsx", "react"].includes(b.lang))
      return { type: "react", lang: b.lang, code: b.code, title: "React component" };
  }
  for (const b of blocks) {
    if (b.code.split("\n").length >= 12)
      return { type: "code", lang: b.lang || "text", code: b.code, title: `${b.lang || "code"} snippet` };
  }
  for (const b of blocks) {
    if ((b.lang === "markdown" || b.lang === "md") && b.code.length > 200)
      return { type: "markdown", lang: "markdown", code: b.code, title: "Document" };
  }
  return null;
}

function buildReactDoc(code: string): string {
  const cleaned = code
    .split("\n")
    .filter((l) => !/^\s*import\s.+from\s+['"]/.test(l))
    .join("\n")
    .replace(/export\s+default\s+function/, "function")
    .replace(/export\s+default\s+class/, "class")
    .replace(/export\s+default\s+/, "window.__ATLAS_DEFAULT__ = ");
  return `<!DOCTYPE html><html><head>
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<style>body{margin:0;font-family:system-ui,sans-serif;background:#0b0d14;color:#e6edf3;padding:16px}</style>
</head><body><div id="root"></div>
<script type="text/babel" data-presets="react,typescript">
${cleaned}
const __root = ReactDOM.createRoot(document.getElementById('root'));
const __Comp = (typeof App !== 'undefined' && App) || window.__ATLAS_DEFAULT__;
__root.render(__Comp ? React.createElement(__Comp) : React.createElement('pre', null, 'No <App/> or default export found.'));
</script></body></html>`;
}

function docFor(a: Artifact): string {
  if (a.type === "html") return a.code;
  if (a.type === "react") return buildReactDoc(a.code);
  if (a.type === "svg")
    return `<!DOCTYPE html><html><head><style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#0b0d14}</style></head><body>${a.code}</body></html>`;
  return "";
}

export function ArtifactPanel({
  versions,
  onClose,
  onEdit,
}: {
  versions: Artifact[];
  onClose: () => void;
  onEdit?: (instruction: string) => void;
}) {
  const [idx, setIdx] = React.useState(versions.length - 1);
  const [tab, setTab] = React.useState<"preview" | "code" | "diff">("preview");
  const [copied, setCopied] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [editText, setEditText] = React.useState("");

  // Follow the latest version as new ones stream in.
  const lastLen = React.useRef(versions.length);
  React.useEffect(() => {
    if (versions.length !== lastLen.current) {
      setIdx(versions.length - 1);
      lastLen.current = versions.length;
    }
  }, [versions.length]);

  const artifact = versions[Math.min(idx, versions.length - 1)];
  const canPreview =
    artifact.type === "html" || artifact.type === "svg" || artifact.type === "react";
  const prev = idx > 0 ? versions[idx - 1] : null;

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
    a.download = `atlas-artifact.${EXT[artifact.type]}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function openTab() {
    const doc = docFor(artifact);
    if (!doc) return;
    const blob = new Blob([doc], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
  }

  return (
    <div className="flex h-full flex-col border-l border-border bg-surface">
      <div className="flex h-14 items-center justify-between gap-2 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-gradient-primary-soft">
            <Code2 className="size-3.5 text-cyan" />
          </span>
          <span className="truncate">{artifact.title}</span>
        </div>
        <div className="flex items-center gap-0.5">
          {canPreview && (
            <IconBtn title="Open in new tab" onClick={openTab}>
              <ExternalLink className="size-4" />
            </IconBtn>
          )}
          <IconBtn title="Download" onClick={download}>
            <Download className="size-4" />
          </IconBtn>
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
          <IconBtn title="Close" onClick={onClose}>
            <X className="size-4" />
          </IconBtn>
        </div>
      </div>

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
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "preview" && canPreview ? (
          <iframe
            title={artifact.title}
            srcDoc={docFor(artifact)}
            sandbox="allow-scripts allow-same-origin"
            className="h-full min-h-[300px] w-full bg-white"
          />
        ) : tab === "diff" && prev ? (
          <div className="p-3">
            <DiffViewer oldText={prev.code} newText={artifact.code} />
          </div>
        ) : artifact.type === "markdown" ? (
          <div className="p-5">
            <Markdown>{artifact.code}</Markdown>
          </div>
        ) : artifact.type === "mermaid" ? (
          <div className="p-4">
            <MermaidBlock code={artifact.code} />
          </div>
        ) : (
          <div className="p-3">
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
                className="h-9 flex-1 rounded-lg border border-border bg-surface-2/50 px-3 text-sm outline-none focus:border-cyan/40"
              />
              <button
                onClick={() => {
                  if (editText.trim()) {
                    onEdit(editText.trim());
                    setEditText("");
                    setEditing(false);
                  }
                }}
                className="grid size-9 place-items-center rounded-lg bg-gradient-primary text-primary-foreground"
              >
                <Wand2 className="size-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2 text-sm text-muted-foreground transition-colors hover:border-cyan/40 hover:text-foreground"
            >
              <Wand2 className="size-4 text-cyan" /> Edit this artifact
            </button>
          )}
        </div>
      )}
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
      onClick={onClick}
      className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground"
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
