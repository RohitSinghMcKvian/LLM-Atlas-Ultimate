import { describe, expect, it } from "vitest";
import type { ChangeRecord } from "@/lib/code/tools";
import {
  applyHunkDecisions,
  buildChangeSet,
  changeSetFiles,
  netByPath,
  netChange,
  splitHunks,
} from "./changeset";

const rec = (path: string, before: string | null, after: string | null, ts: number): ChangeRecord => ({
  id: `${path}-${ts}`,
  path,
  before,
  after,
  tool: "edit_file",
  ts,
});

describe("netChange / netByPath", () => {
  it("collapses multiple edits into first-before / last-after", () => {
    const net = netChange([rec("a.js", "v0", "v1", 1), rec("a.js", "v1", "v2", 2)]);
    expect(net).toEqual({ before: "v0", after: "v2" });
  });

  it("drops paths with no net change", () => {
    const nets = netByPath([rec("a.js", "x", "y", 1), rec("a.js", "y", "x", 2)]);
    expect(nets).toEqual([]);
  });

  it("groups by path", () => {
    const nets = netByPath([rec("a.js", "1", "2", 1), rec("b.js", null, "new", 2)]);
    expect(nets).toHaveLength(2);
    expect(nets.find((n) => n.path === "b.js")).toMatchObject({ before: null, after: "new" });
  });
});

describe("splitHunks", () => {
  it("isolates changed regions with surrounding context", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n");
    const after = ["a", "b", "C", "d", "e", "f", "g", "H"].join("\n");
    const hunks = splitHunks("f.js", before, after);
    expect(hunks.length).toBe(2);
    expect(hunks[0].before).toContain("c");
    expect(hunks[0].after).toContain("C");
    expect(hunks[1].after).toContain("H");
  });

  it("handles a new file as a single hunk", () => {
    const hunks = splitHunks("n.js", "", "line1\nline2");
    expect(hunks).toHaveLength(1);
    expect(hunks[0].after).toContain("line1");
  });
});

describe("applyHunkDecisions (reverse-patch)", () => {
  it("reverts a rejected hunk, keeps accepted ones", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n");
    const after = ["a", "b", "C", "d", "e", "f", "g", "H"].join("\n");
    const hunks = splitHunks("f.js", before, after);
    // Reject the first hunk (c→C), accept the second (h→H).
    hunks[0].accepted = false;
    const result = applyHunkDecisions(after, hunks);
    expect(result).toContain("\nc\n"); // c restored
    expect(result).toContain("H"); // H kept
  });

  it("is a no-op when all hunks are accepted", () => {
    const before = "a\nb\nc";
    const after = "a\nB\nc";
    const hunks = splitHunks("f.js", before, after);
    expect(applyHunkDecisions(after, hunks)).toBe(after);
  });

  it("rejecting every hunk reconstructs the original", () => {
    const before = "one\ntwo\nthree";
    const after = "one\nTWO\nthree";
    const hunks = splitHunks("f.js", before, after);
    hunks.forEach((h) => (h.accepted = false));
    expect(applyHunkDecisions(after, hunks)).toBe(before);
  });
});

describe("buildChangeSet", () => {
  it("assembles staged hunks across files", () => {
    const cs = buildChangeSet(
      "cs1",
      "task1",
      "cp1",
      "add divide",
      [rec("math.js", "export const add=1", "export const add=1\nexport const div=2", 1), rec("test.js", null, "assert(div)", 2)],
      "todo1",
    );
    expect(cs.status).toBe("staged");
    expect(cs.checkpointId).toBe("cp1");
    expect(changeSetFiles(cs).sort()).toEqual(["math.js", "test.js"]);
    expect(cs.hunks.every((h) => h.accepted)).toBe(true);
  });
});
