import { describe, expect, it } from "vitest";
import { describeSecretBlock, scanSecrets, shouldScanPath } from "./security";

describe("scanSecrets", () => {
  it("detects an AWS access key id", () => {
    const f = scanSecrets("const k = 'AKIAIOSFODNN7EXAMPLE';");
    expect(f[0].kind).toContain("AWS access key");
    expect(f[0].excerpt).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(f[0].excerpt).toContain("…");
  });

  it("detects OpenAI/Atlas and Anthropic keys", () => {
    expect(scanSecrets("sk-proj-abcdefghijklmnopqrstuvwxyz123456").length).toBeGreaterThan(0);
    expect(scanSecrets("key = sk-ant-abcdefghijklmnopqrstuvwxyz").some((f) => f.kind.includes("Anthropic"))).toBe(true);
  });

  it("detects GitHub tokens and private key blocks", () => {
    expect(scanSecrets("ghp_" + "a".repeat(36)).some((f) => f.kind.includes("GitHub"))).toBe(true);
    expect(
      scanSecrets("-----BEGIN RSA PRIVATE KEY-----\nMII...").some((f) => f.kind.includes("private key")),
    ).toBe(true);
  });

  it("detects generic assigned secrets", () => {
    expect(scanSecrets(`password: "hunter2istoolong12345"`).length).toBeGreaterThan(0);
  });

  it("does not flag ordinary code", () => {
    expect(scanSecrets("const total = a + b; // sum")).toEqual([]);
    expect(scanSecrets("import { foo } from './bar';")).toEqual([]);
  });

  it("dedupes by kind", () => {
    const f = scanSecrets("AKIAIOSFODNN7EXAMPLE AKIA1234567890ABCDEF");
    expect(f.filter((x) => x.kind.includes("AWS access key"))).toHaveLength(1);
  });
});

describe("shouldScanPath", () => {
  it("exempts example env and docs, scans real source", () => {
    expect(shouldScanPath("src/index.ts")).toBe(true);
    expect(shouldScanPath(".env")).toBe(true);
    expect(shouldScanPath(".env.example")).toBe(false);
    expect(shouldScanPath("README.md")).toBe(false);
    expect(shouldScanPath("package-lock.json.lock")).toBe(false);
  });
});

describe("describeSecretBlock", () => {
  it("names the file and the redacted findings", () => {
    const msg = describeSecretBlock("config.js", [{ kind: "GitHub token", excerpt: "ghp_…aa" }]);
    expect(msg).toContain("config.js");
    expect(msg).toContain("GitHub token");
    expect(msg).toContain("environment variable");
  });
});
