import { describe, it, expect } from "vitest";
import {
  ARTIFACT_SANDBOX,
  RUNTIME_LIBS,
  optionalLibTags,
  usesTailwind,
  buildReactDoc,
  cspFor,
  docFor,
  isExecutable,
  withCsp,
  type Artifact,
} from "./artifact-sandbox";

const ORIGIN = "https://atlas.test";

describe("ARTIFACT_SANDBOX", () => {
  // This is the regression guard for the original vulnerability: the panel used
  // `allow-scripts allow-same-origin`, which put model-generated code on Atlas's
  // own origin with read access to the localStorage holding the user's API key.
  it("never grants allow-same-origin", () => {
    expect(ARTIFACT_SANDBOX).not.toContain("allow-same-origin");
  });

  it("still allows scripts, so artifacts remain interactive", () => {
    expect(ARTIFACT_SANDBOX).toContain("allow-scripts");
  });
});

describe("cspFor", () => {
  const csp = cspFor(ORIGIN);

  it("denies everything by default", () => {
    expect(csp).toContain("default-src 'none'");
  });

  it("blocks all outbound connections", () => {
    expect(csp).toContain("connect-src 'none'");
  });

  it("permits no remote script host other than Atlas itself", () => {
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src"));
    expect(scriptSrc).toBeDefined();
    const hosts = (scriptSrc ?? "").match(/https?:\/\/[^\s;]+/g) ?? [];
    expect(hosts).toEqual([ORIGIN]);
  });

  it("does not allow remote image loads, which would be an exfiltration channel", () => {
    const imgSrc = csp.split("; ").find((d) => d.startsWith("img-src")) ?? "";
    const hosts = imgSrc.match(/https?:\/\/[^\s;]+/g) ?? [];
    expect(hosts).toEqual([ORIGIN]);
  });

  it("blocks form submission and plugin content", () => {
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
  });
});

describe("withCsp", () => {
  it("inserts the policy immediately after an existing <head>", () => {
    const out = withCsp("<html><head><title>t</title></head><body>x</body></html>", ORIGIN);
    expect(out).toMatch(/<head><meta http-equiv="Content-Security-Policy"/);
    // The policy must precede anything the document could execute.
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf("<title>"));
  });

  it("synthesizes a head when the document has <html> but no <head>", () => {
    const out = withCsp("<html><body><script>1</script></body></html>", ORIGIN);
    expect(out).toContain("<head><meta http-equiv=");
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf("<script>"));
  });

  it("wraps a bare fragment", () => {
    const out = withCsp("<div>hi</div>", ORIGIN);
    expect(out.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(out).toContain("<div>hi</div>");
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf("<div>"));
  });

  it("is case-insensitive about the head tag and tolerates attributes", () => {
    const out = withCsp('<HTML><HEAD lang="en"><script>1</script></HEAD></HTML>', ORIGIN);
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf("<script>"));
  });
});

describe("buildReactDoc", () => {
  const doc = buildReactDoc("export default function App(){return <p>hi</p>}", ORIGIN);

  it("loads the runtime from Atlas, not a third-party CDN", () => {
    expect(doc).toContain(`${ORIGIN}/artifact-runtime/react.js`);
    expect(doc).not.toContain("unpkg.com");
    expect(doc).not.toContain("cdn.jsdelivr.net");
  });

  it("omits crossorigin, which would fail from an opaque origin", () => {
    expect(doc).not.toContain("crossorigin");
  });

  it("carries the CSP", () => {
    expect(doc).toContain("Content-Security-Policy");
  });

  it("keeps `export default function App` as a named declaration", () => {
    // The renderer finds it via `typeof App !== 'undefined'`, so the name must
    // survive; only the `export default` keywords are stripped.
    expect(doc).toContain("function App()");
    expect(doc).not.toMatch(/export\s+default/);
  });

  it("binds an expression-form default export to the lookup global", () => {
    const expr = buildReactDoc("const C=()=>null; export default C;", ORIGIN);
    expect(expr).toContain("window.__ATLAS_DEFAULT__ = C;");
  });

  it("strips bare import statements that would throw in a classic script", () => {
    const withImport = buildReactDoc('import x from "y";\nconst App=()=>null;', ORIGIN);
    expect(withImport).not.toMatch(/^\s*import\s.+from/m);
  });
});

describe("docFor", () => {
  const make = (type: Artifact["type"], code = "<p>x</p>"): Artifact => ({
    type,
    lang: type,
    code,
    title: "t",
  });

  it("returns a CSP-bearing document for every executable type", () => {
    for (const t of ["html", "svg", "react"] as const) {
      const out = docFor(make(t), ORIGIN);
      expect(out, t).not.toBe("");
      expect(out, t).toContain("Content-Security-Policy");
    }
  });

  it("returns empty for types that are not rendered in a frame", () => {
    for (const t of ["markdown", "code", "mermaid"] as const) {
      expect(docFor(make(t), ORIGIN), t).toBe("");
    }
  });

  it("agrees with isExecutable", () => {
    for (const t of ["html", "svg", "react", "markdown", "code", "mermaid"] as const) {
      expect(docFor(make(t), ORIGIN) !== "", t).toBe(isExecutable(t));
    }
  });
});

// ── Pinned runtime set (spec §4) ────────────────────────────────────────────
// Loaded conditionally: the full set is several megabytes, so a small component
// must not pay for libraries it never mentions.

/**
 * The shim bundle is the one unconditional tag, so "loaded nothing" now means
 * "loaded nothing but the shims" — see `optionalLibTags`. Asserted through this
 * helper rather than by matching the whole string, so a future addition to the
 * always-on set does not have to touch every case below.
 */
const detected = (code: string) =>
  optionalLibTags(code, ORIGIN)
    .split("\n")
    .filter((l) => l.trim() && !l.includes("atlas-shims.js"));

describe("optionalLibTags", () => {
  it("always loads the shim bundle", () => {
    // It carries the `window.react` alias lucide-react's UMD reads at parse
    // time, so it cannot be conditional on anything.
    expect(optionalLibTags("", ORIGIN)).toContain("/artifact-runtime/atlas-shims.js");
  });

  it("loads the shims before any detected library", () => {
    // lucide-react resolves React when its script parses, so a shim tag emitted
    // after it would be too late and every icon would throw.
    const tags = optionalLibTags("lucide", ORIGIN);
    expect(tags.indexOf("atlas-shims.js")).toBeLessThan(tags.indexOf("lucide-react.js"));
  });

  it("loads no library for code that references none", () => {
    expect(detected("const App = () => <p>hi</p>;")).toEqual([]);
  });

  it("loads only the library that is referenced", () => {
    const tags = optionalLibTags("d3.select('svg').append('g');", ORIGIN);
    expect(tags).toContain("/artifact-runtime/d3.js");
    expect(tags).not.toContain("three.js");
    expect(tags).not.toContain("recharts.js");
  });

  it("loads several when several are referenced", () => {
    const tags = optionalLibTags("Papa.parse(csv); THREE.Scene();", ORIGIN);
    expect(tags).toContain("papaparse.js");
    expect(tags).toContain("three.js");
  });

  it("detects Recharts from JSX chart elements, not just the global", () => {
    expect(optionalLibTags("<LineChart data={d} />", ORIGIN)).toContain("recharts.js");
  });

  it("serves every library from Atlas's own origin", () => {
    const all = RUNTIME_LIBS.map((l) => l.file).join(" ");
    const tags = optionalLibTags(`d3. THREE. Papa. math.evaluate( Recharts lucide ${all}`, ORIGIN);
    const hosts = tags.match(/https?:\/\/[^/]+/g) ?? [];
    expect(new Set(hosts)).toEqual(new Set([ORIGIN]));
  });

  it("does not match a bare word that merely contains a library name", () => {
    // "dashboard" contains "d3"? no — but "mathematics" must not pull mathjs.
    expect(detected("const mathematics = 1;")).toEqual([]);
  });

  it("detects framer-motion from the specifier and from the motion global", () => {
    expect(optionalLibTags(`import { motion } from "framer-motion";`, ORIGIN)).toContain(
      "framer-motion.js",
    );
    expect(optionalLibTags("<motion.div animate={{x:1}} />", ORIGIN)).toContain("framer-motion.js");
    expect(detected("const emotion = 1;")).toEqual([]);
  });
});

describe("runtime wiring in generated documents", () => {
  it("puts babel after the optional libraries so they exist at transpile time", () => {
    const doc = buildReactDoc("const A = () => { d3.select('x'); return null; };", ORIGIN);
    expect(doc.indexOf("d3.js")).toBeLessThan(doc.indexOf("babel.js"));
  });

  it("gives plain HTML artifacts the same libraries", () => {
    const doc = docFor(
      { type: "html", lang: "html", code: "<script>d3.select('b')</script>", title: "t" },
      ORIGIN,
    );
    expect(doc).toContain("/artifact-runtime/d3.js");
  });

  it("injects extra head markup after the CSP", () => {
    const doc = docFor({ type: "html", lang: "html", code: "<p>x</p>", title: "t" }, ORIGIN, "<!--SHIM-->");
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("<!--SHIM-->"));
  });
});

// Tailwind is the one detector that must not fire on a false positive: v4 ships
// preflight, so loading it onto a page with its own CSS resets that page.
describe("usesTailwind", () => {
  it("detects a Tailwind page", () => {
    expect(
      usesTailwind(
        '<div class="flex items-center justify-between px-6 py-4"><h1 class="text-4xl font-bold">Hi</h1></div>',
      ),
    ).toBe(true);
  });

  it("detects Tailwind in JSX className, including template and brace forms", () => {
    expect(usesTailwind('<div className="mx-auto max-w-3xl rounded-lg bg-slate-900" />')).toBe(true);
    expect(usesTailwind("<div className={`grid gap-4 p-8 md:grid-cols-2`} />")).toBe(true);
  });

  it("does not fire on hand-written class names", () => {
    expect(usesTailwind('<div class="hero"><p class="lead subtitle">x</p></div>')).toBe(false);
  });

  it("does not fire on one incidental utility-looking class", () => {
    expect(usesTailwind('<div class="site-header block">x</div>')).toBe(false);
  });

  it("does not fire on CSS that merely contains the same words", () => {
    expect(usesTailwind(".card { display: flex; gap: 1rem; padding: 2rem; }")).toBe(false);
  });

  it("is wired into the runtime set so a Tailwind page gets the compiler", () => {
    const tags = optionalLibTags('<div class="flex gap-4 p-8">x</div>', ORIGIN);
    expect(tags).toContain("/artifact-runtime/tailwind.js");
    expect(detected('<div class="hero">x</div>')).toEqual([]);
  });
});
