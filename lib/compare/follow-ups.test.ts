import { describe, it, expect } from "vitest";
import { MAX_SUGGESTIONS, suggestFollowUps, suggestionsForTurn, toQuestion } from "./follow-ups";
import { emptyStages, type Claim, type CompareRun, type Synthesis } from "./types";

const synthesis = (divergences: string[]): Synthesis => ({
  answer: "a",
  agreements: [],
  divergences,
  caveats: [],
});

const claim = (text: string, over: Partial<Claim> = {}): Claim => ({
  id: text,
  text,
  asserts: ["a"],
  contradicts: [],
  citations: [],
  materiality: "medium",
  ...over,
});

describe("toQuestion", () => {
  it("turns a divergence into a question", () => {
    expect(toQuestion("latency under concurrent load")).toBe(
      "Which is right about latency under concurrent load?",
    );
  });

  it("strips the framing the merge puts around it", () => {
    expect(toQuestion("They disagreed on whether RAG is cheaper at scale")).toBe(
      "Which is right about RAG is cheaper at scale?",
    );
  });

  it("does not lowercase an acronym", () => {
    // "RAG" must not become "rAG".
    expect(toQuestion("RAG scales better than long context")).toContain("RAG scales");
  });

  it("drops the anonymous label, which the user never saw", () => {
    expect(toQuestion("Answer A: cost grows linearly with context")).toBe(
      "Which is right about cost grows linearly with context?",
    );
  });

  it("uses a line that already reads as a question", () => {
    expect(toQuestion("does chunk size matter more than model size?")).toBe(
      "Does chunk size matter more than model size?",
    );
  });

  it("rejects a fragment", () => {
    expect(toQuestion("cost")).toBeNull();
  });

  it("rejects a paragraph, which a chip cannot hold", () => {
    expect(toQuestion("x".repeat(400))).toBeNull();
  });

  it("rejects an empty line", () => {
    expect(toQuestion("   ")).toBeNull();
  });

  it("strips a leading bullet", () => {
    expect(toQuestion("- retrieval quality at scale")).toContain("retrieval quality at scale");
  });
});

describe("suggestFollowUps", () => {
  it("is empty when nothing diverged", () => {
    expect(suggestFollowUps({ synthesis: synthesis([]) })).toEqual([]);
  });

  it("is empty with no synthesis and no claims", () => {
    expect(suggestFollowUps({})).toEqual([]);
  });

  it("suggests from the merge's divergences", () => {
    const out = suggestFollowUps({ synthesis: synthesis(["latency under load"]) });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("latency under load");
  });

  it("puts a contested claim ahead of the merge's prose", () => {
    // The matrix recording two lanes as actively disagreeing is a harder
    // disagreement than one the merge merely noticed.
    const out = suggestFollowUps({
      synthesis: synthesis(["something the merge noticed"]),
      claims: [claim("something the matrix contests", { contradicts: ["b"] })],
    });
    expect(out[0]).toContain("matrix contests");
  });

  it("ignores a claim nobody contradicted", () => {
    const out = suggestFollowUps({ claims: [claim("an uncontested claim here")] });
    expect(out).toEqual([]);
  });

  it("orders contested claims by materiality", () => {
    const out = suggestFollowUps({
      claims: [
        claim("a low stakes disagreement", { contradicts: ["b"], materiality: "low" }),
        claim("a high stakes disagreement", { contradicts: ["b"], materiality: "high" }),
      ],
    });
    expect(out[0]).toContain("high stakes");
  });

  it("does not repeat the same question from two sources", () => {
    const out = suggestFollowUps({
      synthesis: synthesis(["cost grows with context length"]),
      claims: [claim("cost grows with context length", { contradicts: ["b"] })],
    });
    expect(out).toHaveLength(1);
  });

  it("caps the row so it stays readable", () => {
    const many = Array.from({ length: 10 }, (_, i) => `disagreement number ${i} about something`);
    expect(suggestFollowUps({ synthesis: synthesis(many) })).toHaveLength(MAX_SUGGESTIONS);
  });
});

describe("suggestionsForTurn", () => {
  it("is empty without a turn", () => {
    expect(suggestionsForTurn(undefined)).toEqual([]);
  });

  it("reads the turn's own synthesis and claims", () => {
    const run: CompareRun = {
      id: "r1",
      createdAt: 0,
      updatedAt: 0,
      config: { question: "q", modelIds: [], depth: "standard" },
      stages: emptyStages(),
      lanes: [],
      synthesis: synthesis(["throughput on long documents"]),
    };
    expect(suggestionsForTurn(run)[0]).toContain("throughput on long documents");
  });
});
