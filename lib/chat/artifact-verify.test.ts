import { describe, it, expect, vi } from "vitest";
import * as Babel from "@babel/standalone";
import {
  classifyArtifactError,
  errorSignature,
  triageArtifactErrors,
  verifyArtifact,
  type DocRun,
} from "./artifact-verify";
import { singleFileMap, type VerifyTarget } from "./artifact-doc";
import type { Transform } from "./artifact-bundle";
import type { ArtifactRuntimeError } from "./artifact-bridge";

/**
 * Triage.
 *
 * The whole point of these cases is which of them costs money. `fatal` spends a
 * model turn; `host` and `warning` never do. Getting `host` wrong is the
 * expensive mistake — it bills the user to ask a model to fix a bug in Atlas,
 * which it cannot do, so the loop pays out its full attempt budget every time.
 */
const err = (kind: string, message: string, line?: number): ArtifactRuntimeError => ({
  kind,
  message,
  line,
});
const transform = Babel.transform as unknown as Transform;
const ORIGIN = "https://atlas.test";

const run = (patch: Partial<DocRun> = {}): DocRun => ({
  errors: [],
  timedOut: false,
  aborted: false,
  skipped: false,
  elapsedMs: 10,
  ...patch,
});

describe("classifyArtifactError", () => {
  const cases: [string, ArtifactRuntimeError, "fatal" | "host" | "warning"][] = [
    // The reported failures.
    ["undefined icon", err("error", "Uncaught ReferenceError: Rocket is not defined", 6), "fatal"],
    ["blank page", err("blank", "The artifact rendered nothing: the page body is empty."), "fatal"],
    ["bare script error", err("error", "Script error"), "warning"],

    // Host: the model wrote correct code and Atlas could not run it.
    ["unvendored package", err("error", "Cannot resolve module 'framer-motion'"), "host"],
    ["missing runtime file", err("resource", "Could not load <script> http://x/artifact-runtime/lucide-react.js"), "host"],
    ["wrong global name", err("error", "Uncaught ReferenceError: LucideReact is not defined"), "host"],
    ["react missing", err("error", "React is not defined"), "host"],

    // Crashes.
    ["type error", err("error", "TypeError: Cannot read properties of undefined (reading 'map')"), "fatal"],
    ["not a function", err("error", "x.foo is not a function"), "fatal"],
    ["minified react", err("error", "Minified React error #310"), "fatal"],
    ["hook order", err("error", "Rendered more hooks than during the previous render"), "fatal"],
    ["render loop", err("error", "Maximum update depth exceeded"), "fatal"],
    ["syntax", err("error", "Unexpected token '<'"), "fatal"],
    ["rejection", err("unhandledrejection", "TypeError: fetch failed"), "fatal"],

    // Resources: a script is code the page needs, an image is decoration.
    ["blocked script", err("resource", "Could not load <script> https://cdn.example/x.js"), "fatal"],
    ["blocked stylesheet", err("resource", "Could not load <link> https://cdn.example/x.css"), "fatal"],
    ["broken image", err("resource", "Could not load <img> https://example/photo.png"), "warning"],

    // Console defaults to warning; only an explicit crash signature is fatal.
    ["react boundary", err("console", "The above error occurred in <App>"), "fatal"],
    ["uncaught via console", err("console", "Uncaught Error: boom"), "fatal"],
    ["key warning", err("console", 'Each child in a list should have a unique "key" prop.'), "warning"],
    ["devtools banner", err("console", "Download the React DevTools for a better experience"), "warning"],
    ["dom nesting", err("console", "validateDOMNesting(...): <div> cannot appear as a descendant of <p>"), "warning"],
    ["recharts zero size", err("console", "The width(0) and height(0) of chart should be greater than 0"), "warning"],
    ["unknown console line", err("console", "some library said something"), "warning"],
  ];

  for (const [name, e, expected] of cases) {
    it(`${name} is ${expected}`, () => {
      expect(classifyArtifactError(e)).toBe(expected);
    });
  }

  it("keeps a benign message benign even when it looks like a crash", () => {
    // "is not defined" appears inside React's own key warning text in some
    // versions; the benign list has to win over the fatal patterns.
    expect(classifyArtifactError(err("console", "Warning: ReactDOM.render is no longer supported"))).toBe(
      "warning",
    );
  });
});

describe("bundle errors", () => {
  it("blames the model for a package Atlas never offered", () => {
    const t = triageArtifactErrors([], {
      bundleErrors: ['App.jsx: cannot resolve import "gsap". Artifacts run offline with no npm;'],
    });
    expect(t.fatal).toHaveLength(1);
    expect(t.host).toHaveLength(0);
  });

  it("blames the model for a relative file it never wrote", () => {
    const t = triageArtifactErrors([], { bundleErrors: ['App.jsx: cannot resolve import "./Nav".'] });
    expect(t.fatal).toHaveLength(1);
  });

  it("blames the host for a specifier that is on the list and still failed", () => {
    // In `GLOBALS`, so it should have resolved. That it did not is our bug.
    const t = triageArtifactErrors([], {
      bundleErrors: ['App.jsx: cannot resolve import "framer-motion".'],
    });
    expect(t.host).toHaveLength(1);
    expect(t.fatal).toHaveLength(0);
  });
});

describe("triageArtifactErrors", () => {
  it("treats a hung page as fatal rather than clean", () => {
    // The worst available false pass: reported nothing because it never ran.
    const t = triageArtifactErrors([], { timedOut: true });
    expect(t.fatal).toHaveLength(1);
    expect(t.fatal[0].kind).toBe("timeout");
  });

  it("does not add a timeout error when the page already reported one", () => {
    const t = triageArtifactErrors([err("error", "TypeError: boom")], { timedOut: true });
    expect(t.fatal.filter((e) => e.kind === "timeout")).toHaveLength(0);
  });

  it("collapses duplicates", () => {
    const t = triageArtifactErrors([
      err("error", "TypeError: boom"),
      err("error", "TypeError: boom"),
    ]);
    expect(t.fatal).toHaveLength(1);
  });

  it("keeps host errors out of the fatal set entirely", () => {
    const t = triageArtifactErrors([
      err("error", "Cannot resolve module 'framer-motion'"),
      err("blank", "The artifact rendered nothing: the page body is empty."),
    ]);
    expect(t.host).toHaveLength(1);
    expect(t.fatal).toHaveLength(1);
    expect(t.fatal[0].kind).toBe("blank");
  });

  it("reports every class in messages, including warnings", () => {
    const t = triageArtifactErrors([
      err("error", "TypeError: boom", 12),
      err("console", "Download the React DevTools"),
    ]);
    expect(t.messages).toContain("TypeError: boom (line 12)");
    expect(t.messages.join()).toContain("DevTools");
  });
});

describe("errorSignature", () => {
  it("is stable when a line number moves", () => {
    // A model that adds an import above the bug produces the same failure one
    // line lower. Treating that as a new failure would waste the attempt budget.
    const a = errorSignature([err("error", "Rocket is not defined (line 6)")]);
    const b = errorSignature([err("error", "Rocket is not defined (line 41)")]);
    expect(a).toBe(b);
  });

  it("ignores ordering", () => {
    const a = errorSignature([err("error", "a is not defined"), err("error", "b is not defined")]);
    const b = errorSignature([err("error", "b is not defined"), err("error", "a is not defined")]);
    expect(a).toBe(b);
  });

  it("separates genuinely different failures", () => {
    expect(errorSignature([err("error", "a is not defined")])).not.toBe(
      errorSignature([err("error", "b is not defined")]),
    );
  });

  it("keeps React error numbers, which are the identity", () => {
    expect(errorSignature([err("error", "Minified React error #310")])).not.toBe(
      errorSignature([err("error", "Minified React error #418")]),
    );
  });

  it("is empty for no errors", () => {
    expect(errorSignature([])).toBe("");
  });
});

describe("verifyArtifact", () => {
  const target = (code: string): VerifyTarget => ({
    files: singleFileMap("App.jsx", code),
    entry: "App.jsx",
    artifact: { type: "react", code },
  });
  const input = (code: string) => ({ target: target(code), origin: ORIGIN, head: "", transform });

  it("never runs a document that failed to build", async () => {
    const runner = vi.fn(async () => run());
    const r = await verifyArtifact(input(`import x from "gsap"; export default () => null;`), runner);
    expect(runner).not.toHaveBeenCalled();
    expect(r?.ran).toBe(false);
    expect(r?.fatal).toHaveLength(1);
  });

  it("runs a document that built, and reports it clean", async () => {
    const runner = vi.fn(async () => run());
    const r = await verifyArtifact(input(`export default () => null;`), runner);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(r?.ran).toBe(true);
    expect(r?.fatal).toEqual([]);
  });

  it("passes the built document to the runner", async () => {
    let seen = "";
    await verifyArtifact(input(`export default () => null;`), async (doc) => {
      seen = doc;
      return run();
    });
    expect(seen).toContain("Content-Security-Policy");
    expect(seen).toContain("__atlas_require");
  });

  it("returns null when a run was skipped, so it cannot read as a pass", async () => {
    const r = await verifyArtifact(input(`export default () => null;`), async () =>
      run({ skipped: true }),
    );
    expect(r).toBeNull();
  });

  it("returns null when a run was aborted", async () => {
    const r = await verifyArtifact(input(`export default () => null;`), async () =>
      run({ aborted: true }),
    );
    expect(r).toBeNull();
  });

  it("carries a timeout through to a fatal verdict", async () => {
    const r = await verifyArtifact(input(`export default () => null;`), async () =>
      run({ timedOut: true }),
    );
    expect(r?.fatal[0].kind).toBe("timeout");
  });
});
