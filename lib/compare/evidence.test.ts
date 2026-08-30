import { describe, it, expect, vi } from "vitest";
import {
  FIRST_ROUND_SHARE,
  briefPlanner,
  describeEvidence,
  gatherEvidence,
  isEmptyPack,
  limitsFor,
  packToContext,
  packTokens,
} from "./evidence";
import { DEPTH_PRESETS } from "./lanes";
import { EMPTY_EVIDENCE, type EvidencePack } from "./types";
import type { WebSource } from "@/lib/chat/types";

const source = (n: number): WebSource => ({
  title: `Source ${n}`,
  url: `https://example.com/${n}`,
  snippet: `Snippet ${n}`,
});

const pack = (over: Partial<EvidencePack> = {}): EvidencePack => ({
  ...EMPTY_EVIDENCE,
  ...over,
});

describe("limitsFor", () => {
  it("follows the depth preset", () => {
    expect(limitsFor("deep").maxRounds).toBe(DEPTH_PRESETS.deep.researchRounds);
    expect(limitsFor("standard").maxSources).toBe(DEPTH_PRESETS.standard.maxSources);
  });

  it("gives Deep a longer wall clock, but still inside the route's ceiling", () => {
    expect(limitsFor("deep").maxMs).toBeGreaterThan(limitsFor("standard").maxMs);
    // The route has 300s and still has to write a response.
    expect(limitsFor("deep").maxMs).toBeLessThan(300_000);
  });
});

describe("briefPlanner", () => {
  it("uses the brief's own queries for the first round", async () => {
    const plan = briefPlanner(["alpha", "beta"]);
    const out = await plan("q", [], 0);
    expect(out.map((q) => q.query)).toEqual(["alpha", "beta"]);
  });

  it("derives a first round when the brief gave none", async () => {
    const out = await briefPlanner([])("what is retrieval augmented generation", [], 0);
    expect(out.length).toBeGreaterThan(0);
  });

  it("leaves budget for later rounds instead of spending it all on round 0", async () => {
    // Observed live at Standard: the brief returned exactly 6 queries against a
    // 6-query budget, so round 0 exhausted it and the loop stopped immediately
    // with "Stopped at the 6-search limit." Multi-round research never ran.
    const proposed = ["a", "b", "c", "d", "e", "f"];
    const out = await briefPlanner(proposed, 6)("q", [], 0);
    expect(out.length).toBe(Math.ceil(6 * FIRST_ROUND_SHARE));
    expect(out.length).toBeLessThan(proposed.length);
  });

  it("always runs at least one query, however small the budget", async () => {
    expect((await briefPlanner(["a", "b"], 1)("q", [], 0)).length).toBe(1);
  });

  it("is unconstrained when no budget is given", async () => {
    const out = await briefPlanner(["a", "b", "c"])("q", [], 0);
    expect(out).toHaveLength(3);
  });

  it("stops once there are enough sources", async () => {
    const known = Array.from({ length: 12 }, (_, i) => source(i));
    expect(await briefPlanner(["a"])("q", known, 1)).toEqual([]);
  });

  it("keeps going on later rounds while sources are thin", async () => {
    const out = await briefPlanner(["a"])("some research question", [source(1)], 1);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("gatherEvidence", () => {
  const search = vi.fn(async (q: string) => [source(q.length)]);

  it("does no work when there is nothing to research and nothing attached", async () => {
    const spy = vi.fn();
    const out = await gatherEvidence({
      question: "q",
      briefQueries: [],
      depth: "quick",
      search: spy,
    });
    expect(out).toEqual(EMPTY_EVIDENCE);
    expect(spy).not.toHaveBeenCalled();
  });

  it("skips searching when attachments are the evidence", async () => {
    const spy = vi.fn();
    const out = await gatherEvidence({
      question: "what does this say",
      briefQueries: [],
      depth: "standard",
      documents: [{ name: "report.pdf", text: "the body" }],
      search: spy,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(out.documents).toHaveLength(1);
    expect(out.documents[0].tokens).toBeGreaterThan(0);
  });

  it("runs the loop and returns what it found", async () => {
    const out = await gatherEvidence({
      question: "q",
      briefQueries: ["alpha", "beta"],
      depth: "standard",
      search,
    });
    expect(out.queriesRun.length).toBeGreaterThan(0);
    expect(out.sources.length).toBeGreaterThan(0);
  });

  it("degrades to an empty pack rather than failing the run", async () => {
    const out = await gatherEvidence({
      question: "q",
      briefQueries: ["alpha"],
      depth: "quick",
      search: async () => {
        throw new Error("network down");
      },
    });
    // A failed search is one angle lost, not a failed run.
    expect(out.sources).toEqual([]);
  });

  it("keeps attachments even when every search fails", async () => {
    const out = await gatherEvidence({
      question: "q",
      briefQueries: ["alpha"],
      depth: "quick",
      documents: [{ name: "a.txt", text: "kept" }],
      search: async () => {
        throw new Error("boom");
      },
    });
    expect(out.documents).toHaveLength(1);
  });

  it("drops empty attachments", async () => {
    const out = await gatherEvidence({
      question: "q",
      briefQueries: [],
      depth: "quick",
      documents: [{ name: "empty.txt", text: "   " }],
      search: vi.fn(),
    });
    expect(out.documents).toEqual([]);
  });
});

describe("packToContext", () => {
  it("is undefined when there is no evidence", () => {
    expect(packToContext(pack())).toBeUndefined();
  });

  it("numbers sources so citation validation can match them", () => {
    const text = packToContext(pack({ sources: [source(1), source(2)] }))!;
    expect(text).toContain("[1]");
    expect(text).toContain("[2]");
  });

  it("names attachments instead of numbering them", () => {
    // Numbering a file alongside sources would let a model cite [3] for a PDF
    // and have `reconcileCitations` call it a fabricated source.
    const text = packToContext(pack({ documents: [{ name: "spec.pdf", text: "body", tokens: 2 }] }))!;
    expect(text).toContain("spec.pdf");
    expect(text).toContain("not by citation number");
  });

  it("carries both when both are present", () => {
    const text = packToContext(
      pack({ sources: [source(1)], documents: [{ name: "a.txt", text: "b", tokens: 1 }] }),
    )!;
    expect(text).toContain("[1]");
    expect(text).toContain("a.txt");
  });
});

describe("packTokens", () => {
  it("is zero for an empty pack", () => {
    expect(packTokens(pack())).toBe(0);
  });

  it("grows with the evidence", () => {
    const small = packTokens(pack({ sources: [source(1)] }));
    const big = packTokens(pack({ sources: [source(1), source(2), source(3)] }));
    expect(big).toBeGreaterThan(small);
  });
});

describe("isEmptyPack", () => {
  it("treats a missing pack as empty", () => {
    expect(isEmptyPack(undefined)).toBe(true);
  });

  it("is not empty when only attachments are present", () => {
    expect(isEmptyPack(pack({ documents: [{ name: "a", text: "b", tokens: 1 }] }))).toBe(false);
  });
});

describe("describeEvidence", () => {
  it("says so when nothing was found", () => {
    expect(describeEvidence(pack())).toBe("Nothing found");
  });

  it("counts sources, files and rounds", () => {
    const text = describeEvidence(
      pack({ sources: [source(1), source(2)], documents: [{ name: "a", text: "b", tokens: 1 }], rounds: 3 }),
    );
    expect(text).toContain("2 sources");
    expect(text).toContain("1 file");
    expect(text).toContain("3 rounds");
  });

  it("reports a budget stop rather than hiding it", () => {
    expect(describeEvidence(pack({ sources: [source(1)], stoppedBy: "query budget" }))).toContain(
      "query budget",
    );
  });
});
