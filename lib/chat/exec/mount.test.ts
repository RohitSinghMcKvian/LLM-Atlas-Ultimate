import { describe, it, expect } from "vitest";
import {
  describeSkipped,
  diffMount,
  hashContent,
  isBinaryPath,
  manifestOf,
  MAX_EXPORT_FILES,
  MAX_EXPORT_FILE_BYTES,
  MAX_EXPORT_TOTAL_BYTES,
  planExport,
  type MountEntry,
} from "./mount";

const text = (path: string, content: string): MountEntry => ({
  path,
  text: content,
  size: content.length,
  hash: hashContent(content),
});

const binary = (path: string, size: number): MountEntry => ({
  path,
  size,
  hash: `b:${size}`,
});

describe("hashContent", () => {
  it("is stable and distinguishes different content", () => {
    expect(hashContent("abc")).toBe(hashContent("abc"));
    expect(hashContent("abc")).not.toBe(hashContent("abd"));
    expect(hashContent("")).toBe(hashContent(""));
  });
});

describe("diffMount", () => {
  it("finds files the run created", () => {
    const d = diffMount([text("in.csv", "a")], [text("in.csv", "a"), text("out.json", "{}")]);
    expect(d.created).toEqual(["out.json"]);
    expect(d.modified).toEqual([]);
  });

  it("finds files the run rewrote", () => {
    const d = diffMount([text("a.txt", "one")], [text("a.txt", "two")]);
    expect(d.modified).toEqual(["a.txt"]);
    expect(d.created).toEqual([]);
  });

  // The whole point of mounting: a script that read its input and wrote nothing
  // must not write the input back and pass it off as a deliverable.
  it("says nothing changed when nothing changed", () => {
    const before = [text("a.txt", "same"), text("b.csv", "x,y")];
    const d = diffMount(before, [...before]);
    expect(d).toEqual({ created: [], modified: [], removed: [] });
  });

  // Binaries are fingerprinted by size rather than decoded, so a same-size
  // rewrite is invisible. Accepted: decoding a .xlsx to UTF-8 to hash it would
  // be expensive and lossy, and the failure mode is one missed export rather
  // than a corrupted file.
  it("detects a binary rewrite by size", () => {
    expect(diffMount([binary("r.xlsx", 100)], [binary("r.xlsx", 200)]).modified).toEqual([
      "r.xlsx",
    ]);
  });

  it("reports deletions without being asked to act on them", () => {
    const d = diffMount([text("gone.txt", "x")], []);
    expect(d.removed).toEqual(["gone.txt"]);
    expect(d.created).toEqual([]);
  });

  it("returns paths in a stable order", () => {
    const d = diffMount([], [text("z.txt", "1"), text("a.txt", "2")]);
    expect(d.created).toEqual(["a.txt", "z.txt"]);
  });
});

describe("planExport", () => {
  it("exports everything within the caps", () => {
    const after = [text("a.txt", "x"), text("b.txt", "y")];
    const plan = planExport(["a.txt", "b.txt"], after);
    expect(plan.paths).toEqual(["a.txt", "b.txt"]);
    expect(plan.skipped).toEqual([]);
  });

  it("refuses a single oversized file and says why", () => {
    const big: MountEntry = { path: "huge.bin", size: MAX_EXPORT_FILE_BYTES + 1, hash: "b" };
    const plan = planExport(["huge.bin"], [big]);
    expect(plan.paths).toEqual([]);
    expect(plan.skipped).toEqual([{ path: "huge.bin", reason: "too-large" }]);
  });

  // A plotting loop that saves a PNG per iteration is an ordinary accident.
  it("caps the number of files in one run", () => {
    const after = Array.from({ length: MAX_EXPORT_FILES + 3 }, (_, i) =>
      text(`f${String(i).padStart(2, "0")}.txt`, "x"),
    );
    const plan = planExport(
      after.map((e) => e.path),
      after,
    );
    expect(plan.paths).toHaveLength(MAX_EXPORT_FILES);
    expect(plan.skipped).toHaveLength(3);
    expect(plan.skipped.every((s) => s.reason === "too-many")).toBe(true);
  });

  // Each file is inside the per-file cap, so this exercises the total rather
  // than tripping the earlier check.
  it("caps the total bytes in one run", () => {
    const fit = MAX_EXPORT_TOTAL_BYTES / MAX_EXPORT_FILE_BYTES;
    const after: MountEntry[] = Array.from({ length: fit + 1 }, (_, i) => ({
      path: `f${i}.bin`,
      size: MAX_EXPORT_FILE_BYTES,
      hash: String(i),
    }));
    const plan = planExport(
      after.map((e) => e.path),
      after,
    );
    expect(plan.paths).toHaveLength(fit);
    expect(plan.skipped).toEqual([{ path: `f${fit}.bin`, reason: "total-exceeded" }]);
  });

  // Deterministic order, so the same run always keeps the same subset. A cap
  // that silently kept a different set each time would be worse than one that
  // refuses predictably.
  it("applies the caps in path order regardless of input order", () => {
    const after = Array.from({ length: MAX_EXPORT_FILES + 1 }, (_, i) =>
      text(`f${String(i).padStart(2, "0")}.txt`, "x"),
    );
    const shuffled = [...after].reverse().map((e) => e.path);
    expect(planExport(shuffled, after).paths).toEqual(
      planExport(
        after.map((e) => e.path),
        after,
      ).paths,
    );
  });

  it("ignores a changed path that no longer exists", () => {
    expect(planExport(["ghost.txt"], []).paths).toEqual([]);
  });
});

describe("isBinaryPath", () => {
  // Decided by extension rather than by sniffing: a .xlsx is a zip container and
  // would survive a UTF-8 round trip as mojibake that opens in nothing.
  it("recognises the formats Python produces", () => {
    for (const p of ["out.xlsx", "report.PDF", "doc.docx", "plot.png", "a/b/data.parquet"]) {
      expect(isBinaryPath(p), p).toBe(true);
    }
  });

  it("leaves text formats alone", () => {
    for (const p of ["a.txt", "data.csv", "index.html", "notes.md", "s.py", "x.json"]) {
      expect(isBinaryPath(p), p).toBe(false);
    }
  });
});

describe("describeSkipped", () => {
  // A file that quietly failed to save is the exact failure the two-way sync
  // exists to prevent, and the model can only tell the user if the tool tells it.
  it("names every excluded file and the reason", () => {
    const note = describeSkipped([
      { path: "big.bin", reason: "too-large" },
      { path: "n.txt", reason: "too-many" },
    ]);
    expect(note).toContain("big.bin");
    expect(note).toContain("n.txt");
    expect(note).toContain("per-file limit");
  });

  it("says nothing when nothing was excluded", () => {
    expect(describeSkipped([])).toBe("");
  });
});

describe("manifestOf", () => {
  it("indexes by path", () => {
    const m = manifestOf([text("a", "1"), text("b", "2")]);
    expect(m.get("a")?.text).toBe("1");
    expect(m.size).toBe(2);
  });
});
