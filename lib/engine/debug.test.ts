import { describe, expect, it } from "vitest";
import { debugProtocol, hasDebugMarkers, nextStrategy, parseStackTrace } from "./debug";

describe("parseStackTrace", () => {
  it("parses V8/node frames with and without function names", () => {
    const frames = parseStackTrace(
      `Error: expected 3
    at divide (lib/math.js:12:9)
    at Object.<anonymous> (test.js:4:1)
    at node:internal/modules/cjs/loader:1105:14`,
    );
    expect(frames[0]).toMatchObject({ file: "lib/math.js", line: 12, column: 9, fn: "divide" });
    expect(frames[1]).toMatchObject({ file: "test.js", line: 4 });
    // internal noise sorts last
    expect(frames[frames.length - 1].file).toContain("node:internal");
  });

  it("parses vitest arrow frames", () => {
    const frames = parseStackTrace(
      ` FAIL  src/math.test.ts > divide
 ❯ src/math.test.ts:14:23`,
    );
    expect(frames[0]).toMatchObject({ file: "src/math.test.ts", line: 14, column: 23 });
  });

  it("parses python tracebacks", () => {
    const frames = parseStackTrace(
      `Traceback (most recent call last):
  File "main.py", line 7, in compute
ZeroDivisionError: division by zero`,
    );
    expect(frames[0]).toMatchObject({ file: "main.py", line: 7, fn: "compute" });
  });

  it("dedupes repeated frames and sorts node_modules last", () => {
    const frames = parseStackTrace(
      `at run (node_modules/lib/index.js:1:1)
at fn (src/a.js:2:2)
at fn (src/a.js:2:2)`,
    );
    expect(frames).toHaveLength(2);
    expect(frames[0].file).toBe("src/a.js");
  });

  it("returns empty for prose without frames", () => {
    expect(parseStackTrace("Tests failed: 1 of 3")).toEqual([]);
  });
});

describe("nextStrategy ladder", () => {
  it("escalates minimal → instrument → broaden → bisect → ask", () => {
    expect(nextStrategy(0, true)).toBe("minimal_fix");
    expect(nextStrategy(1, true)).toBe("instrument");
    expect(nextStrategy(2, true)).toBe("broaden");
    expect(nextStrategy(3, true)).toBe("bisect");
    expect(nextStrategy(3, false)).toBe("ask_user");
    expect(nextStrategy(9, false)).toBe("ask_user");
  });
});

describe("debugProtocol", () => {
  it("includes stack frames and the ladder guidance", () => {
    const { strategy, prompt } = debugProtocol(
      "at divide (lib/math.js:12:9)",
      0,
      true,
    );
    expect(strategy).toBe("minimal_fix");
    expect(prompt).toContain("lib/math.js:12");
    expect(prompt).toContain("SMALLEST fix");
    expect(prompt).toContain("NEIGHBORING tests");
  });

  it("instrument level demands the ATLAS-DEBUG marker", () => {
    const { prompt } = debugProtocol("no frames here", 1, false);
    expect(prompt).toContain("ATLAS-DEBUG");
    expect(prompt).toContain("reproduce the failure");
  });
});

describe("hasDebugMarkers", () => {
  it("detects leftover instrumentation", () => {
    expect(hasDebugMarkers('console.log("x") // ATLAS-DEBUG')).toBe(true);
    expect(hasDebugMarkers("clean code")).toBe(false);
  });
});
