import { describe, it, expect } from "vitest";
import {
  BRIEF_SCHEMA,
  MAX_CRITERIA,
  MIN_CRITERIA,
  briefPrompt,
  defaultRubric,
  describeBrief,
  fallbackBrief,
  needsEvidence,
  normalizeRubric,
  parseBrief,
  plausibleRestatement,
  normalizeQuery,
  MAX_QUERY_WORDS,
} from "./brief";
import type { Rubric } from "./types";

const rubric = (weights: number[]): Rubric => ({
  criteria: weights.map((w, i) => ({
    id: `c${i}`,
    name: `Criterion ${i}`,
    description: "",
    weight: w,
  })),
  groundRules: [],
});

describe("normalizeRubric", () => {
  it("turns any weight scale into a distribution", () => {
    const out = normalizeRubric(rubric([50, 30, 20]));
    expect(out.criteria.map((c) => c.weight)).toEqual([0.5, 0.3, 0.2]);
  });

  it("sums to one whatever the input scale", () => {
    const out = normalizeRubric(rubric([3, 1, 1, 1]));
    expect(out.criteria.reduce((a, c) => a + c.weight, 0)).toBeCloseTo(1, 10);
  });

  it("falls back to equal weighting when nothing counts", () => {
    // A rubric where every weight is zero is a bad model reply, not an
    // instruction to score the whole run as zero.
    const out = normalizeRubric(rubric([0, 0]));
    expect(out.criteria.map((c) => c.weight)).toEqual([0.5, 0.5]);
  });

  it("ignores negative and non-finite weights", () => {
    const out = normalizeRubric(rubric([-4, 2, Number.NaN]));
    expect(out.criteria.reduce((a, c) => a + c.weight, 0)).toBeCloseTo(1, 10);
    expect(out.criteria[1].weight).toBe(1);
  });

  it("drops unnamed criteria", () => {
    const out = normalizeRubric({
      criteria: [
        { id: "a", name: "Real", description: "", weight: 1 },
        { id: "b", name: "  ", description: "", weight: 1 },
      ],
      groundRules: [],
    });
    expect(out.criteria).toHaveLength(1);
  });
});

describe("parseBrief", () => {
  const ASKED = "What are the trade-offs between RAG and long-context prompting for a 200-page corpus?";
  const good = JSON.stringify({
    task: "Compare RAG and long-context prompting for a 200-page corpus.",
    shape: "research",
    criteria: [
      { name: "Trade-off clarity", description: "Names the real trade-off", weight: 2 },
      { name: "Cost realism", description: "Accounts for token cost", weight: 1 },
    ],
    groundRules: ["At most 200 words"],
    researchQueries: ["RAG vs long context 2026", "long context cost per token"],
  });

  it("reads a well-formed reply", () => {
    const b = parseBrief(good, ASKED, "planner-model");
    expect(b.shape).toBe("research");
    expect(b.task).toContain("200-page");
    expect(b.researchQueries).toHaveLength(2);
    expect(b.modelId).toBe("planner-model");
  });

  it("normalises the weights it was given", () => {
    const b = parseBrief(good, ASKED);
    expect(b.rubric.criteria.reduce((a, c) => a + c.weight, 0)).toBeCloseTo(1, 10);
  });

  it("gives criteria stable ids derived from their names", () => {
    const b = parseBrief(good, ASKED);
    expect(b.rubric.criteria[0].id).toBe("trade-off-clarity");
  });

  it("unwraps a fenced reply", () => {
    const b = parseBrief("```json\n" + good + "\n```", "q");
    expect(b.shape).toBe("research");
  });

  it("falls back rather than throwing on unparseable output", () => {
    const b = parseBrief("I'd be happy to help with that!", "the original question");
    expect(b.task).toBe("the original question");
    expect(b.rubric.criteria.length).toBeGreaterThanOrEqual(MIN_CRITERIA);
  });

  it("rejects a category label posing as a restatement", () => {
    // Observed from an 8B model: asked to restate "What are the trade-offs
    // between RAG and long-context prompting?" it answered "technical
    // comparison". Taken at face value, every lane is asked that instead.
    const question = "What are the trade-offs between RAG and long-context prompting?";
    const b = parseBrief(
      JSON.stringify({ task: "technical comparison", shape: "answer", criteria: [] }),
      question,
    );
    expect(b.task).toBe(question);
  });

  it("accepts a genuine restatement", () => {
    const question = "What are the trade-offs between RAG and long-context prompting?";
    const restated =
      "Compare retrieval-augmented generation against long-context prompting, naming the trade-offs for each.";
    const b = parseBrief(
      JSON.stringify({ task: restated, shape: "answer", criteria: [] }),
      question,
    );
    expect(b.task).toBe(restated);
  });

  it("keeps the user's question when the model omits a task", () => {
    const b = parseBrief(JSON.stringify({ shape: "answer", criteria: [] }), "my question");
    expect(b.task).toBe("my question");
  });

  it("rejects a shape it does not recognise", () => {
    const b = parseBrief(JSON.stringify({ shape: "vibes", criteria: [] }), "q");
    expect(b.shape).toBe("answer");
  });

  it("takes the fallback rubric when the model returned too few criteria", () => {
    const b = parseBrief(
      JSON.stringify({ task: "t", shape: "answer", criteria: [{ name: "One", description: "", weight: 1 }] }),
      "q",
    );
    expect(b.rubric.criteria.length).toBeGreaterThanOrEqual(MIN_CRITERIA);
  });

  it("keeps ground rules even when the rubric fell back", () => {
    const b = parseBrief(
      JSON.stringify({ shape: "answer", criteria: [], groundRules: ["JSON only"] }),
      "q",
    );
    expect(b.rubric.groundRules).toEqual(["JSON only"]);
  });

  it("caps criteria and queries", () => {
    const many = JSON.stringify({
      task: "t",
      shape: "answer",
      criteria: Array.from({ length: 12 }, (_, i) => ({ name: `C${i}`, description: "", weight: 1 })),
      researchQueries: Array.from({ length: 20 }, (_, i) => `q${i}`),
    });
    const b = parseBrief(many, "q");
    expect(b.rubric.criteria.length).toBeLessThanOrEqual(MAX_CRITERIA);
    expect(b.researchQueries.length).toBeLessThanOrEqual(8);
  });

  it("drops non-string queries rather than searching them", () => {
    const b = parseBrief(
      JSON.stringify({ task: "t", shape: "answer", criteria: [], researchQueries: ["RAG cost", 42, null, "  "] }),
      "q",
    );
    expect(b.researchQueries).toEqual(["RAG cost"]);
  });
});

describe("defaultRubric", () => {
  it("scores a build task on whether it works", () => {
    expect(defaultRubric("build").criteria.map((c) => c.id)).toContain("works");
  });

  it("is already normalised", () => {
    expect(defaultRubric("answer").criteria.reduce((a, c) => a + c.weight, 0)).toBeCloseTo(1, 10);
  });
});

describe("needsEvidence", () => {
  it("is false when the user turned web search off, whatever the brief asked for", () => {
    const b = { ...fallbackBrief("q"), researchQueries: ["something"] };
    expect(needsEvidence(b, false)).toBe(false);
  });

  it("is false when the brief asked for no searches", () => {
    expect(needsEvidence(fallbackBrief("q"))).toBe(false);
  });

  it("is true when the brief asked for searches", () => {
    expect(needsEvidence({ ...fallbackBrief("q"), researchQueries: ["a"] })).toBe(true);
  });
});

describe("briefPrompt", () => {
  it("tells the planner not to search when the user turned it off", () => {
    expect(briefPrompt("q", { web: false })).toContain("empty researchQueries");
  });

  it("does not constrain searching either way by default", () => {
    const p = briefPrompt("q");
    expect(p).not.toContain("turned web search");
  });
});

describe("BRIEF_SCHEMA", () => {
  it("requires every field, so nothing can be quietly omitted", () => {
    expect(BRIEF_SCHEMA.schema.required).toEqual([
      "task",
      "shape",
      "criteria",
      "groundRules",
      "researchQueries",
    ]);
  });

  it("bounds the rubric to a readable size", () => {
    expect(BRIEF_SCHEMA.schema.properties.criteria.minItems).toBe(MIN_CRITERIA);
    expect(BRIEF_SCHEMA.schema.properties.criteria.maxItems).toBe(MAX_CRITERIA);
  });
});

describe("describeBrief", () => {
  it("names the shape when it is not a plain answer", () => {
    const b = parseBrief(
      JSON.stringify({
        task: "t",
        shape: "build",
        criteria: [
          { name: "A", description: "", weight: 1 },
          { name: "B", description: "", weight: 1 },
        ],
      }),
      "q",
    );
    expect(describeBrief(b)).toContain("build task");
    expect(describeBrief(b)).toContain("2 criteria");
  });
});

describe("plausibleRestatement", () => {
  const question = "What are the trade-offs between RAG and long-context prompting?";

  it("rejects an empty candidate", () => {
    expect(plausibleRestatement("", question)).toBe(false);
  });

  it("rejects something far shorter than the question", () => {
    expect(plausibleRestatement("technical comparison", question)).toBe(false);
  });

  it("rejects a long answer that is about something else", () => {
    expect(
      plausibleRestatement(
        "Describe the history of the printing press in Europe and its social consequences.",
        question,
      ),
    ).toBe(false);
  });

  it("accepts a longer, more precise restatement", () => {
    expect(
      plausibleRestatement(
        "Compare retrieval augmented generation with long context prompting and name the trade-offs.",
        question,
      ),
    ).toBe(true);
  });

  it("does not reject when the question has no content words to match", () => {
    expect(plausibleRestatement("Some restated task here", "why?")).toBe(true);
  });
});

describe("normalizeQuery", () => {
  it("strips a parenthetical date range, which returns nothing from a scrape backend", () => {
    // Observed live: six queries in this shape returned zero sources and zero
    // failures, so the run reported a clean research stage that found nothing.
    expect(normalizeQuery("Recent studies on RAG and long-context prompting (2020-2026)")).toBe(
      "Recent studies on RAG and long-context prompting",
    );
  });

  it("drops punctuation but keeps hyphenated terms whole", () => {
    expect(normalizeQuery("What is long-context prompting?")).toBe("What is long-context prompting");
  });

  it("collapses whitespace", () => {
    expect(normalizeQuery("  RAG   vs    long context  ")).toBe("RAG vs long context");
  });

  it("removes quotes a model wrapped the query in", () => {
    expect(normalizeQuery('"RAG benchmarks"')).toBe("RAG benchmarks");
  });
});

describe("parseBrief query tidying", () => {
  const withQueries = (queries: string[]) =>
    parseBrief(
      JSON.stringify({ task: "t", shape: "research", criteria: [], researchQueries: queries }),
      "q",
    ).researchQueries;

  it("normalises what the model proposed", () => {
    expect(withQueries(["RAG cost comparison (2026)"])[0]).toBe("RAG cost comparison");
  });

  it("caps a rambling query to something a search engine accepts", () => {
    const long = Array.from({ length: 25 }, (_, i) => `word${i}`).join(" ");
    expect(withQueries([long])[0].split(" ")).toHaveLength(MAX_QUERY_WORDS);
  });

  it("drops duplicates that only differed by punctuation", () => {
    expect(withQueries(["RAG vs long context", "RAG vs long-context?"])).toHaveLength(2);
    expect(withQueries(["RAG cost", "RAG cost."])).toHaveLength(1);
  });

  it("drops a query that normalises to nothing", () => {
    expect(withQueries(["???", "(2026)", "RAG cost"])).toEqual(["RAG cost"]);
  });
});
