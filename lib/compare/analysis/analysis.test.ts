import { describe, it, expect } from "vitest";
import { analyseRun, headlines } from "./index";
import { hedgeProfile, lengthProfile, profileText, structureProfile, stripCode } from "./text";
import { describeCitations, profileCitations, sourceCoverage } from "./citations";
import { checkCompliance, graderForRule } from "./compliance";
import { CLUSTER_THRESHOLD, cluster, compareAnswers, cosine, vectorize } from "./similarity";
import { QUALITY_FLOOR, decideVerdict, efficiencyFrontier, laneMetrics } from "./metrics";
import { emptyStages, type CompareRun, type JudgeScore, type LaneState } from "../types";

const lane = (id: string, over: Partial<LaneState> = {}): LaneState => ({
  id,
  modelId: id,
  band: 0,
  fit: "stuff",
  maxTokens: 1_000,
  budgetUsd: 0.1,
  status: "done",
  text: "",
  reasoning: "",
  meters: {},
  ...over,
});

const run = (over: Partial<CompareRun> = {}): CompareRun => ({
  id: "r1",
  createdAt: 0,
  updatedAt: 0,
  config: { question: "q", modelIds: [], depth: "standard" },
  stages: emptyStages(),
  lanes: [],
  ...over,
});

/* ------------------------------------------------------------------- text -- */

describe("stripCode", () => {
  it("removes fenced blocks so syntax cannot skew prose measures", () => {
    expect(stripCode("before\n```js\nconst x = 1;\n```\nafter")).not.toContain("const");
  });

  it("removes an unterminated fence too", () => {
    expect(stripCode("prose\n```js\nnever closed")).not.toContain("never closed");
  });
});

describe("structureProfile", () => {
  it("counts headings, list items and links", () => {
    const p = structureProfile("# Title\n\n- one\n- two\n\nSee https://example.com");
    expect(p.headings).toBe(1);
    expect(p.listItems).toBe(2);
    expect(p.links).toBe(1);
  });

  it("does not call a sentence containing a pipe a table", () => {
    expect(structureProfile("Use a | b to pipe output.").tables).toBe(0);
  });

  it("counts a real markdown table", () => {
    expect(structureProfile("| a | b |\n| --- | --- |\n| 1 | 2 |").tables).toBeGreaterThan(0);
  });

  it("counts an unterminated fence as an attempted block", () => {
    // Truncation is common, and the block was still attempted.
    expect(structureProfile("```js\nconst x = 1;").codeBlocks).toBe(1);
  });
});

describe("lengthProfile", () => {
  it("is all zeroes for empty text rather than NaN", () => {
    expect(lengthProfile("   ")).toEqual({ words: 0, sentences: 0, meanSentenceWords: 0, gradeLevel: 0 });
  });

  it("counts a trailing fragment as a sentence", () => {
    expect(lengthProfile("No terminator here").sentences).toBe(1);
  });

  it("never reports a negative grade level", () => {
    expect(lengthProfile("Go. Run. Sit.").gradeLevel).toBeGreaterThanOrEqual(0);
  });

  it("rates dense prose harder than simple prose", () => {
    const simple = lengthProfile("The cat sat. The dog ran. The bird flew.");
    const dense = lengthProfile(
      "Notwithstanding the aforementioned architectural considerations, the implementation " +
        "necessitates comprehensive evaluation of concurrency characteristics throughout deployment.",
    );
    expect(dense.gradeLevel).toBeGreaterThan(simple.gradeLevel);
  });
});

describe("hedgeProfile", () => {
  it("separates a hedged answer from a committed one", () => {
    const hedged = hedgeProfile("This may possibly be somewhat faster in certain cases.");
    const firm = hedgeProfile("This is always faster. It never fails.");
    expect(hedged.commitment).toBeLessThan(0);
    expect(firm.commitment).toBeGreaterThan(0);
  });

  it("is neutral when neither appears", () => {
    expect(hedgeProfile("The system reads from disk.").commitment).toBe(0);
  });

  it("does not match a hedge inside a longer word", () => {
    // "may" must not fire on "maybe" or "dismay".
    expect(hedgeProfile("Dismay is not a hedge.").hedges).toBe(0);
  });

  it("normalises density by length so answers are comparable", () => {
    const short = hedgeProfile("It may work.");
    const long = hedgeProfile(`It may work. ${"filler word ".repeat(50)}`);
    expect(short.hedgeDensity).toBeGreaterThan(long.hedgeDensity);
  });
});

describe("profileText", () => {
  it("returns all three profiles", () => {
    const p = profileText("# Hi\n\nIt may work.");
    expect(p.structure.headings).toBe(1);
    expect(p.length.words).toBeGreaterThan(0);
    expect(p.hedging.hedges).toBe(1);
  });
});

/* -------------------------------------------------------------- citations -- */

describe("profileCitations", () => {
  it("counts repeats separately from distinct sources", () => {
    const p = profileCitations("Per [1] and [1] and [2].", 3);
    expect(p.cited).toEqual([1, 2]);
    expect(p.markers).toBe(3);
  });

  it("flags a citation the pack does not contain", () => {
    // The highest-value free signal: the answer reads grounded and is not.
    expect(profileCitations("As shown in [14].", 12).fabricated).toEqual([14]);
  });

  it("does not flag anything when every marker is real", () => {
    expect(profileCitations("See [1][2].", 5).fabricated).toEqual([]);
  });

  it("treats every marker as fabricated when there are no sources", () => {
    expect(profileCitations("See [1].", 0).fabricated).toEqual([1]);
  });
});

describe("sourceCoverage", () => {
  const lanes = [
    { id: "a", text: "Per [1] and [2]." },
    { id: "b", text: "Per [1]." },
    { id: "c", text: "" },
  ];

  it("records which lanes cited each source", () => {
    const r = sourceCoverage(lanes, 3);
    expect(r.usage[0].laneIds).toEqual(["a", "b"]);
    expect(r.usage[1].laneIds).toEqual(["a"]);
  });

  it("reports sources nobody read", () => {
    expect(sourceCoverage(lanes, 3).unused).toEqual([3]);
  });

  it("does not let a failed lane make universal coverage impossible", () => {
    // Lane c produced nothing; source 1 was still cited by every lane that answered.
    expect(sourceCoverage(lanes, 3).universal).toEqual([1]);
  });

  it("reports coverage as a share of the pack", () => {
    expect(sourceCoverage(lanes, 4).coverage).toBe(0.5);
  });

  it("is zero-safe with no sources", () => {
    expect(sourceCoverage(lanes, 0).coverage).toBe(0);
  });
});

describe("describeCitations", () => {
  it("leads with fabrication when there is any", () => {
    expect(describeCitations(profileCitations("[9]", 3), 3)).toContain("not exist");
  });

  it("pluralises when several markers were invented", () => {
    expect(describeCitations(profileCitations("[9][10]", 3), 3)).toContain("do not exist");
  });

  it("says so when an answer is ungrounded", () => {
    expect(describeCitations(profileCitations("no markers", 3), 3)).toContain("ungrounded");
  });
});

/* ------------------------------------------------------------- compliance -- */

describe("graderForRule", () => {
  it("derives a JSON check", () => {
    expect(graderForRule("Reply as JSON")).toEqual({ type: "json" });
  });

  it("derives an exact word count", () => {
    expect(graderForRule("Use exactly 50 words")).toEqual({ type: "wordcount", value: 50 });
  });

  it("refuses to use an equality grader for a bound", () => {
    // `wordcount` tests equality; using it for "at most 200" would fail every
    // answer that came in under the limit.
    expect(graderForRule("At most 200 words")).toBeUndefined();
  });

  it("derives nothing from a rule with no threshold", () => {
    expect(graderForRule("Be concise")).toBeUndefined();
  });

  it("derives a contains check from a quoted phrase", () => {
    expect(graderForRule('Include the phrase "trade-off"')).toEqual({
      type: "contains",
      value: "trade-off",
    });
  });
});

describe("checkCompliance", () => {
  it("passes an answer under a word limit", () => {
    const r = checkCompliance(["At most 10 words"], "Three words here.");
    expect(r.passed).toBe(1);
    expect(r.failed).toBe(0);
  });

  it("fails an answer over a word limit", () => {
    const r = checkCompliance(["At most 3 words"], "One two three four five.");
    expect(r.failed).toBe(1);
  });

  it("honours a minimum", () => {
    expect(checkCompliance(["At least 5 words"], "Too short.").failed).toBe(1);
  });

  it("reports a rule it could not check rather than passing it", () => {
    const r = checkCompliance(["Be insightful"], "anything");
    expect(r.unchecked).toBe(1);
    expect(r.score).toBeNull();
  });

  it("scores only the checkable rules", () => {
    const r = checkCompliance(["Reply as JSON", "Be insightful"], '{"ok":true}');
    expect(r.score).toBe(1);
    expect(r.unchecked).toBe(1);
  });

  it("has no opinion when there are no rules", () => {
    expect(checkCompliance([], "anything").score).toBeNull();
  });

  it("ignores code fences when counting words for a limit", () => {
    const answer = "Two words.\n```\n" + "x ".repeat(500) + "\n```";
    expect(checkCompliance(["At most 10 words"], answer).failed).toBe(0);
  });
});

/* ------------------------------------------------------------- similarity -- */

describe("cosine", () => {
  it("is 1 for identical text", () => {
    const v = vectorize("retrieval augmented generation trade-offs");
    expect(cosine(v, v)).toBeCloseTo(1, 10);
  });

  it("is 0 for nothing shared", () => {
    expect(cosine(vectorize("sourdough baking bread"), vectorize("kubernetes cluster nodes"))).toBe(0);
  });

  it("is 0 against empty text rather than NaN", () => {
    expect(cosine(vectorize(""), vectorize("anything here"))).toBe(0);
  });

  it("ignores fenced code, which is syntax not substance", () => {
    const a = vectorize("the answer discusses retrieval");
    const b = vectorize("the answer discusses retrieval\n```\nfunction foo(){return 1}\n```");
    expect(cosine(a, b)).toBeCloseTo(1, 2);
  });
});

describe("cluster", () => {
  it("groups transitively so A~B~C is one group", () => {
    const m = {
      a: { a: 1, b: 0.9, c: 0.1 },
      b: { a: 0.9, b: 1, c: 0.9 },
      c: { a: 0.1, b: 0.9, c: 1 },
    };
    expect(cluster(["a", "b", "c"], m)).toEqual([["a", "b", "c"]]);
  });

  it("leaves a dissenter on its own", () => {
    const m = {
      a: { a: 1, b: 0.9, c: 0.1 },
      b: { a: 0.9, b: 1, c: 0.1 },
      c: { a: 0.1, b: 0.1, c: 1 },
    };
    const groups = cluster(["a", "b", "c"], m);
    expect(groups[0]).toHaveLength(2);
    expect(groups[1]).toEqual(["c"]);
  });
});

describe("compareAnswers", () => {
  it("excludes lanes with no text rather than scoring them zero", () => {
    // A failed lane is not a dissenting opinion.
    const r = compareAnswers([
      { id: "a", text: "retrieval augmented generation" },
      { id: "b", text: "" },
    ]);
    expect(r.pairs).toHaveLength(0);
    expect(Object.keys(r.matrix)).toEqual(["a"]);
  });

  it("names the outlier when the rest agree", () => {
    const shared = "retrieval augmented generation reduces context cost substantially";
    const r = compareAnswers([
      { id: "a", text: shared },
      { id: "b", text: shared },
      { id: "c", text: "sourdough baking requires patience and flour" },
    ]);
    expect(r.outlier).toBe("c");
  });

  it("names no outlier with only two lanes", () => {
    const r = compareAnswers([
      { id: "a", text: "one topic entirely" },
      { id: "b", text: "completely different subject" },
    ]);
    expect(r.outlier).toBeUndefined();
  });

  it("reports high consensus when answers converge", () => {
    const shared = "retrieval augmented generation reduces context cost";
    const r = compareAnswers([
      { id: "a", text: shared },
      { id: "b", text: shared },
    ]);
    expect(r.consensus).toBeGreaterThan(CLUSTER_THRESHOLD);
  });
});

/* ---------------------------------------------------------------- metrics -- */

describe("laneMetrics", () => {
  it("measures throughput over generation time, not wall time", () => {
    // A fast model on a slow queue is not a slow model.
    const m = laneMetrics(lane("a", { meters: { ttftMs: 9_000, totalMs: 10_000, completionTokens: 100 } }));
    expect(m.throughput).toBe(100);
  });

  it("marks cost unknown when the provider reported no usage", () => {
    expect(laneMetrics(lane("a")).costUnknown).toBe(true);
  });

  it("does not report throughput without a token count", () => {
    expect(laneMetrics(lane("a", { meters: { totalMs: 1_000 } })).throughput).toBeUndefined();
  });
});

describe("decideVerdict", () => {
  const scores = (map: Record<string, number>): JudgeScore[] =>
    Object.entries(map).map(([laneId, total]) => ({
      laneId,
      scores: {},
      total,
      justification: "",
      unsupported: [],
    }));

  const lanes = [
    lane("cheap", { text: "answer", meters: { totalMs: 1_000, promptTokens: 10, completionTokens: 10 } }),
    lane("dear", { text: "answer", meters: { totalMs: 9_000, promptTokens: 10, completionTokens: 10 } }),
  ];

  it("awards nothing when no lane finished", () => {
    expect(decideVerdict({ lanes: [lane("a", { status: "error" })] })).toEqual({ reasons: {} });
  });

  it("picks the highest score overall", () => {
    const v = decideVerdict({ lanes, scores: scores({ cheap: 6, dear: 9 }) });
    expect(v.bestOverall).toBe("dear");
  });

  it("leaves the quality awards empty without a judge", () => {
    // Inventing a winner from length or speed would be a leaderboard, not a result.
    const v = decideVerdict({ lanes });
    expect(v.bestOverall).toBeUndefined();
    expect(v.fastestAcceptable).toBe("cheap");
  });

  it("does not give fastest to a lane below the quality floor", () => {
    const v = decideVerdict({ lanes, scores: scores({ cheap: 1, dear: 10 }) });
    expect(v.fastestAcceptable).toBe("dear");
  });

  it("gives fastest to a quick lane that is close enough", () => {
    const v = decideVerdict({ lanes, scores: scores({ cheap: 10 * QUALITY_FLOOR, dear: 10 }) });
    expect(v.fastestAcceptable).toBe("cheap");
  });

  it("explains every award it gives", () => {
    const v = decideVerdict({ lanes, scores: scores({ cheap: 6, dear: 9 }) });
    for (const id of [v.bestOverall, v.bestValue, v.fastestAcceptable]) {
      if (id) expect(v.reasons[id]).toBeTruthy();
    }
  });

  it("ignores a lane with no text even if it says done", () => {
    const v = decideVerdict({ lanes: [lane("empty", { text: "  " })] });
    expect(v.fastestAcceptable).toBeUndefined();
  });
});

describe("efficiencyFrontier", () => {
  it("marks a lane dominated when another is cheaper and better", () => {
    const lanes = [
      lane("good-cheap", { text: "x", meters: { promptTokens: 1, completionTokens: 1 } }),
      lane("bad-dear", { text: "x", meters: { promptTokens: 1, completionTokens: 1 } }),
    ];
    const points = efficiencyFrontier(lanes, [
      { laneId: "good-cheap", scores: {}, total: 9, justification: "", unsupported: [] },
      { laneId: "bad-dear", scores: {}, total: 3, justification: "", unsupported: [] },
    ]);
    // Both cost 0 here (no catalog pricing), so the lower score is dominated.
    expect(points.find((p) => p.laneId === "bad-dear")?.efficient).toBe(false);
    expect(points.find((p) => p.laneId === "good-cheap")?.efficient).toBe(true);
  });

  it("is empty without scores, since there is no quality axis", () => {
    expect(efficiencyFrontier([lane("a", { text: "x" })], [])).toEqual([]);
  });
});

/* --------------------------------------------------------------- analyseRun -- */

describe("analyseRun", () => {
  const full = run({
    brief: {
      task: "t",
      shape: "answer",
      rubric: { criteria: [], groundRules: ["At most 5 words"] },
      researchQueries: [],
    },
    evidence: {
      sources: [
        { title: "One", url: "https://a", snippet: "" },
        { title: "Two", url: "https://b", snippet: "" },
      ],
      documents: [],
      queriesRun: [],
      rounds: 1,
      failedQueries: 0,
      stoppedBy: null,
    },
    lanes: [
      lane("a", { text: "Short answer [1]." }),
      lane("b", { text: "A considerably longer answer that breaks the rule [9]." }),
    ],
  });

  it("gives every lane an entry, including ones that produced nothing", () => {
    const a = analyseRun(run({ lanes: [lane("dead", { status: "error" })] }));
    expect(Object.keys(a.lanes)).toEqual(["dead"]);
  });

  it("measures citations against the real pack size", () => {
    const a = analyseRun(full);
    expect(a.lanes.b.citations.fabricated).toEqual([9]);
  });

  it("applies the brief's ground rules to every lane", () => {
    const a = analyseRun(full);
    expect(a.lanes.a.compliance.failed).toBe(0);
    expect(a.lanes.b.compliance.failed).toBe(1);
  });

  it("reports sources nobody cited", () => {
    expect(analyseRun(full).coverage.unused).toEqual([2]);
  });

  it("has an empty frontier without a judge", () => {
    expect(analyseRun(full).frontier).toEqual([]);
  });
});

describe("headlines", () => {
  const nameOf = (id: string) => id.toUpperCase();

  it("leads with a fabricated citation", () => {
    const r = run({
      evidence: {
        sources: [{ title: "One", url: "https://a", snippet: "" }],
        documents: [],
        queriesRun: [],
        rounds: 1,
        failedQueries: 0,
        stoppedBy: null,
      },
      lanes: [lane("a", { text: "See [7]." })],
    });
    expect(headlines(r, analyseRun(r), nameOf)[0]).toContain("do not exist");
  });

  it("says when the extra lanes bought nothing", () => {
    const shared = "retrieval augmented generation reduces context cost substantially";
    const r = run({ lanes: [lane("a", { text: shared }), lane("b", { text: shared })] });
    expect(headlines(r, analyseRun(r), nameOf).join(" ")).toContain("added little");
  });

  it("says so when research ran and found nothing", () => {
    // Every lane then answers from memory while the brief still says "base this
    // on recent research". Silence would read as "research happened".
    const r = run({
      evidence: { sources: [], documents: [], queriesRun: ["a", "b"], rounds: 1, failedQueries: 0, stoppedBy: null },
      lanes: [lane("a", { text: "an ungrounded answer" })],
    });
    expect(headlines(r, analyseRun(r), nameOf).join(" ")).toContain("ungrounded");
  });

  it("distinguishes a blocked search backend from a topic with no coverage", () => {
    // Both produce an empty pack; only one is worth retrying, and only one
    // means the answers are ungrounded for a reason the user can act on.
    const r = run({
      evidence: { sources: [], documents: [], queriesRun: ["a", "b"], rounds: 1, failedQueries: 2, stoppedBy: null },
      lanes: [lane("a", { text: "an ungrounded answer" })],
    });
    expect(headlines(r, analyseRun(r), nameOf).join(" ")).toContain("Search failed on 2");
  });

  it("does not claim ungrounded when no research was attempted", () => {
    const r = run({ lanes: [lane("a", { text: "an answer" })] });
    expect(headlines(r, analyseRun(r), nameOf).join(" ")).not.toContain("ungrounded");
  });

  it("is empty when there is nothing worth saying", () => {
    expect(headlines(run(), analyseRun(run()), nameOf)).toEqual([]);
  });
});
