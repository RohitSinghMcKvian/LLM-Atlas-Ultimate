import { describe, it, expect } from "vitest";
import * as Babel from "@babel/standalone";
import {
  GLOBALS,
  bundleModules,
  moduleOrder,
  resolveRelative,
  resolveSpecifier,
  inlineHtmlAssets,
  isHtmlEntry,
  scanImports,
  type FileMap,
  type Transform,
} from "./artifact-bundle";

/**
 * The multi-file bundler.
 *
 * `buildReactDoc` used to delete every import line, so a project of more than
 * one file could not render. The risk in replacing that is subtler than "does it
 * work": a hand-rolled import rewriter looks correct until it meets a default
 * export, a cycle, or two files that both declare `Button`. These tests are
 * mostly about those cases.
 *
 * The real Babel is used rather than a stub — the whole argument for this design
 * is that Babel's CommonJS interop handles the hard parts, and a stub would test
 * the wiring while assuming away the thing being relied on.
 */
const transform = Babel.transform as unknown as Transform;

const files = (o: Record<string, string>): FileMap => new Map(Object.entries(o));

/** Run a bundle in a minimal fake DOM and return what it rendered. */
function run(bundle: string): { rendered: unknown; error?: string } {
  const registry: Record<string, unknown> = {};
  let rendered: unknown;
  const root = {
    children: [] as unknown[],
    hasChildNodes() {
      return this.children.length > 0;
    },
  };
  const win: Record<string, unknown> = {
    React: {
      createElement: (type: unknown, props: unknown, ...kids: unknown[]) => ({ type, props, kids }),
    },
    ReactDOM: {
      createRoot: () => ({
        render: (el: unknown) => {
          rendered = el;
        },
      }),
    },
    document: { getElementById: () => root },
  };
  win.window = win;
  const fn = new Function("window", "document", "React", "ReactDOM", "registry", bundle);
  try {
    fn(win, win.document, win.React, win.ReactDOM, registry);
  } catch (e) {
    return { rendered, error: (e as Error).message };
  }
  return { rendered };
}

describe("resolveRelative", () => {
  it.each([
    ["App.jsx", "./Nav", "Nav"],
    ["src/App.jsx", "./Nav", "src/Nav"],
    ["src/pages/Home.jsx", "../Nav", "src/Nav"],
    ["src/pages/Home.jsx", "../../Nav", "Nav"],
    ["src/App.jsx", "./a/../b", "src/b"],
  ])("%s + %s = %s", (from, spec, want) => {
    expect(resolveRelative(from, spec)).toBe(want);
  });
});

describe("resolveSpecifier", () => {
  const f = files({ "src/Nav.jsx": "", "src/util/index.ts": "", "styles.css": "" });

  it("finds a file by trying the usual extensions", () => {
    expect(resolveSpecifier("src/App.jsx", "./Nav", f)).toBe("src/Nav.jsx");
    expect(resolveSpecifier("src/App.jsx", "./Nav.jsx", f)).toBe("src/Nav.jsx");
  });

  it("finds a directory index", () => {
    expect(resolveSpecifier("src/App.jsx", "./util", f)).toBe("src/util/index.ts");
  });

  it("returns null for a bare specifier, which is a global not a file", () => {
    expect(resolveSpecifier("src/App.jsx", "react", f)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(resolveSpecifier("src/App.jsx", "./Nope", f)).toBeNull();
  });
});

describe("scanImports", () => {
  it("finds every import form a model actually writes", () => {
    const found = scanImports(`
      import React from "react";
      import { a, b } from './a';
      import './styles.css';
      export { c } from "./c";
      const d = await import("./d");
      const e = require("./e");
    `);
    expect(found.sort()).toEqual(["./a", "./c", "./d", "./e", "./styles.css", "react"].sort());
  });

  it("de-duplicates", () => {
    expect(scanImports(`import a from "./x"; import b from "./x";`)).toEqual(["./x"]);
  });
});

describe("moduleOrder", () => {
  it("emits dependencies before dependents", () => {
    const f = files({
      "App.jsx": `import Nav from "./Nav";`,
      "Nav.jsx": `import Logo from "./Logo";`,
      "Logo.jsx": `export default function Logo(){}`,
    });
    expect(moduleOrder("App.jsx", f).order).toEqual(["Logo.jsx", "Nav.jsx", "App.jsx"]);
  });

  it("reports an unresolved relative import", () => {
    const f = files({ "App.jsx": `import X from "./Missing";` });
    expect(moduleOrder("App.jsx", f).missing).toEqual([{ from: "App.jsx", spec: "./Missing" }]);
  });

  it("reports an unknown bare specifier but accepts a vendored one", () => {
    const f = files({ "App.jsx": `import React from "react"; import x from "left-pad";` });
    expect(moduleOrder("App.jsx", f).missing).toEqual([{ from: "App.jsx", spec: "left-pad" }]);
  });

  // A cycle is normal in a component graph and must not hang the walk.
  it("terminates on a cycle and visits both modules", () => {
    const f = files({
      "a.jsx": `import b from "./b"; export default 1;`,
      "b.jsx": `import a from "./a"; export default 2;`,
    });
    const { order } = moduleOrder("a.jsx", f);
    expect(order).toContain("a.jsx");
    expect(order).toContain("b.jsx");
  });
});

describe("bundleModules", () => {
  it("errors when the entry does not exist", () => {
    const r = bundleModules("missing.jsx", files({}), transform);
    expect(r.errors[0]).toContain("not found");
    expect(r.code).toBe("");
  });

  it("surfaces an unresolved import instead of producing a broken bundle", () => {
    const r = bundleModules("App.jsx", files({ "App.jsx": `import X from "./Nope";` }), transform);
    expect(r.errors.join()).toContain('cannot resolve import "./Nope"');
  });

  it("surfaces a syntax error with the file that caused it", () => {
    const r = bundleModules("App.jsx", files({ "App.jsx": `export default function ( {` }), transform);
    expect(r.errors.join()).toContain("App.jsx");
  });

  it("refuses a project past the size ceiling rather than hanging", () => {
    const r = bundleModules("App.jsx", files({ "App.jsx": "x".repeat(3 * 1024 * 1024) }), transform);
    expect(r.errors.join()).toContain("bundling limit");
    expect(r.code).toBe("");
  });

  it("collects CSS imports and still resolves the module", () => {
    const r = bundleModules(
      "App.jsx",
      files({
        "App.jsx": `import "./a.css"; export default function App(){ return null; }`,
        "a.css": `body { color: red }`,
      }),
      transform,
    );
    expect(r.errors).toEqual([]);
    expect(r.css).toContain("color: red");
  });

  it("names the available modules when a bare specifier is unresolved", () => {
    const r = bundleModules("App.jsx", files({ "App.jsx": `import gsap from "gsap";` }), transform);
    // Without the list, a repair attempt reaches for another animation library
    // that also is not there. With it, the fix is obvious on the first try.
    expect(r.errors.join()).toContain('cannot resolve import "gsap"');
    expect(r.errors.join()).toContain("framer-motion");
    expect(r.errors.join()).toContain("no npm");
  });

  it("keeps a relative miss short — the module list is irrelevant to it", () => {
    const r = bundleModules("App.jsx", files({ "App.jsx": `import X from "./Nope";` }), transform);
    expect(r.errors.join()).not.toContain("framer-motion");
  });
});

/**
 * The imports that a real generated page actually contains.
 *
 * Every specifier here was a fatal `cannot resolve import` that stopped the whole
 * bundle, so a landing page asking for an animation library and an icon — which
 * is to say, most landing pages — rendered nothing at all. They are asserted as
 * one case because that is how they arrive: one file, several imports, and the
 * first miss is enough to blank the page.
 */
describe("the vendored and shimmed module set", () => {
  const NAVIGATION = `
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Orbitron } from "next/font/google";
import { motion } from "framer-motion";
import { Rocket, Menu } from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

export default function Navigation() {
  const router = useRouter();
  return <nav className={twMerge("flex", "px-2 px-4")}><Rocket /><Menu /><Link href="/">Home</Link></nav>;
}
`;

  it("resolves every specifier a generated Next-shaped page uses", () => {
    const r = bundleModules("src/app/components/Navigation.tsx", files({
      "src/app/components/Navigation.tsx": NAVIGATION,
    }), transform);
    expect(r.errors).toEqual([]);
    expect(r.code).not.toBe("");
  });

  it("resolves lucide-react to the global its UMD actually exposes", () => {
    // `GLOBALS` said `lucide`; the vendored bundle's banner is `a.LucideReact={}`.
    // So this passed the build-time check and then threw "Cannot resolve module
    // 'lucide-react'" at runtime, which read as a model error rather than ours.
    expect(GLOBALS["lucide-react"]).toBe("LucideReact");
  });

  it("points framer-motion at the UMD global and not at a file", () => {
    expect(GLOBALS["framer-motion"]).toBe("Motion");
  });

  it("routes the shimmed specifiers through one dotted global", () => {
    // `__resolveGlobal` walks the dots, so nine shims cost one global rather
    // than nine. If this regresses to a bare name the registry silently returns
    // undefined and the import resolves to `{ default: undefined }`.
    for (const spec of ["next/link", "next/image", "clsx", "tailwind-merge"]) {
      expect(GLOBALS[spec]).toMatch(/^AtlasShims\./);
    }
  });
});

/**
 * The behaviours a regex rewriter gets wrong. Each of these runs the assembled
 * bundle, so they test the registry semantics rather than the generated text.
 */
describe("assembled bundle semantics", () => {
  it("renders a default-exported entry component", () => {
    const r = bundleModules(
      "App.jsx",
      files({ "App.jsx": `export default function App(){ return "hi"; }` }),
      transform,
    );
    expect(r.errors).toEqual([]);
    const { rendered, error } = run(r.code);
    expect(error).toBeUndefined();
    expect(rendered).toBeTruthy();
  });

  it("wires a named import across files", () => {
    const r = bundleModules(
      "App.jsx",
      files({
        "App.jsx": `import { label } from "./util"; export default function App(){ return label; }`,
        "util.js": `export const label = "from-util";`,
      }),
      transform,
    );
    expect(r.errors).toEqual([]);
    const { error } = run(r.code);
    expect(error).toBeUndefined();
    expect(r.code).toContain('"util.js"');
  });

  // Two files declaring the same name is the case that breaks flat concatenation.
  it("keeps identically-named declarations in separate scopes", () => {
    const r = bundleModules(
      "App.jsx",
      files({
        "App.jsx": `import A from "./a"; import B from "./b"; const Button = 0; export default function App(){ return [A, B, Button]; }`,
        "a.js": `const Button = "a"; export default Button;`,
        "b.js": `const Button = "b"; export default Button;`,
      }),
      transform,
    );
    expect(r.errors).toEqual([]);
    const { error } = run(r.code);
    expect(error).toBeUndefined();
  });

  // Same basename in two directories must not collide in the registry.
  it("distinguishes two files with the same name in different directories", () => {
    const r = bundleModules(
      "App.jsx",
      files({
        "App.jsx": `import X from "./one/Card"; import Y from "./two/Card"; export default function App(){ return [X, Y]; }`,
        "one/Card.jsx": `export default "one";`,
        "two/Card.jsx": `export default "two";`,
      }),
      transform,
    );
    expect(r.errors).toEqual([]);
    expect(r.code).toContain('"one/Card.jsx"');
    expect(r.code).toContain('"two/Card.jsx"');
    expect(run(r.code).error).toBeUndefined();
  });

  it("resolves a circular import the way CommonJS does, without recursing", () => {
    const r = bundleModules(
      "a.js",
      files({
        "a.js": `import { b } from "./b"; export const a = "a"; export default function App(){ return b; }`,
        "b.js": `import { a } from "./a"; export const b = "b";`,
      }),
      transform,
    );
    expect(r.errors).toEqual([]);
    const { error } = run(r.code);
    expect(error).toBeUndefined();
  });

  it("maps a bare specifier onto the vendored global", () => {
    const r = bundleModules(
      "App.jsx",
      files({ "App.jsx": `import React from "react"; export default function App(){ return React; }` }),
      transform,
    );
    expect(r.errors).toEqual([]);
    expect(run(r.code).error).toBeUndefined();
  });

  // The error has to reach the artifact error channel, where "Fix these" works.
  it("throws a named error at runtime for a module that was never registered", () => {
    const r = bundleModules("App.jsx", files({ "App.jsx": `export default function App(){}` }), transform);
    const bundle = `${r.code}\nwindow.__atlas_require("ghost.js");`;
    expect(run(bundle).error).toContain("Cannot resolve module 'ghost.js'");
  });
});

/**
 * HTML entries take the other path.
 *
 * A landing page split into markup + stylesheet + script is not a module graph.
 * Sending it through Babel parses markup as JavaScript and fails with a syntax
 * error nobody expects, so the entry type decides which job runs.
 */
describe("inlineHtmlAssets", () => {
  const page = (body: string) => `<!DOCTYPE html><html><head>${body}</head><body><h1>Hi</h1></body></html>`;

  it("inlines a relative stylesheet", () => {
    const f = files({
      "index.html": page(`<link rel="stylesheet" href="./styles.css">`),
      "styles.css": "body{margin:0}",
    });
    const { html, errors } = inlineHtmlAssets("index.html", f);
    expect(errors).toEqual([]);
    expect(html).toContain("<style");
    expect(html).toContain("body{margin:0}");
    expect(html).not.toContain("<link");
  });

  it("inlines a relative script and keeps its type", () => {
    const f = files({
      "index.html": page(`<script type="module" src="./app.js"></script>`),
      "app.js": "console.log(1)",
    });
    const { html, errors } = inlineHtmlAssets("index.html", f);
    expect(errors).toEqual([]);
    expect(html).toContain("console.log(1)");
    expect(html).toContain('type="module"');
    expect(html).not.toContain("src=");
  });

  it("resolves a bare relative href with no leading ./", () => {
    const f = files({ "index.html": page(`<link rel="stylesheet" href="styles.css">`), "styles.css": "a{}" });
    expect(inlineHtmlAssets("index.html", f).html).toContain("a{}");
  });

  it("resolves across directories", () => {
    const f = files({
      "index.html": page(`<link rel="stylesheet" href="./css/main.css">`),
      "css/main.css": "h1{}",
    });
    expect(inlineHtmlAssets("index.html", f).html).toContain("h1{}");
  });

  // An absolute URL is the CSP's problem, and it already reports it visibly.
  it("leaves an absolute URL alone", () => {
    const f = files({ "index.html": page(`<link rel="stylesheet" href="https://cdn.example/x.css">`) });
    const { html, errors } = inlineHtmlAssets("index.html", f);
    expect(errors).toEqual([]);
    expect(html).toContain("https://cdn.example/x.css");
  });

  it("reports a missing asset instead of silently dropping it", () => {
    const f = files({ "index.html": page(`<link rel="stylesheet" href="./gone.css">`) });
    expect(inlineHtmlAssets("index.html", f).errors.join()).toContain("gone.css");
  });

  it("errors when the entry itself is missing", () => {
    expect(inlineHtmlAssets("nope.html", files({})).errors.join()).toContain("not found");
  });

  it("leaves a page with no assets untouched", () => {
    const f = files({ "index.html": page("") });
    expect(inlineHtmlAssets("index.html", f).html).toBe(page(""));
  });
});

describe("isHtmlEntry", () => {
  it("routes markup to inlining and modules to bundling", () => {
    expect(isHtmlEntry("index.html")).toBe(true);
    expect(isHtmlEntry("page.htm")).toBe(true);
    expect(isHtmlEntry("App.jsx")).toBe(false);
    expect(isHtmlEntry("main.ts")).toBe(false);
  });
});
