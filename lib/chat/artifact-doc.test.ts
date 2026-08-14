import { describe, it, expect } from "vitest";
import * as Babel from "@babel/standalone";
import {
  buildArtifactDoc,
  needsTransform,
  singleFileMap,
  verifyEntryOf,
  verifyTargetOf,
  type ArtifactFileLike,
} from "./artifact-doc";
import type { Transform } from "./artifact-bundle";
import type { Artifact, ArtifactType } from "./artifact-sandbox";

/**
 * The shared document builder.
 *
 * Two things are being pinned here. The first is the single-file fix: a lone
 * component used to render with every `import … from` line deleted, so
 * `import { Rocket } from "lucide-react"` left `Rocket` undeclared and the page
 * died with an error that read as the model's fault.
 *
 * The second is fidelity, and it is the more important of the two. A verifier
 * that builds its own document is not checking what the user sees; it is
 * checking a lookalike, and every verdict it returns is fiction. The test at the
 * bottom of this file is what stops that, so it is load-bearing rather than
 * coverage.
 */
const transform = Babel.transform as unknown as Transform;
const ORIGIN = "https://atlas.test";

const art = (type: ArtifactType, code: string): Artifact => ({
  type,
  lang: type,
  code,
  title: "t",
});

const file = (
  path: string,
  code: string,
  type: ArtifactType,
  complete?: boolean,
): ArtifactFileLike => ({ path, versions: [{ code, type, complete }] });

describe("needsTransform", () => {
  it("is false for markup, svg and prose", () => {
    expect(needsTransform("index.html", "html", 3)).toBe(false);
    expect(needsTransform("image.svg", "svg", 1)).toBe(false);
    expect(needsTransform("report.md", "document", 1)).toBe(false);
    expect(needsTransform("notes.md", "markdown", 1)).toBe(false);
  });

  it("is false for a lone HTML artifact whose path is not .html", () => {
    // The unnamed single artifact predates paths and carries a default one.
    expect(needsTransform("artifact", "html", 1)).toBe(false);
  });

  it("is true for a module entry", () => {
    expect(needsTransform("App.jsx", "react", 1)).toBe(true);
    expect(needsTransform("src/app/page.tsx", "react", 9)).toBe(true);
  });
});

describe("single-file artifacts go through the bundler", () => {
  const WITH_ICONS = `
import { Rocket } from "lucide-react";
export default function App() { return <div><Rocket /></div>; }
`;

  it("keeps an import instead of deleting the line", () => {
    // The regression this whole phase exists for. The old path filtered out
    // every `import … from` line, so the name was simply gone.
    const r = buildArtifactDoc({
      files: singleFileMap("App.jsx", WITH_ICONS),
      entry: "App.jsx",
      artifact: art("react", WITH_ICONS),
      origin: ORIGIN,
      transform,
    });
    expect(r.errors).toEqual([]);
    expect(r.mode).toBe("module");
    expect(r.doc).toContain("__atlas_require");
    expect(r.doc).toContain("lucide-react");
  });

  it("reports an unavailable package rather than rendering a blank page", () => {
    const code = `import gsap from "gsap"; export default function App(){ return null; }`;
    const r = buildArtifactDoc({
      files: singleFileMap("App.jsx", code),
      entry: "App.jsx",
      artifact: art("react", code),
      origin: ORIGIN,
      transform,
    });
    expect(r.doc).toBe("");
    expect(r.errors.join()).toContain('cannot resolve import "gsap"');
  });

  it("refuses to build a module graph with no transform", () => {
    const r = buildArtifactDoc({
      files: singleFileMap("App.jsx", "export default () => null;"),
      entry: "App.jsx",
      artifact: art("react", "export default () => null;"),
      origin: ORIGIN,
    });
    expect(r.doc).toBe("");
    expect(r.errors.join()).toContain("no JavaScript transform");
  });
});

describe("markup and svg entries", () => {
  it("inlines a stylesheet a page links to", () => {
    const files = new Map([
      ["index.html", `<html><head><link rel="stylesheet" href="./s.css"></head><body>hi</body></html>`],
      ["s.css", "body{color:red}"],
    ]);
    const r = buildArtifactDoc({
      files,
      entry: "index.html",
      artifact: art("html", files.get("index.html")!),
      origin: ORIGIN,
    });
    expect(r.mode).toBe("html");
    expect(r.errors).toEqual([]);
    expect(r.doc).toContain("color:red");
  });

  it("reports a stylesheet the workspace does not have", () => {
    const files = new Map([
      ["index.html", `<html><head><link rel="stylesheet" href="./missing.css"></head></html>`],
    ]);
    const r = buildArtifactDoc({
      files,
      entry: "index.html",
      artifact: art("html", files.get("index.html")!),
      origin: ORIGIN,
    });
    expect(r.doc).toBe("");
    expect(r.errors.join()).toContain("not found in the workspace");
  });

  it("centres an svg without involving Babel", () => {
    const r = buildArtifactDoc({
      files: singleFileMap("i.svg", "<svg/>"),
      entry: "i.svg",
      artifact: art("svg", "<svg/>"),
      origin: ORIGIN,
    });
    expect(r.mode).toBe("svg");
    expect(r.doc).toContain("place-items:center");
  });

  it("builds nothing for prose", () => {
    const r = buildArtifactDoc({
      files: singleFileMap("r.md", "# Report"),
      entry: "r.md",
      artifact: art("document", "# Report"),
      origin: ORIGIN,
    });
    expect(r).toEqual({ doc: "", errors: [], mode: "none" });
  });
});

describe("the CSP leads every executable document", () => {
  it("puts the policy before any script tag, in every mode", () => {
    const cases: [ArtifactType, string, string][] = [
      ["react", "App.jsx", "export default () => null;"],
      ["html", "index.html", "<html><head></head><body><script>1</script></body></html>"],
      ["svg", "i.svg", "<svg/>"],
    ];
    for (const [type, entry, code] of cases) {
      const r = buildArtifactDoc({
        files: singleFileMap(entry, code),
        entry,
        artifact: art(type, code),
        origin: ORIGIN,
        transform,
      });
      const csp = r.doc.indexOf("Content-Security-Policy");
      const script = r.doc.indexOf("<script");
      expect(csp, type).toBeGreaterThan(-1);
      if (script > -1) expect(csp, type).toBeLessThan(script);
    }
  });
});

describe("verifyEntryOf", () => {
  it("returns nothing for prose, decks and diagrams", () => {
    expect(verifyEntryOf([file("r.md", "# R", "document")])).toBeNull();
    expect(verifyEntryOf([file("d.md", "a", "slides")])).toBeNull();
    expect(verifyEntryOf([file("d.mmd", "graph TD", "mermaid")])).toBeNull();
    expect(verifyEntryOf([file("a.py", "x=1", "code")])).toBeNull();
    expect(verifyEntryOf([])).toBeNull();
  });

  it("picks the page, not the stylesheet", () => {
    const t = verifyEntryOf([
      file("styles.css", "body{}", "code"),
      file("index.html", "<html></html>", "html"),
    ]);
    expect(t?.entry).toBe("index.html");
    // Non-runnable files stay in the map: the page links to them.
    expect(t?.files.has("styles.css")).toBe(true);
  });

  it("refuses a still-streaming artifact", () => {
    // A fence whose closing marker has not arrived is a fragment. Running it
    // would manufacture errors the model did not make.
    expect(verifyEntryOf([file("App.jsx", "export default (", "react", false)])).toBeNull();
  });

  it("takes only the newest version of each file", () => {
    const t = verifyEntryOf([
      {
        path: "App.jsx",
        versions: [
          { code: "v1", type: "react" },
          { code: "v2", type: "react" },
        ],
      },
    ]);
    expect(t?.files.get("App.jsx")).toBe("v2");
  });
});

describe("verifyTargetOf", () => {
  it("names an entry for an artifact that never had a path", () => {
    expect(verifyTargetOf(art("react", "x"))?.entry).toBe("App.jsx");
    expect(verifyTargetOf(art("html", "x"))?.entry).toBe("index.html");
  });

  it("keeps a path the artifact already has", () => {
    expect(verifyTargetOf({ ...art("react", "x"), path: "src/App.tsx" })?.entry).toBe("src/App.tsx");
  });

  it("returns nothing for prose or an incomplete fence", () => {
    expect(verifyTargetOf(art("document", "# x"))).toBeNull();
    expect(verifyTargetOf({ ...art("react", "x"), complete: false })).toBeNull();
  });
});

/**
 * The fidelity guarantee.
 *
 * If the panel and the headless verifier ever build different documents, the
 * verifier is checking something the user will never see and every verdict it
 * produces — including "clean" — is meaningless. Both call `buildArtifactDoc`
 * with identical arguments except `head`, so the only permitted difference
 * between the two documents is that injected markup.
 */
describe("panel and verifier build the same document", () => {
  const CODE = `
import { motion } from "framer-motion";
import { Rocket } from "lucide-react";
export default function App(){ return <motion.div className="flex gap-4"><Rocket/></motion.div>; }
`;
  const PANEL_HEAD = "<script>/*storage+error+print*/</script>";
  const VERIFY_HEAD = "<script>/*stub-storage+error*/</script>";

  const build = (head: string) =>
    buildArtifactDoc({
      files: singleFileMap("App.jsx", CODE),
      entry: "App.jsx",
      artifact: art("react", CODE),
      origin: ORIGIN,
      head,
      transform,
    });

  it("differs only by the injected head", () => {
    const panel = build(PANEL_HEAD);
    const verify = build(VERIFY_HEAD);
    expect(panel.errors).toEqual([]);
    expect(verify.errors).toEqual([]);
    // Remove each document's own head marker; what is left must be identical.
    expect(verify.doc.replace(VERIFY_HEAD, "")).toBe(panel.doc.replace(PANEL_HEAD, ""));
  });

  it("ships the same runtime scripts to both", () => {
    const tags = (d: string) => (d.match(/artifact-runtime\/[\w.-]+/g) ?? []).sort();
    expect(tags(build(VERIFY_HEAD).doc)).toEqual(tags(build(PANEL_HEAD).doc));
    // And the ones this artifact actually needs are among them.
    expect(tags(build(PANEL_HEAD).doc).join()).toContain("framer-motion.js");
    expect(tags(build(PANEL_HEAD).doc).join()).toContain("lucide-react.js");
    expect(tags(build(PANEL_HEAD).doc).join()).toContain("atlas-shims.js");
  });

  it("holds for a multi-file build too", () => {
    const files = new Map([
      ["src/App.jsx", `import Nav from "./Nav"; export default () => <Nav/>;`],
      ["src/Nav.jsx", `export default () => <nav/>;`],
    ]);
    const one = buildArtifactDoc({
      files,
      entry: "src/App.jsx",
      artifact: art("react", files.get("src/App.jsx")!),
      origin: ORIGIN,
      head: PANEL_HEAD,
      transform,
    });
    const two = buildArtifactDoc({
      files,
      entry: "src/App.jsx",
      artifact: art("react", files.get("src/App.jsx")!),
      origin: ORIGIN,
      head: VERIFY_HEAD,
      transform,
    });
    expect(one.errors).toEqual([]);
    expect(two.doc.replace(VERIFY_HEAD, "")).toBe(one.doc.replace(PANEL_HEAD, ""));
  });
});
