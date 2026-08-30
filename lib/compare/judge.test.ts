import { describe, it, expect } from "vitest";
import { anonLabel, buildJudgePrompt, describeScores, judgeSchema, parseJudgeScores, rankByScore } from "./judge";
import {
  SYNTHESIS_SCHEMA,
  buildSynthesisPrompt,
  describeSynthesis,
  parseSynthesis,
  repairTruncatedJson,
  salvageAnswer,
} from "./synthesis";
import { EMPTY_EVIDENCE, type JudgeScore, type LaneState, type Rubric } from "./types";

const lane = (id: string, text: string): Pick<LaneState, "id" | "text"> => ({ id, text });

const rubric: Rubric = {
  criteria: [
    { id: "accuracy", name: "Accuracy", description: "Claims hold up", weight: 0.6 },
    { id: "depth", name: "Depth", description: "Goes beyond the obvious", weight: 0.4 },
  ],
  groundRules: [],
};

describe("anonLabel", () => {
  it("labels lanes A onward", () => {
    expect([0, 1, 2].map(anonLabel)).toEqual(["Answer A", "Answer B", "Answer C"]);
  });
});

describe("buildJudgePrompt", () => {
  const lanes = [lane("gpt", "First answer."), lane("claude", "Second answer."), lane("dead", "")];

  it("hides which model wrote what", () => {
    // A judge that can tell it is scoring its own family has a thumb on the scale.
    const { prompt } = buildJudgePrompt({ task: "t", rubric, lanes });
    expect(prompt).not.toContain("gpt");
    expect(prompt).not.toContain("claude");
    expect(prompt).toContain("Answer A");
  });

  it("maps the labels back to lanes", () => {
    const { mapping } = buildJudgePrompt({ task: "t", rubric, lanes });
    expect(mapping).toEqual({ "Answer A": "gpt", "Answer B": "claude" });
  });

  it("excludes a lane with nothing to score", () => {
    // Including it would invite the judge to score an error message.
    const { labels } = buildJudgePrompt({ task: "t", rubric, lanes });
    expect(labels).toHaveLength(2);
  });

  it("shows the weights, so the judge knows what matters", () => {
    const { prompt } = buildJudgePrompt({ task: "t", rubric, lanes });
    expect(prompt).toContain("60%");
  });

  it("includes numbered sources when there are any", () => {
    const { prompt } = buildJudgePrompt({
      task: "t",
      rubric,
      lanes,
      evidence: { ...EMPTY_EVIDENCE, sources: [{ title: "Src", url: "https://a", snippet: "s" }] },
    });
    expect(prompt).toContain("[1] Src");
  });

  it("says nothing about sources when there are none", () => {
    const { prompt } = buildJudgePrompt({ task: "t", rubric, lanes, evidence: EMPTY_EVIDENCE });
    expect(prompt).not.toContain("Judge grounding");
  });
});

describe("judgeSchema", () => {
  it("requires a score for every criterion", () => {
    const schema = judgeSchema(rubric.criteria, ["Answer A"]);
    const item = schema.schema.properties.scores.items.properties.criteria;
    expect(item.required).toEqual(["accuracy", "depth"]);
  });

  it("constrains labels to the ones actually issued", () => {
    const schema = judgeSchema(rubric.criteria, ["Answer A", "Answer B"]);
    expect(schema.schema.properties.scores.items.properties.label.enum).toEqual([
      "Answer A",
      "Answer B",
    ]);
  });
});

describe("parseJudgeScores", () => {
  const mapping = { "Answer A": "gpt", "Answer B": "claude" };
  const reply = JSON.stringify({
    scores: [
      {
        label: "Answer A",
        criteria: { accuracy: 8, depth: 6 },
        justification: "Solid but shallow.",
        unsupported: ["claimed a benchmark nobody ran"],
      },
      { label: "Answer B", criteria: { accuracy: 5, depth: 10 }, justification: "Deep, loose.", unsupported: [] },
    ],
  });

  it("computes the weighted total itself", () => {
    // 8*0.6 + 6*0.4 = 7.2 — arithmetic the model was never shown the weights for.
    const [a] = parseJudgeScores(reply, rubric, mapping);
    expect(a.total).toBe(7.2);
  });

  it("maps anonymous labels back to lanes", () => {
    expect(parseJudgeScores(reply, rubric, mapping).map((s) => s.laneId)).toEqual(["gpt", "claude"]);
  });

  it("carries unsupported claims through", () => {
    expect(parseJudgeScores(reply, rubric, mapping)[0].unsupported).toHaveLength(1);
  });

  it("drops a label the prompt never issued", () => {
    // Scoring it would put a number against a lane that does not exist.
    const rogue = JSON.stringify({
      scores: [{ label: "Answer Z", criteria: { accuracy: 9, depth: 9 }, justification: "", unsupported: [] }],
    });
    expect(parseJudgeScores(rogue, rubric, mapping)).toEqual([]);
  });

  it("clamps a score outside 0-10", () => {
    const wild = JSON.stringify({
      scores: [{ label: "Answer A", criteria: { accuracy: 99, depth: -5 }, justification: "", unsupported: [] }],
    });
    const [a] = parseJudgeScores(wild, rubric, mapping);
    expect(a.scores.accuracy).toBe(10);
    expect(a.scores.depth).toBe(0);
  });

  it("scores a missing criterion as zero rather than dropping the lane", () => {
    const partial = JSON.stringify({
      scores: [{ label: "Answer A", criteria: { accuracy: 8 }, justification: "", unsupported: [] }],
    });
    const [a] = parseJudgeScores(partial, rubric, mapping);
    expect(a.scores.depth).toBe(0);
    expect(a.total).toBe(4.8);
  });

  it("returns nothing rather than throwing on unusable output", () => {
    expect(parseJudgeScores("I cannot score these.", rubric, mapping)).toEqual([]);
  });

  it("unwraps a fenced reply", () => {
    expect(parseJudgeScores("```json\n" + reply + "\n```", rubric, mapping)).toHaveLength(2);
  });
});

describe("rankByScore", () => {
  const score = (laneId: string, total: number): JudgeScore => ({
    laneId,
    scores: {},
    total,
    justification: "",
    unsupported: [],
  });

  it("puts the highest first", () => {
    expect(rankByScore([score("a", 3), score("b", 9)]).map((s) => s.laneId)).toEqual(["b", "a"]);
  });
});

describe("describeScores", () => {
  it("says so when the judge could not run", () => {
    expect(describeScores([])).toContain("could not be run");
  });

  it("names the judge, so a score is attributable", () => {
    const s: JudgeScore = { laneId: "a", scores: {}, total: 5, justification: "", unsupported: [] };
    expect(describeScores([s], "Sonnet")).toContain("Sonnet");
  });
});

/* -------------------------------------------------------------- synthesis -- */

describe("buildSynthesisPrompt", () => {
  const lanes = [lane("a", "First."), lane("b", "Second."), lane("c", "Third.")];

  it("keeps the answers anonymous", () => {
    const { prompt } = buildSynthesisPrompt({ task: "t", lanes });
    expect(prompt).toContain("Answer A");
    expect(prompt).not.toMatch(/\bmodel a\b/i);
  });

  it("warns against letting the biggest cluster win by weight of numbers", () => {
    const { prompt } = buildSynthesisPrompt({ task: "t", lanes, clusters: [["a", "b"], ["c"]] });
    expect(prompt).toContain("weight of numbers");
  });

  it("asks what the dissenter saw rather than dropping it", () => {
    const { prompt } = buildSynthesisPrompt({ task: "t", lanes, outlier: "c" });
    expect(prompt).toContain("Answer C took a different line");
  });

  it("ignores an outlier that produced no text", () => {
    const { prompt } = buildSynthesisPrompt({ task: "t", lanes: [lane("a", "x"), lane("ghost", "")], outlier: "ghost" });
    expect(prompt).not.toContain("different line");
  });

  it("tells the merge to reuse the source numbers unchanged", () => {
    const { prompt } = buildSynthesisPrompt({
      task: "t",
      lanes,
      evidence: { ...EMPTY_EVIDENCE, sources: [{ title: "S", url: "https://a", snippet: "" }] },
    });
    expect(prompt).toContain("Reuse these numbers exactly");
  });
});

describe("parseSynthesis", () => {
  const good = JSON.stringify({
    answer: "The merged answer [1].",
    agreements: ["both agreed on cost"],
    divergences: ["they split on latency"],
    caveats: ["neither addressed licensing"],
  });

  it("reads a structured reply", () => {
    const s = parseSynthesis(good, "judge-model");
    expect(s.structured).toBe(true);
    expect(s.answer).toContain("[1]");
    expect(s.divergences).toHaveLength(1);
    expect(s.modelId).toBe("judge-model");
  });

  it("keeps prose that ignored the schema, rather than showing nothing", () => {
    // The old contract silently produced an empty synthesis here.
    const s = parseSynthesis("Here is the merged answer in plain prose.");
    expect(s.structured).toBe(false);
    expect(s.answer).toContain("plain prose");
  });

  it("treats JSON without an answer field as unstructured", () => {
    const s = parseSynthesis(JSON.stringify({ agreements: ["x"] }));
    expect(s.structured).toBe(false);
  });

  it("is empty and honest about it for an empty reply", () => {
    const s = parseSynthesis("   ");
    expect(s.answer).toBe("");
    expect(s.structured).toBe(false);
  });

  it("caps the lists so one runaway reply cannot fill the panel", () => {
    const many = JSON.stringify({
      answer: "a",
      agreements: Array.from({ length: 30 }, (_, i) => `a${i}`),
      divergences: [],
      caveats: [],
    });
    expect(parseSynthesis(many).agreements).toHaveLength(6);
  });
});

describe("describeSynthesis", () => {
  it("counts what it found", () => {
    const s = parseSynthesis(
      JSON.stringify({ answer: "a", agreements: ["x", "y"], divergences: ["z"], caveats: [] }),
    );
    expect(describeSynthesis(s)).toContain("2 agreements");
    expect(describeSynthesis(s)).toContain("1 disagreements");
  });

  it("still names the merger when there is nothing to count", () => {
    const s = parseSynthesis("plain prose");
    expect(describeSynthesis(s, "Sonnet")).toContain("Sonnet");
  });
});

describe("salvageAnswer", () => {
  it("recovers the answer from a merge cut off mid-object", () => {
    // Observed live: the merge hit its 2000-token ceiling partway through and
    // the raw string `{ \n\n"answer": "The trade-offs...` was shown to the user.
    const cut = '{ \n\n"answer": "The trade-offs between RAG and long-context prompting are';
    expect(salvageAnswer(cut)).toBe("The trade-offs between RAG and long-context prompting are");
  });

  it("stops at the closing quote when the field was complete", () => {
    expect(salvageAnswer('{"answer": "Done.", "agreements": []}')).toBe("Done.");
  });

  it("unescapes newlines so the recovered text reads as prose", () => {
    expect(salvageAnswer('{"answer": "One.\\nTwo.')).toBe("One.\nTwo.");
  });

  it("keeps an escaped quote inside the answer", () => {
    expect(salvageAnswer('{"answer": "He said \\"yes\\" clearly')).toBe('He said "yes" clearly');
  });

  it("does not touch prose that merely starts with a brace", () => {
    expect(salvageAnswer("{ this is not JSON at all }")).toBeNull();
  });

  it("returns null when there is no answer field to find", () => {
    expect(salvageAnswer('{"agreements": ["x"]}')).toBeNull();
  });

  it("returns null for an empty answer field", () => {
    expect(salvageAnswer('{"answer": "')).toBeNull();
  });
});

describe("parseSynthesis truncation recovery", () => {
  const cut = '{ "answer": "RAG is cheaper at scale but can miss context that spans chunks';

  it("shows the merge rather than braces", () => {
    const s = parseSynthesis(cut);
    expect(s.answer).toBe("RAG is cheaper at scale but can miss context that spans chunks");
    expect(s.answer).not.toContain("{");
  });

  it("marks it truncated, so missing lists read as missing not empty", () => {
    expect(parseSynthesis(cut).truncated).toBe(true);
    expect(parseSynthesis(cut).structured).toBe(false);
  });

  it("does not mark a complete structured merge as truncated", () => {
    const good = JSON.stringify({ answer: "a", agreements: [], divergences: [], caveats: [] });
    expect(parseSynthesis(good).truncated).toBeUndefined();
  });

  it("still keeps genuine prose that ignored the schema", () => {
    const s = parseSynthesis("Here is the merged answer in plain prose.");
    expect(s.answer).toContain("plain prose");
    expect(s.truncated).toBeUndefined();
  });
});

describe("SYNTHESIS_SCHEMA field order", () => {
  it("emits the bounded lists before the unbounded answer", () => {
    // Measured live: with `answer` first, an 8B synthesizer spent the whole
    // output budget on prose and the lists never arrived — and a 250-word
    // instruction did not change it. Order is the fix, not the wording.
    expect(SYNTHESIS_SCHEMA.schema.required).toEqual([
      "agreements",
      "divergences",
      "caveats",
      "answer",
    ]);
    expect(Object.keys(SYNTHESIS_SCHEMA.schema.properties).at(-1)).toBe("answer");
  });
});

describe("repairTruncatedJson", () => {
  it("recovers the lists from a merge cut off inside the answer", () => {
    const cut =
      '{"agreements":["RAG is cheaper"],"divergences":["they split on latency"],' +
      '"caveats":[],"answer":"The trade-offs are';
    const out = repairTruncatedJson(cut)!;
    expect(out.agreements).toEqual(["RAG is cheaper"]);
    expect(out.divergences).toEqual(["they split on latency"]);
    expect(out.answer).toBe("The trade-offs are");
  });

  it("recovers a reply cut between fields", () => {
    const cut = '{"agreements":["a","b"],"divergences":[';
    expect(repairTruncatedJson(cut)!.agreements).toEqual(["a", "b"]);
  });

  it("recovers a reply cut inside a key", () => {
    const cut = '{"agreements":["a"],"diverg';
    expect(repairTruncatedJson(cut)!.agreements).toEqual(["a"]);
  });

  it("handles an escape sequence at the cut", () => {
    // A reply that stopped mid-escape: the trailing backslash must not be
    // treated as escaping the closing quote the repair appends.
    const cut = '{"answer":"line one' + String.fromCharCode(92);
    expect(repairTruncatedJson(cut)).not.toBeNull();
  });

  it("unwraps a fence the model opened and never closed", () => {
    const cut = '```json' + String.fromCharCode(10) + '{"agreements":["x"],"answer":"partial';
    expect(repairTruncatedJson(cut)!.agreements).toEqual(["x"]);
  });

  it("returns null for prose that is not JSON at all", () => {
    expect(repairTruncatedJson("Here is my merged answer.")).toBeNull();
  });

  it("returns null for an array rather than inventing an object", () => {
    expect(repairTruncatedJson('["a","b"')).toBeNull();
  });
});

describe("parseSynthesis truncation keeps the lists", () => {
  const cut =
    '{"agreements":["both agreed on cost"],"divergences":["they split on latency"],' +
    '"caveats":["neither covered licensing"],"answer":"RAG keeps the prompt small but';

  it("returns the completed lists instead of dropping them", () => {
    const s = parseSynthesis(cut);
    expect(s.agreements).toEqual(["both agreed on cost"]);
    expect(s.divergences).toEqual(["they split on latency"]);
    expect(s.caveats).toEqual(["neither covered licensing"]);
  });

  it("keeps the partial answer and marks the merge truncated", () => {
    const s = parseSynthesis(cut);
    expect(s.answer).toBe("RAG keeps the prompt small but");
    expect(s.truncated).toBe(true);
    expect(s.structured).toBe(false);
  });
});
