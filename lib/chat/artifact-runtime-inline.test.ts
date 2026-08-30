import { describe, it, expect } from "vitest";
import {
  escapeScriptBody,
  inlineRuntimeScripts,
  needsInlineRuntime,
  runtimeFilesIn,
  runtimeUrl,
} from "./artifact-runtime-inline";
import { buildReactDoc, optionalLibTags } from "./artifact-sandbox";

const ORIGIN = "http://localhost:3000";

describe("needsInlineRuntime", () => {
  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://0.0.0.0:8080",
    "http://192.168.1.9:3000",
    "http://10.0.0.4:3000",
    "http://172.16.0.2:3000",
    "http://172.31.255.1:3000",
    "https://mac-studio.local:3000",
  ])("is true for the private origin %s", (origin) => {
    expect(needsInlineRuntime(origin)).toBe(true);
  });

  it.each([
    "https://atlas.example.com",
    "https://llm-atlas.vercel.app",
    "http://203.0.113.9",
    // Just outside the RFC1918 block, so it must not be caught by a loose regex.
    "http://172.32.0.1:3000",
    "http://11.0.0.1",
  ])("is false for the public origin %s", (origin) => {
    expect(needsInlineRuntime(origin)).toBe(false);
  });

  it("treats an origin it cannot parse as public, which is the working path", () => {
    expect(needsInlineRuntime("not-a-url")).toBe(false);
    expect(needsInlineRuntime("")).toBe(false);
  });
});

describe("runtimeFilesIn", () => {
  it("finds the shim a plain page gets", () => {
    expect(runtimeFilesIn(optionalLibTags("<p>hi</p>", ORIGIN))).toEqual(["atlas-shims.js"]);
  });

  it("reads a React document's whole runtime set in load order", () => {
    const doc = buildReactDoc("const App = () => <Motion.div/>;", ORIGIN);
    const files = runtimeFilesIn(doc);
    // Shims first: lucide-react reads `window.react` at parse time.
    expect(files[0]).toBe("react.js");
    expect(files).toContain("atlas-shims.js");
    expect(files).toContain("babel.js");
    expect(files.indexOf("atlas-shims.js")).toBeLessThan(files.indexOf("babel.js"));
  });

  it("ignores scripts that are not the vendored runtime", () => {
    expect(runtimeFilesIn('<script src="https://cdn.example.com/x.js"></script>')).toEqual([]);
    expect(runtimeFilesIn("<script>const a = 1;</script>")).toEqual([]);
  });

  it("does not repeat a file linked twice", () => {
    const twice = optionalLibTags("<p>a</p>", ORIGIN) + optionalLibTags("<p>b</p>", ORIGIN);
    expect(runtimeFilesIn(twice)).toEqual(["atlas-shims.js"]);
  });
});

describe("escapeScriptBody", () => {
  // babel.js really does contain this, so an unescaped splice truncates the tag
  // and spills three megabytes of bundle into the page as visible text.
  it("neutralises a closing script tag inside the code", () => {
    const out = escapeScriptBody('var msg = "</script>";');
    expect(out).not.toContain("</script");
    expect(out).toBe('var msg = "<\\/script>";');
  });

  it("is case-insensitive", () => {
    expect(escapeScriptBody("x = '</SCRIPT>'")).not.toMatch(/<\/script/i);
  });

  it("leaves ordinary code alone", () => {
    expect(escapeScriptBody("const a = 1 < 2;")).toBe("const a = 1 < 2;");
  });
});

describe("inlineRuntimeScripts", () => {
  const doc = `<head>${optionalLibTags("<p>hi</p>", ORIGIN)}</head>`;

  it("replaces a linked tag with the file's code", () => {
    const out = inlineRuntimeScripts(doc, new Map([["atlas-shims.js", "window.AtlasShims = {};"]]));
    expect(out).not.toContain("src=");
    expect(out).toContain("window.AtlasShims = {};");
    expect(out).toContain('data-atlas-runtime="atlas-shims.js"');
  });

  it("escapes the body it splices in", () => {
    const out = inlineRuntimeScripts(doc, new Map([["atlas-shims.js", 'a="</script>"']]));
    // Exactly one real closing tag: the one that ends the block we wrote.
    expect(out.match(/<\/script>/g)).toHaveLength(1);
  });

  it("keeps the linked tag for a file it was not given", () => {
    const out = inlineRuntimeScripts(doc, new Map([["react.js", "//"]]));
    expect(out).toContain(`${ORIGIN}/artifact-runtime/atlas-shims.js`);
  });

  it("returns the document unchanged when there is nothing to inline", () => {
    const plain = "<head><script>const a=1;</script></head>";
    expect(inlineRuntimeScripts(plain, new Map([["react.js", "//"]]))).toBe(plain);
    expect(inlineRuntimeScripts(doc, new Map())).toBe(doc);
  });

  it("is idempotent", () => {
    const sources = new Map([["atlas-shims.js", "window.AtlasShims = {};"]]);
    const once = inlineRuntimeScripts(doc, sources);
    expect(inlineRuntimeScripts(once, sources)).toBe(once);
  });

  it("inlines every tag of a React document", () => {
    const react = buildReactDoc("const App = () => <div/>;", ORIGIN);
    const sources = new Map(runtimeFilesIn(react).map((f) => [f, `/* ${f} */`]));
    const out = inlineRuntimeScripts(react, sources);
    expect(out).not.toContain("/artifact-runtime/");
    for (const f of sources.keys()) expect(out).toContain(`/* ${f} */`);
  });
});

describe("runtimeUrl", () => {
  it("builds the path the loader fetches", () => {
    expect(runtimeUrl(ORIGIN, "react.js")).toBe("http://localhost:3000/artifact-runtime/react.js");
  });
});
