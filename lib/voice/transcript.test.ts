import { describe, expect, it } from "vitest";
import { atlasGraph } from "@/lib/graph/atlas-graph";
import { miniGraph } from "@/lib/graph/__fixtures__/mini-catalog";
import { biasPrompt, lexiconFor, refineTranscript } from "./transcript";

const lex = lexiconFor(atlasGraph());

describe("refineTranscript", () => {
  it("normalises before it corrects, which is the only order that works", () => {
    // "seventy be" has to become "70B" before any catalog term contains it.
    const r = refineTranscript("tell me about Meridian seventy be", lexiconFor(miniGraph()));
    expect(r.text).toContain("Meridian 70B");
  });

  it("keeps what was heard beside what will be sent", () => {
    const r = refineTranscript("the MML you score", lex);
    expect(r.raw).toBe("the MML you score");
    expect(r.text).toContain("MMLU");
    expect(r.clean).toBe(false);
  });

  it("reports a clean transcript as clean", () => {
    const r = refineTranscript("which model is cheapest", lex);
    expect(r.clean).toBe(true);
    expect(r.corrections).toEqual([]);
  });

  it("handles nothing at all", () => {
    expect(refineTranscript("", lex).text).toBe("");
    expect(refineTranscript("   ", lex).corrections).toEqual([]);
  });
});

describe("biasPrompt", () => {
  it("lists real vocabulary for a backend that accepts one", () => {
    const p = biasPrompt(lex);
    expect(p).toContain("MMLU");
    expect(p.split(", ").length).toBeGreaterThan(5);
  });

  it("stays inside the cap, because an over-long prompt degrades transcription", () => {
    expect(biasPrompt(lex, 120).length).toBeLessThanOrEqual(120);
    expect(biasPrompt(lex, 0)).toBe("");
  });

  it("is empty when there is no vocabulary to bias towards", () => {
    expect(biasPrompt({ terms: [], exact: new Map(), byKey: new Map(), maxWords: 1 })).toBe("");
  });
});

describe("lexiconFor", () => {
  it("builds once per graph", () => {
    const g = miniGraph();
    expect(lexiconFor(g)).toBe(lexiconFor(g));
  });

  it("still works with no graph, on the technical terms alone", () => {
    const none = lexiconFor(null);
    expect(none.terms.length).toBeGreaterThan(5);
    expect(refineTranscript("an M C P server", none).text).toContain("MCP");
  });
});
