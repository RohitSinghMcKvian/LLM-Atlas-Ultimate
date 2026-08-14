import { describe, it, expect, vi } from "vitest";
import {
  ENOUGH_SOURCES,
  firstRoundQueries,
  keywords,
  laterRoundQueries,
  localPlanner,
  modelPlanner,
  parsePlannedQueries,
} from "./planner";
import type { WebSource } from "@/lib/chat/types";

const sources = (n: number): WebSource[] =>
  Array.from({ length: n }, (_, i) => ({
    title: `S${i}`,
    url: `https://a.test/${i}`,
    snippet: "",
  }));

describe("keywords", () => {
  it("drops stop words and short tokens", () => {
    expect(keywords("What is the best way to do it")).toEqual(["best", "way"]);
  });

  it("keeps hyphenated and apostrophised terms", () => {
    expect(keywords("open-source model's licence")).toEqual([
      "open-source",
      "model's",
      "licence",
    ]);
  });

  it("returns nothing for an all-stopword question", () => {
    expect(keywords("what is it")).toEqual([]);
  });
});

describe("firstRoundQueries", () => {
  const q = "Which vector database should I use for a small RAG app?";

  it("asks the question as posed, first", () => {
    expect(firstRoundQueries(q)[0].query).toBe(q);
  });

  it("adds a recency angle", () => {
    expect(firstRoundQueries(q, 2026).some((x) => x.query.includes("2026"))).toBe(true);
  });

  // The failure mode of one-shot search: a positive-framed query never surfaces
  // the criticism.
  it("adds a counter-evidence angle", () => {
    expect(firstRoundQueries(q).some((x) => x.query.includes("criticism"))).toBe(true);
  });

  it("gives every query a rationale for the progress UI", () => {
    expect(firstRoundQueries(q).every((x) => !!x.rationale)).toBe(true);
  });

  it("falls back to the raw question when there are no keywords", () => {
    expect(firstRoundQueries("what is it").every((x) => x.query.length > 0)).toBe(true);
  });
});

describe("laterRoundQueries", () => {
  it("broadens along new angles per round", () => {
    const r1 = laterRoundQueries("vector database", 1).map((q) => q.query);
    const r2 = laterRoundQueries("vector database", 2).map((q) => q.query);
    expect(r1).not.toEqual(r2);
    expect(r1.some((q) => q.includes("alternatives"))).toBe(true);
  });

  it("runs out of angles rather than repeating forever", () => {
    expect(laterRoundQueries("x", 9)).toEqual([]);
  });
});

describe("localPlanner", () => {
  const plan = localPlanner();

  it("decomposes on the first round", async () => {
    expect((await plan("q", [], 0)).length).toBeGreaterThan(1);
  });

  // The budget exists to be left unspent when it can be.
  it("stops once enough has been found", async () => {
    expect(await plan("q", sources(ENOUGH_SOURCES), 1)).toEqual([]);
  });

  it("broadens when the first round was thin", async () => {
    expect((await plan("q", sources(2), 1)).length).toBeGreaterThan(0);
  });

  it("eventually returns nothing even when results stay thin", async () => {
    expect(await plan("q", sources(1), 9)).toEqual([]);
  });
});

describe("parsePlannedQueries", () => {
  it("reads one query per line", () => {
    expect(parsePlannedQueries("first query\nsecond query", 4).map((q) => q.query)).toEqual([
      "first query",
      "second query",
    ]);
  });

  it("strips bullets, numbering and quotes", () => {
    const out = parsePlannedQueries(`- alpha\n2. beta\n"gamma"`, 4).map((q) => q.query);
    expect(out).toEqual(["alpha", "beta", "gamma"]);
  });

  // Searching "Here are some queries:" wastes a query.
  it("discards preamble lines ending in a colon", () => {
    expect(parsePlannedQueries("Here are some queries:\nreal query", 4).map((q) => q.query)).toEqual(
      ["real query"],
    );
  });

  it("discards prose too long to be a query", () => {
    expect(parsePlannedQueries("x".repeat(250), 4)).toEqual([]);
  });

  it("respects the cap", () => {
    expect(parsePlannedQueries("a\nb\nc\nd\ne", 2)).toHaveLength(2);
  });

  it("returns nothing for an empty reply", () => {
    expect(parsePlannedQueries("", 4)).toEqual([]);
    expect(parsePlannedQueries("   \n\n  ", 4)).toEqual([]);
  });
});

describe("modelPlanner", () => {
  it("asks the model and parses its reply", async () => {
    const prompts: string[] = [];
    const ask = vi.fn(async (p: string) => {
      prompts.push(p);
      return "alpha\nbeta";
    });
    const out = await modelPlanner(ask)("question", [], 0);
    expect(out.map((q) => q.query)).toEqual(["alpha", "beta"]);
    expect(prompts[0]).toContain("question");
  });

  it("tells the model what has already been found", async () => {
    const prompts: string[] = [];
    const ask = vi.fn(async (p: string) => {
      prompts.push(p);
      return "more";
    });
    await modelPlanner(ask)("q", sources(3), 1);
    expect(prompts[0]).toContain("Already found");
  });

  it("stops once enough has been found, without asking", async () => {
    const ask = vi.fn(async () => "more");
    expect(await modelPlanner(ask)("q", sources(ENOUGH_SOURCES), 1)).toEqual([]);
    expect(ask).not.toHaveBeenCalled();
  });

  // A planner failure must end the run cleanly, not abort the chat turn.
  it("returns nothing when the model call fails", async () => {
    const ask = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await modelPlanner(ask)("q", [], 0)).toEqual([]);
  });
});
