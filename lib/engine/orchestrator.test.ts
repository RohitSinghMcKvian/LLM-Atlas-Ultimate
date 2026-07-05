import { describe, expect, it } from "vitest";
import {
  BUILTIN_ROLES,
  fanOut,
  mergeRoles,
  mergeSummaries,
  parseAgentMd,
} from "./orchestrator";

describe("parseAgentMd", () => {
  const md = `---
name: DB Migrator
model: deepseek/deepseek-chat
tools: full
max-iterations: 9
---
You migrate databases. Be careful.`;

  it("parses frontmatter + prompt", () => {
    const role = parseAgentMd(".atlas/agents/migrator.md", md);
    expect(role).toMatchObject({
      id: "migrator",
      name: "DB Migrator",
      modelId: "deepseek/deepseek-chat",
      readonly: false,
      maxIterations: 9,
    });
    expect(role!.prompt).toContain("You migrate databases");
  });

  it("defaults to read-only, 6 iterations, filename id", () => {
    const role = parseAgentMd(".atlas/agents/docs.md", "---\nname: Docs\n---\nWrite docs.");
    expect(role).toMatchObject({ readonly: true, maxIterations: 6, id: "docs" });
  });

  it("rejects files without frontmatter or empty prompts", () => {
    expect(parseAgentMd("a.md", "just text")).toBeNull();
    expect(parseAgentMd("a.md", "---\nname: X\n---\n")).toBeNull();
  });

  it("caps runaway iteration counts at 12", () => {
    const role = parseAgentMd("x.md", "---\nmax-iterations: 99\n---\nGo.");
    expect(role!.maxIterations).toBe(12);
  });
});

describe("mergeRoles", () => {
  it("user agents override built-ins by id, built-ins survive otherwise", () => {
    const roles = mergeRoles([
      { path: ".atlas/agents/reviewer.md", content: "---\nname: Strict Reviewer\n---\nBe harsh." },
    ]);
    expect(roles.reviewer.name).toBe("Strict Reviewer");
    expect(roles.explorer).toBe(BUILTIN_ROLES.explorer);
  });
});

describe("fanOut", () => {
  it("caps concurrency", async () => {
    let live = 0;
    let peak = 0;
    const jobs = Array.from({ length: 6 }, (_, i) => ({
      id: `j${i}`,
      run: async () => {
        live++;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 10));
        live--;
        return i;
      },
    }));
    const results = await fanOut(jobs, 2);
    expect(results).toHaveLength(6);
    expect(peak).toBeLessThanOrEqual(2);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("captures rejections per-job without failing the batch", async () => {
    const results = await fanOut([
      { id: "good", run: async () => "ok" },
      {
        id: "bad",
        run: async () => {
          throw new Error("boom");
        },
      },
    ]);
    expect(results.find((r) => r.id === "good")).toMatchObject({ ok: true, value: "ok" });
    expect(results.find((r) => r.id === "bad")).toMatchObject({ ok: false, error: "boom" });
  });

  it("stops picking up new jobs after abort", async () => {
    const ctrl = new AbortController();
    let ran = 0;
    const jobs = Array.from({ length: 5 }, (_, i) => ({
      id: `j${i}`,
      run: async () => {
        ran++;
        if (i === 0) ctrl.abort();
        return i;
      },
    }));
    await fanOut(jobs, 1, ctrl.signal);
    expect(ran).toBe(1);
  });
});

describe("mergeSummaries", () => {
  it("renders structured sections including failures", () => {
    const merged = mergeSummaries([
      { id: "explorer", ok: true, value: "found 3 modules" },
      { id: "researcher", ok: false, error: "timeout" },
    ]);
    expect(merged).toContain("### explorer\nfound 3 modules");
    expect(merged).toContain("### researcher\n(failed: timeout)");
  });
});
