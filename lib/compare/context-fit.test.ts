import { describe, it, expect } from "vitest";
import {
  DOC_EXCERPT_CHARS,
  buildLaneContext,
  formatNumbered,
  relevance,
  selectSources,
  sourceTokens,
} from "./context-fit";
import { EMPTY_EVIDENCE, type EvidencePack } from "./types";
import type { WebSource } from "@/lib/chat/types";

const src = (title: string, snippet = "", url = `https://example.com/${title}`): WebSource => ({
  title,
  url,
  snippet,
});

const pack = (over: Partial<EvidencePack> = {}): EvidencePack => ({ ...EMPTY_EVIDENCE, ...over });

describe("relevance", () => {
  const question = "trade-offs between retrieval augmented generation and long context";

  it("scores a title match above a snippet match", () => {
    const inTitle = relevance(src("retrieval augmented generation"), question);
    const inSnippet = relevance(src("Untitled", "retrieval augmented generation"), question);
    expect(inTitle).toBeGreaterThan(inSnippet);
  });

  it("rewards covering more of the question, not repeating one word", () => {
    const broad = relevance(src("retrieval context trade-offs"), question);
    const narrow = relevance(src("retrieval retrieval retrieval retrieval"), question);
    expect(broad).toBeGreaterThan(narrow);
  });

  it("is zero for something unrelated", () => {
    expect(relevance(src("Baking sourdough at home"), question)).toBe(0);
  });

  it("does not divide by zero on a question with no content words", () => {
    expect(relevance(src("anything"), "of the a an")).toBe(0);
  });
});

describe("selectSources", () => {
  const sources = [
    src("Baking bread"),
    src("Long context windows explained"),
    src("Retrieval augmented generation guide"),
    src("Weather report"),
  ];
  const question = "retrieval augmented generation and long context";

  it("keeps the original numbers, whatever it drops", () => {
    // The whole hazard: a subset numbered 1..n would make this lane's [2] a
    // different source from a wide lane's [2].
    const kept = selectSources(sources, question, 10_000);
    expect(kept.map((k) => k.n)).toEqual([1, 2, 3, 4]);
  });

  it("returns them in reading order, not ranked order", () => {
    const kept = selectSources(sources, question, 10_000);
    expect(kept.map((k) => k.n)).toEqual([...kept.map((k) => k.n)].sort((a, b) => a - b));
  });

  it("drops the least relevant when the budget is tight", () => {
    const budget = sourceTokens({ n: 1, source: sources[1] }) + sourceTokens({ n: 2, source: sources[2] });
    const kept = selectSources(sources, question, budget);
    const numbers = kept.map((k) => k.n);
    // 2 and 3 are the two on-topic sources; 1 and 4 are not.
    expect(numbers).toContain(2);
    expect(numbers).toContain(3);
    expect(numbers).not.toContain(1);
  });

  it("keeps nothing when there is no room", () => {
    expect(selectSources(sources, question, 0)).toEqual([]);
  });

  it("breaks ties toward the source found first", () => {
    const tied = [src("alpha beta"), src("alpha beta")];
    const one = selectSources(tied, "alpha beta", sourceTokens({ n: 1, source: tied[0] }));
    expect(one.map((k) => k.n)).toEqual([1]);
  });
});

describe("formatNumbered", () => {
  it("states the numbers rather than implying them by position", () => {
    const text = formatNumbered([{ n: 7, source: src("Seven") }], 12);
    expect(text).toContain("[7]");
    expect(text).toContain("do not renumber");
  });

  it("tells the model when it is reading an abridged pack", () => {
    // A model that does not know sources are missing answers as though it has
    // them all.
    const text = formatNumbered([{ n: 1, source: src("One") }], 12);
    expect(text).toContain("1 of the 12");
  });

  it("says nothing about abridgement when nothing was dropped", () => {
    const text = formatNumbered([{ n: 1, source: src("One") }], 1);
    expect(text).not.toContain("of the");
  });

  it("tells the model to say so rather than answer from memory when empty", () => {
    expect(formatNumbered([], 5)).toContain("rather than answering from memory");
  });
});

describe("buildLaneContext", () => {
  const question = "retrieval augmented generation and long context";
  const many = Array.from({ length: 12 }, (_, i) =>
    src(`Retrieval long context source ${i}`, "x".repeat(400)),
  );

  it("is undefined when there is no evidence at all", () => {
    expect(buildLaneContext(pack(), "stuff", 1_000, question)).toBeUndefined();
  });

  it("carries everything when the lane can hold it", () => {
    const text = buildLaneContext(pack({ sources: many }), "stuff", 100, question)!;
    // `stuff` ignores the budget by design — the planner already decided it fits.
    for (let n = 1; n <= 12; n++) expect(text).toContain(`[${n}]`);
  });

  it("carries a subset under rag, with the numbers intact", () => {
    const text = buildLaneContext(pack({ sources: many }), "rag", 400, question)!;
    const cited = [...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    expect(cited.length).toBeGreaterThan(0);
    expect(cited.length).toBeLessThan(12);
    // Whatever survived kept its original number.
    expect(Math.max(...cited)).toBeLessThanOrEqual(12);
  });

  it("serves the user's own files before the web, since they asked about those", () => {
    const text = buildLaneContext(
      pack({ sources: many, documents: [{ name: "spec.pdf", text: "the body", tokens: 2 }] }),
      "rag",
      2_000,
      question,
    )!;
    expect(text.indexOf("spec.pdf")).toBeLessThan(text.indexOf("Sources gathered"));
  });

  it("excerpts a long document rather than dropping it", () => {
    const long = "y".repeat(DOC_EXCERPT_CHARS * 3);
    const text = buildLaneContext(
      pack({ documents: [{ name: "big.txt", text: long, tokens: 9_000 }] }),
      "map-reduce",
      500,
      question,
    )!;
    expect(text).toContain("big.txt");
    expect(text).toContain("[truncated]");
    expect(text.length).toBeLessThan(long.length);
  });

  it("does not truncate a document when the lane is stuffing", () => {
    const long = "y".repeat(DOC_EXCERPT_CHARS * 2);
    const text = buildLaneContext(
      pack({ documents: [{ name: "big.txt", text: long, tokens: 4_000 }] }),
      "stuff",
      10,
      question,
    )!;
    expect(text).not.toContain("[truncated]");
  });

  it("still produces a context when documents alone eat the budget", () => {
    const text = buildLaneContext(
      pack({ sources: many, documents: [{ name: "a.txt", text: "z".repeat(20_000), tokens: 5_000 }] }),
      "rag",
      100,
      question,
    )!;
    // No room left for sources, so the model is told the pack is unavailable
    // rather than being handed a silently sourceless prompt.
    expect(text).toContain("a.txt");
    expect(text).toContain("rather than answering from memory");
  });
});
