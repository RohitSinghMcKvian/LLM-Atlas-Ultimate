import { describe, expect, it } from "vitest";
import { describeFailures, detectChecks, runChecks } from "./verify";

const pkg = (o: object) => JSON.stringify(o);

describe("detectChecks", () => {
  it("detects the full ladder from a Next-style package.json", () => {
    const checks = detectChecks(
      pkg({
        scripts: {
          typecheck: "tsc --noEmit",
          lint: "next lint",
          test: "vitest run",
          build: "next build",
        },
      }),
      [],
    );
    expect(checks.map((c) => c.check)).toEqual(["typecheck", "lint", "unit", "build"]);
    expect(checks.map((c) => c.command)).toEqual([
      "npm run typecheck",
      "npm run lint",
      "npm test",
      "npm run build",
    ]);
  });

  it("falls back to npx tsc for TypeScript projects without a typecheck script", () => {
    const checks = detectChecks(
      pkg({ scripts: {}, devDependencies: { typescript: "^5" } }),
      ["tsconfig.json", "index.ts"],
    );
    expect(checks).toEqual([{ check: "typecheck", command: "npx tsc --noEmit" }]);
  });

  it("ignores npm's placeholder test script", () => {
    const checks = detectChecks(
      pkg({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
      [],
    );
    expect(checks).toEqual([]);
  });

  it("uses node test.js when there is no package.json but a test file", () => {
    expect(detectChecks(null, ["index.js", "test.js"])).toEqual([
      { check: "unit", command: "node test.js" },
    ]);
  });

  it("survives malformed package.json", () => {
    expect(detectChecks("{not json", ["a.js"])).toEqual([]);
  });
});

describe("runChecks", () => {
  it("stops at the first failure and caps evidence", async () => {
    const calls: string[] = [];
    const verdicts = await runChecks(
      [
        { check: "typecheck", command: "npm run typecheck" },
        { check: "unit", command: "npm test" },
      ],
      async (cmd) => {
        calls.push(cmd);
        return cmd.includes("typecheck")
          ? { code: 1, output: "x".repeat(5000) }
          : { code: 0, output: "ok" };
      },
    );
    expect(calls).toEqual(["npm run typecheck"]);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].pass).toBe(false);
    expect(verdicts[0].evidence.length).toBeLessThanOrEqual(2000);
  });

  it("treats timeouts as failures with marked evidence", async () => {
    const verdicts = await runChecks(
      [{ check: "build", command: "npm run build" }],
      async () => ({ code: 0, output: "partial", timedOut: true }),
    );
    expect(verdicts[0].pass).toBe(false);
    expect(verdicts[0].evidence).toContain("[timed out]");
  });

  it("runs the whole ladder when everything passes", async () => {
    const verdicts = await runChecks(
      [
        { check: "unit", command: "npm test" },
        { check: "build", command: "npm run build" },
      ],
      async () => ({ code: 0, output: "ok" }),
    );
    expect(verdicts.map((v) => v.pass)).toEqual([true, true]);
  });

  it("converts exec rejections into failed verdicts", async () => {
    const verdicts = await runChecks(
      [{ check: "unit", command: "npm test" }],
      async () => {
        throw new Error("shell unavailable");
      },
    );
    expect(verdicts[0].pass).toBe(false);
    expect(verdicts[0].evidence).toContain("shell unavailable");
  });
});

describe("describeFailures", () => {
  it("renders only failing verdicts", () => {
    const text = describeFailures([
      { check: "unit", command: "npm test", pass: false, evidence: "1 failed", durationMs: 1, ts: 1 },
      { check: "lint", command: "npm run lint", pass: true, evidence: "", durationMs: 1, ts: 1 },
    ]);
    expect(text).toContain('Check "unit" failed');
    expect(text).not.toContain("lint");
  });
});
