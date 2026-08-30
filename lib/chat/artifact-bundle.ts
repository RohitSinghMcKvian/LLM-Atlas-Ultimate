import { cspFor, optionalLibTags } from "./artifact-sandbox";

/**
 * Turning several workspace files into one runnable document.
 *
 * `buildReactDoc` could only ever render a single file, because it **deleted
 * every `import … from` line** before transpiling. That is why a multi-screen
 * app was impossible: the model would write `App.jsx`, `Home.jsx` and
 * `Nav.jsx`, and the frame would render the first one with its imports stripped
 * and every component undefined.
 *
 * The approach here is deliberately not hand-rolled import rewriting. Regexing
 * `import`/`export` into assignments looks like it works until it meets a
 * default export, a re-export, a circular import or two files that both declare
 * `Button`. Instead each module is transformed to **CommonJS by Babel** — the
 * same Babel already vendored for JSX — and assembled with a ~30-line `require`
 * registry. That buys, for free and correctly:
 *
 *  - name collisions: each module is its own function scope;
 *  - `export default`, named exports and re-exports: Babel's interop;
 *  - circular imports: CJS partial-exports semantics, exactly as in Node;
 *  - TypeScript and JSX: the presets `buildReactDoc` already used.
 *
 * `transform` is injected rather than imported so this module stays pure and
 * node-testable. The browser passes a lazily-imported `@babel/standalone`.
 */

/** A file the bundler can resolve, keyed by its workspace-relative path. */
export type FileMap = ReadonlyMap<string, string>;

/** The Babel entry point, narrowed to what this module uses. */
export type Transform = (
  code: string,
  options: { filename: string; presets: unknown[]; plugins: unknown[] },
) => { code?: string | null };

export interface BundleResult {
  /** The assembled script, or "" when bundling failed. */
  code: string;
  /** CSS pulled in through `import "./x.css"`, concatenated in import order. */
  css: string;
  /** Fatal problems. A non-empty list means `code` must not be run. */
  errors: string[];
  /** Modules actually reached from the entry, in dependency order. */
  order: string[];
}

/**
 * Bare specifiers that resolve to a vendored global rather than a file.
 *
 * The sandbox has `connect-src 'none'` and no remote hosts, so there is no
 * npm to fall back to: a specifier is either a workspace file, one of these, or
 * an error the model can see and fix.
 *
 * A dotted value is walked off `window` by `__resolveGlobal`, which is what lets
 * the `AtlasShims.*` entries share one script (public/artifact-runtime/atlas-shims.js,
 * authored in scripts/artifact-shims.js) instead of claiming nine globals.
 *
 * Exported because the classifier in artifact-verify.ts needs to tell two
 * different failures apart: a specifier that is not in this table is the model
 * asking for something Atlas never offered, while one that IS here and still
 * fails at runtime is Atlas's own bug — a vendored file that did not load, or a
 * global name that does not match what the build actually exposes. Only the
 * former is worth a repair turn.
 */
export const GLOBALS: Record<string, string> = {
  react: "React",
  "react-dom": "ReactDOM",
  "react-dom/client": "ReactDOM",
  recharts: "Recharts",
  d3: "d3",
  three: "THREE",
  mathjs: "math",
  papaparse: "Papa",
  // `LucideReact`, not `lucide`. The vendored UMD banner is `a.LucideReact={}`,
  // so the old value resolved to undefined and every icon import threw
  // "Cannot resolve module 'lucide-react'" at runtime — after passing the
  // build-time check here, which made it look like a model error.
  "lucide-react": "LucideReact",
  "framer-motion": "Motion",
  clsx: "AtlasShims.clsx",
  classnames: "AtlasShims.clsx",
  "tailwind-merge": "AtlasShims.twMerge",
  "next/link": "AtlasShims.nextLink",
  "next/image": "AtlasShims.nextImage",
  "next/navigation": "AtlasShims.nextNavigation",
  "next/router": "AtlasShims.nextRouter",
  "next/font/google": "AtlasShims.nextFont",
  "next/font/local": "AtlasShims.nextFont",
  "next/head": "AtlasShims.nextHead",
  "next/script": "AtlasShims.nextScript",
};

/**
 * What to tell the model when a bare specifier does not resolve.
 *
 * Naming the alternatives is the difference between a repair attempt that
 * converges and one that guesses: "cannot resolve import 'gsap'" invites another
 * animation library that also is not there, while the list makes the fix obvious
 * on the first try.
 */
function availableModules(): string {
  return Object.keys(GLOBALS).sort().join(", ");
}

/** Extensions tried when a specifier has none, in the order a bundler would. */
const EXTENSIONS = ["", ".jsx", ".tsx", ".js", ".ts", ".mjs", ".css", "/index.jsx", "/index.tsx", "/index.js", "/index.ts"];

/** Guard against a pathological input locking up the transform. */
export const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;

/** Normalise `./a/../b` relative to the importing file's directory. */
export function resolveRelative(fromPath: string, spec: string): string {
  const base = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
  const parts = (base ? `${base}/${spec}` : spec).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") {
      out.pop();
      continue;
    }
    out.push(p);
  }
  return out.join("/");
}

/** The file a specifier refers to, or null when nothing matches. */
export function resolveSpecifier(
  fromPath: string,
  spec: string,
  files: FileMap,
): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null; // bare: a global
  const target = resolveRelative(fromPath, spec.replace(/^\//, ""));
  for (const ext of EXTENSIONS) {
    const candidate = `${target}${ext}`;
    if (files.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Every `import`/`require`/dynamic-`import` specifier in a source file.
 *
 * A scan rather than a parse: this only decides *which files to transform*, and
 * the transform itself is Babel's. Over-collecting costs an unused module in the
 * bundle; under-collecting is caught at runtime by `require` throwing a named
 * error the model can act on.
 */
export function scanImports(code: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\bimport\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bexport\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
  ];
  for (const re of patterns) {
    for (const m of code.matchAll(re)) if (m[1]) out.push(m[1]);
  }
  return [...new Set(out)];
}

/**
 * Depth-first walk from the entry, emitting dependencies before dependents.
 *
 * A cycle is not an error — CommonJS resolves them by handing back a partial
 * `exports`, which is what React component graphs rely on when two files
 * reference each other. `visiting` stops the walk from recursing forever; the
 * runtime handles the semantics.
 */
export function moduleOrder(
  entry: string,
  files: FileMap,
): { order: string[]; missing: { from: string; spec: string }[] } {
  const order: string[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  const missing: { from: string; spec: string }[] = [];

  const walk = (path: string) => {
    if (done.has(path) || visiting.has(path)) return;
    visiting.add(path);
    const src = files.get(path) ?? "";
    for (const spec of scanImports(src)) {
      if (!spec.startsWith(".") && !spec.startsWith("/")) {
        // Bare specifier: a vendored global, or a genuine miss.
        if (!(spec in GLOBALS)) missing.push({ from: path, spec });
        continue;
      }
      const resolved = resolveSpecifier(path, spec, files);
      if (resolved) walk(resolved);
      else missing.push({ from: path, spec });
    }
    visiting.delete(path);
    done.add(path);
    order.push(path);
  };

  walk(entry);
  return { order, missing };
}

/**
 * The module registry, injected ahead of the transformed modules.
 *
 * Small on purpose. It is CommonJS: `__atlas_def` records a factory,
 * `require` runs it once and caches `module.exports`. Registering the partial
 * `exports` object *before* running the factory is what makes a circular import
 * resolve instead of recursing — the same trick Node uses.
 */
export function registryRuntime(globals: Record<string, string>): string {
  return `(function(){
var __defs = {}, __cache = {};
var __globals = ${JSON.stringify(globals)};
function __resolveGlobal(name){
  var g = __globals[name];
  if (!g) return undefined;
  var parts = g.split(".");
  var cur = window;
  for (var i = 0; i < parts.length; i++) { if (cur == null) return undefined; cur = cur[parts[i]]; }
  return cur;
}
window.__atlas_def = function(path, factory){ __defs[path] = factory; };
window.__atlas_require = function(path){
  if (__cache[path]) return __cache[path].exports;
  var g = __resolveGlobal(path);
  if (g !== undefined) {
    var wrapped = g && g.__esModule ? g : { __esModule: true, default: g };
    if (g && typeof g === "object") for (var k in g) { if (!(k in wrapped)) wrapped[k] = g[k]; }
    __cache[path] = { exports: wrapped };
    return wrapped;
  }
  var f = __defs[path];
  if (!f) throw new Error("Cannot resolve module '" + path + "'");
  // Registered BEFORE the factory runs, so a cycle sees a partial exports
  // object rather than recursing forever.
  var m = { exports: {} };
  __cache[path] = m;
  f(m, m.exports, window.__atlas_require);
  return m.exports;
};
})();`;
}

/**
 * Transform and assemble. Never throws: a failure is an `errors` entry, because
 * the artifact error channel can show those and the model can act on them.
 */
export function bundleModules(
  entry: string,
  files: FileMap,
  transform: Transform,
): BundleResult {
  const errors: string[] = [];

  if (!files.has(entry)) {
    return { code: "", css: "", errors: [`Entry file "${entry}" not found.`], order: [] };
  }

  let total = 0;
  for (const src of files.values()) total += src.length;
  if (total > MAX_BUNDLE_BYTES) {
    return {
      code: "",
      css: "",
      errors: [`Project is ${Math.round(total / 1024)} KB, over the ${MAX_BUNDLE_BYTES / 1024} KB bundling limit.`],
      order: [],
    };
  }

  const { order, missing } = moduleOrder(entry, files);
  for (const m of missing) {
    const bare = !m.spec.startsWith(".") && !m.spec.startsWith("/");
    errors.push(
      bare
        ? `${m.from}: cannot resolve import "${m.spec}". Artifacts run offline with no npm; the only bare imports available are: ${availableModules()}. Use one of those or write the code inline.`
        : `${m.from}: cannot resolve import "${m.spec}".`,
    );
  }

  const cssParts: string[] = [];
  const chunks: string[] = [registryRuntime(GLOBALS)];

  for (const path of order) {
    const src = files.get(path) ?? "";
    if (path.endsWith(".css")) {
      // A CSS import contributes a stylesheet and an empty module, so
      // `import "./a.css"` is valid rather than an unresolved specifier.
      cssParts.push(src);
      chunks.push(`window.__atlas_def(${JSON.stringify(path)}, function(module, exports, require){});`);
      continue;
    }
    let out: string;
    try {
      const result = transform(src, {
        filename: path,
        presets: [["react", {}], ["typescript", { allExtensions: true, isTSX: true }]],
        plugins: [["transform-modules-commonjs", { strictNamespace: false }]],
      });
      out = result.code ?? "";
    } catch (e) {
      errors.push(`${path}: ${(e as Error).message}`);
      continue;
    }
    // The rewritten `require` calls resolve against the registry, and relative
    // specifiers are rewritten to the absolute workspace paths the registry is
    // keyed by — otherwise `./Nav` from two different directories would collide.
    const rewritten = out.replace(
      /require\(\s*(['"])([^'"]+)\1\s*\)/g,
      (whole, _q, spec: string) => {
        if (!spec.startsWith(".") && !spec.startsWith("/")) return `require(${JSON.stringify(spec)})`;
        const target = resolveSpecifier(path, spec, files);
        return target ? `require(${JSON.stringify(target)})` : whole;
      },
    );
    chunks.push(
      `window.__atlas_def(${JSON.stringify(path)}, function(module, exports, require){\n${rewritten}\n});`,
    );
  }

  // Run the entry, then mount its default export if it did not mount itself.
  //
  // Both shapes are common and neither is wrong: a model may write an
  // `index.jsx` that calls `createRoot(...).render(...)`, or an `App.jsx` that
  // just exports a component. Checking whether #root already has children tells
  // the two apart without asking the model to pick a convention.
  chunks.push(`(function(){
var __exports = window.__atlas_require(${JSON.stringify(entry)});
var __root = document.getElementById("root");
if (!__root || __root.hasChildNodes()) return;
var __C = __exports && (__exports.default || __exports.App);
if (typeof __C !== "function") return;
ReactDOM.createRoot(__root).render(React.createElement(__C));
})();`);
  return { code: chunks.join("\n"), css: cssParts.join("\n"), errors, order };
}

/**
 * Inline a page's own assets, for an HTML entry.
 *
 * A landing page split into `index.html` + `styles.css` + `app.js` is not a
 * module graph and must not be fed to Babel — the entry is markup. What it needs
 * is for its relative `<link href>` and `<script src>` to resolve, which they
 * cannot: the frame is at an opaque origin with `connect-src 'none'`, so a
 * relative URL has nothing to fetch from. So the references are replaced with
 * the file contents before the document ever reaches the frame.
 *
 * Only *relative* references are touched. An absolute or protocol URL is left
 * alone, where the CSP will block it — visibly, through the error channel — the
 * same as it does today.
 *
 * A relative reference that resolves to nothing is a **warning, not an error**,
 * and the difference is the whole point of the split return. A build writes its
 * page before the files that page links to — every plan a model produces is
 * shaped that way, "create index.html with links to CSS and JS" first — so for
 * most of a multi-file build, and permanently for one the provider cut short,
 * `styles.css` is referenced and not yet written. Treating that as a build
 * failure blanked the preview and threw away the markup that did exist, which
 * is both the least useful outcome and the opposite of what a browser does with
 * a stylesheet that 404s. It was also inconsistent with the line above: an
 * *absolute* URL that cannot load renders the page anyway.
 *
 * The dead tag is dropped rather than left in place. Left in, the relative URL
 * resolves against the opaque origin and fires a `resource` error too, which
 * `FATAL_RESOURCE` in artifact-verify.ts classifies as fatal — so one missing
 * file would be reported twice, through two channels, one of them fatal.
 */
export function inlineHtmlAssets(
  entryPath: string,
  files: FileMap,
): { html: string; errors: string[]; warnings: string[] } {
  const entry = files.get(entryPath);
  if (entry === undefined) {
    return { html: "", errors: [`Entry file "${entryPath}" not found.`], warnings: [] };
  }

  const warnings: string[] = [];
  const isRelative = (u: string) => !/^[a-zA-Z][a-zA-Z0-9+.-]*:|^\/\//.test(u) && !u.startsWith("#");

  /**
   * What to say about a reference that resolves to nothing.
   *
   * Named with the fix in it, for the same reason `availableModules` above is:
   * this text is quoted into the repair prompt, and "not found in the workspace"
   * describes the symptom without saying which of the two possible corrections
   * — write the file, or drop the reference — is wanted.
   */
  const missing = (kind: string, url: string) =>
    `${entryPath} links to ${kind} "${url}", which is not in the workspace yet. ` +
    `Create that file, or remove the reference from ${entryPath}.`;

  let html = entry.replace(
    /<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*>/gi,
    (tag) => {
      const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      if (!href || !isRelative(href)) return tag;
      const target = resolveSpecifier(entryPath, href.startsWith(".") ? href : `./${href}`, files);
      if (!target) {
        warnings.push(missing("stylesheet", href));
        return `<!-- atlas: stylesheet ${href} not written yet -->`;
      }
      return `<style data-from="${target}">
${files.get(target) ?? ""}
</style>`;
    },
  );

  html = html.replace(/<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi,
    (tag, before: string, src: string, after: string) => {
      if (!isRelative(src)) return tag;
      const target = resolveSpecifier(entryPath, src.startsWith(".") ? src : `./${src}`, files);
      if (!target) {
        warnings.push(missing("script", src));
        return `<!-- atlas: script ${src} not written yet -->`;
      }
      // `type` is preserved so a module script stays a module script.
      const attrs = `${before} ${after}`.replace(/\s+/g, " ").trim();
      const typeAttr = /\btype\s*=\s*["'][^"']*["']/i.exec(attrs)?.[0] ?? "";
      return `<script ${typeAttr} data-from="${target}">
${files.get(target) ?? ""}
</script>`;
    },
  );

  return { html, errors: [], warnings };
}

/** Whether an entry is markup (inline its assets) or a module (bundle it). */
export function isHtmlEntry(path: string): boolean {
  return /\.html?$/i.test(path);
}

/**
 * A runnable document for a multi-file React project.
 *
 * The transform has already happened, so unlike `buildReactDoc` this ships no
 * Babel to the frame and needs no `'unsafe-eval'` for the module graph itself.
 */
export function buildBundledDoc(opts: {
  bundle: BundleResult;
  origin: string;
  head?: string;
  /** Combined source, used only to decide which vendored libraries to include. */
  detectSource: string;
}): string {
  const { bundle, origin, head = "", detectSource } = opts;
  return `<!DOCTYPE html><html><head>
<meta http-equiv="Content-Security-Policy" content="${cspFor(origin)}">${head}
<script src="${origin}/artifact-runtime/react.js"></script>
<script src="${origin}/artifact-runtime/react-dom.js"></script>${optionalLibTags(detectSource, origin)}
<style>body{margin:0;font-family:system-ui,sans-serif;background:#101112;color:#E9E9EA}</style>
${bundle.css ? `<style>\n${bundle.css}\n</style>` : ""}
</head><body><div id="root"></div>
<script>
${bundle.code}
</script></body></html>`;
}
