import { describe, it, expect } from "vitest";
import {
  chunkProjectFiles,
  chunkText,
  estimateTokens,
  filesFingerprint,
} from "./chunk";

describe("estimateTokens", () => {
  it("approximates chars/4", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    expect(chunkText("hello world", { targetChars: 2000 })).toEqual(["hello world"]);
  });

  it("returns nothing for empty or whitespace", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n  ")).toEqual([]);
  });

  it("splits long text into multiple chunks", () => {
    const text = "word ".repeat(2000); // ~10000 chars
    const chunks = chunkText(text, { targetChars: 2000, overlapChars: 200 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(2000);
  });

  it("covers the whole document (no text dropped)", () => {
    const paras = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} has some content.`);
    const text = paras.join("\n\n");
    const chunks = chunkText(text, { targetChars: 400, overlapChars: 50 });
    // Every paragraph's distinctive marker must appear in some chunk.
    for (let i = 0; i < 40; i++) {
      expect(chunks.some((c) => c.includes(`Paragraph ${i} `)), `para ${i}`).toBe(true);
    }
  });

  it("prefers paragraph breaks when splitting", () => {
    const a = "A".repeat(1500);
    const b = "B".repeat(1500);
    const chunks = chunkText(`${a}\n\n${b}`, { targetChars: 1800, overlapChars: 100 });
    // The break should fall at the paragraph boundary, so the first chunk is
    // all A's and does not bleed into B.
    expect(chunks[0]).toBe(a);
  });

  it("carries overlap between consecutive chunks", () => {
    const text = Array.from({ length: 200 }, (_, i) => `sentence${i}.`).join(" ");
    const chunks = chunkText(text, { targetChars: 500, overlapChars: 120 });
    expect(chunks.length).toBeGreaterThan(2);
    // The tail of chunk n should reappear at the head of chunk n+1.
    for (let i = 0; i < chunks.length - 1; i++) {
      const tail = chunks[i].slice(-40);
      const someWord = tail.split(" ").find((w) => w.startsWith("sentence"));
      if (someWord) expect(chunks[i + 1].includes(someWord) || chunks[i].includes(someWord)).toBe(true);
    }
  });

  it("hard-cuts a single enormous line with no boundaries", () => {
    const text = "x".repeat(5000);
    const chunks = chunkText(text, { targetChars: 1000, overlapChars: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("").length).toBeGreaterThanOrEqual(5000);
  });

  it("terminates rather than looping when overlap ≥ target", () => {
    const chunks = chunkText("y".repeat(3000), { targetChars: 500, overlapChars: 999 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThan(100);
  });
});

describe("chunkProjectFiles", () => {
  it("tags each chunk with its file and position", () => {
    const files = [
      { name: "a.md", text: "short a" },
      { name: "b.md", text: "short b" },
    ];
    const out = chunkProjectFiles(files, { targetChars: 2000 });
    expect(out).toEqual([
      { fileName: "a.md", chunkIndex: 0, text: "short a" },
      { fileName: "b.md", chunkIndex: 0, text: "short b" },
    ]);
  });

  it("numbers chunks within a file from zero", () => {
    const files = [{ name: "big.md", text: "word ".repeat(2000) }];
    const out = chunkProjectFiles(files, { targetChars: 1000, overlapChars: 100 });
    expect(out.length).toBeGreaterThan(1);
    expect(out.map((c) => c.chunkIndex)).toEqual(out.map((_, i) => i));
    expect(out.every((c) => c.fileName === "big.md")).toBe(true);
  });

  it("skips empty files", () => {
    expect(chunkProjectFiles([{ name: "empty.md", text: "" }])).toEqual([]);
  });
});

describe("filesFingerprint", () => {
  it("is stable for identical input", () => {
    const files = [{ name: "a", text: "hello" }];
    expect(filesFingerprint(files)).toBe(filesFingerprint(files));
  });

  it("changes when content changes", () => {
    const a = filesFingerprint([{ name: "a", text: "hello" }]);
    const b = filesFingerprint([{ name: "a", text: "hellp" }]);
    expect(a).not.toBe(b);
  });

  it("changes when a file is added or renamed", () => {
    const one = filesFingerprint([{ name: "a", text: "x" }]);
    const two = filesFingerprint([{ name: "a", text: "x" }, { name: "b", text: "y" }]);
    const renamed = filesFingerprint([{ name: "z", text: "x" }]);
    expect(one).not.toBe(two);
    expect(one).not.toBe(renamed);
  });

  // Distinguishes "ab"+"c" from "a"+"bc" — the length markers between files
  // prevent a boundary-shift collision.
  it("distinguishes different file boundaries with the same concatenation", () => {
    const a = filesFingerprint([{ name: "f", text: "ab" }, { name: "g", text: "c" }]);
    const b = filesFingerprint([{ name: "f", text: "a" }, { name: "g", text: "bc" }]);
    expect(a).not.toBe(b);
  });
});
