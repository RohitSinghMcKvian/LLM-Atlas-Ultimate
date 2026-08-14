import { describe, it, expect, vi } from "vitest";
import { dedupeQueries, describeRun, formatResearchContext, runResearch } from "./run";
import type { WebSource } from "@/lib/chat/types";

function src(n: number, host = "example.com"): WebSource {
  return { title: `Result ${n}`, url: `https://${host}/${n}`, snippet: `snippet ${n}` };
}

/** A planner that yields a fixed script of rounds, then stops. */
function scriptedPlanner(script: string[][]) {
  return vi.fn(async (_q: string, _known: WebSource[], round: number) =>
    (script[round] ?? []).map((query) => ({ query })),
  );
}

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("dedupeQueries", () => {
  it("drops repeats within a round", () => {
    const out = dedupeQueries([{ query: "a" }, { query: "A " }, { query: "b" }], []);
    expect(out.map((q) => q.query)).toEqual(["a", "b"]);
  });

  // Repeating a query spends budget for nothing, so duplicates are dropped
  // against the whole run rather than only within the round.
  it("drops queries already run in earlier rounds", () => {
    expect(dedupeQueries([{ query: "a" }, { query: "c" }], ["A"]).map((q) => q.query)).toEqual([
      "c",
    ]);
  });

  it("drops blanks", () => {
    expect(dedupeQueries([{ query: "   " }, { query: "" }], [])).toEqual([]);
  });

  it("keeps the rationale", () => {
    expect(dedupeQueries([{ query: "a", rationale: "why" }], [])[0].rationale).toBe("why");
  });
});

describe("runResearch", () => {
  const search = async (q: string) => [src(1, `${q}.test`), src(2, `${q}.test`)];

  it("runs the planner's queries and collects sources", async () => {
    const r = await runResearch("q", { plan: scriptedPlanner([["a", "b"]]), search });
    expect(r.queriesRun).toEqual(["a", "b"]);
    expect(r.sources).toHaveLength(4);
    expect(r.stoppedBy).toBeNull();
  });

  // An empty plan is the planner saying "enough" — distinct from running out of
  // budget, and reported differently.
  it("stops when the planner returns nothing, with no stop reason", async () => {
    const plan = scriptedPlanner([["a"], []]);
    const r = await runResearch("q", { plan, search });
    expect(r.rounds).toHaveLength(1);
    expect(r.stoppedBy).toBeNull();
  });

  it("runs several rounds, feeding what is known back to the planner", async () => {
    const plan = scriptedPlanner([["a"], ["b"], []]);
    const r = await runResearch("q", { plan, search });
    expect(r.rounds.map((x) => x.queries)).toEqual([["a"], ["b"]]);
    // The planner saw accumulated sources on the second call.
    expect(plan.mock.calls[1][1].length).toBeGreaterThan(0);
  });

  it("de-duplicates sources across rounds", async () => {
    const same = async () => [src(1), src(2)];
    const r = await runResearch("q", { plan: scriptedPlanner([["a"], ["b"], []]), search: same });
    expect(r.sources).toHaveLength(2);
    expect(r.rounds[1].newSources).toBe(0);
  });

  // A failed search is one angle lost, not a failed run.
  it("survives a search that throws and records it", async () => {
    const flaky = async (q: string) => {
      if (q === "b") throw new Error("network");
      return [src(1)];
    };
    const r = await runResearch("q", { plan: scriptedPlanner([["a", "b"]]), search: flaky });
    expect(r.rounds[0].failures).toEqual(["b"]);
    expect(r.sources).toHaveLength(1);
  });

  it("survives every search failing", async () => {
    const dead = async () => {
      throw new Error("down");
    };
    const r = await runResearch("q", { plan: scriptedPlanner([["a", "b"]]), search: dead });
    expect(r.sources).toEqual([]);
    expect(r.rounds[0].failures).toHaveLength(2);
  });

  describe("budgets are enforced by what is started", () => {
    it("caps total queries and reports the ones it skipped", async () => {
      const searchSpy = vi.fn(search);
      const r = await runResearch(
        "q",
        { plan: scriptedPlanner([["a", "b", "c", "d"]]), search: searchSpy },
        { maxQueries: 2 },
      );
      expect(searchSpy).toHaveBeenCalledTimes(2);
      expect(r.queriesRun).toEqual(["a", "b"]);
      expect(r.skipped).toEqual(["c", "d"]);
      expect(r.stoppedBy).toContain("search limit");
    });

    it("caps rounds even when the planner keeps proposing", async () => {
      const endless = vi.fn(async () => [{ query: `q${Math.random()}` }]);
      const r = await runResearch("q", { plan: endless, search }, { maxRounds: 2 });
      expect(r.rounds).toHaveLength(2);
      expect(r.stoppedBy).toContain("2 rounds");
    });

    it("caps sources, keeping the earliest", async () => {
      const many = async () => Array.from({ length: 10 }, (_, i) => src(i));
      const r = await runResearch(
        "q",
        { plan: scriptedPlanner([["a"], ["b"], []]), search: many },
        { maxSources: 3 },
      );
      expect(r.sources).toHaveLength(3);
      expect(r.sources[0].url).toBe("https://example.com/0");
    });

    it("stops on wall clock even with queries left", async () => {
      const c = clock();
      const slow = async () => {
        c.advance(600);
        return [src(1)];
      };
      const r = await runResearch(
        "q",
        { plan: scriptedPlanner([["a"], ["b"], ["c"], ["d"]]), search: slow },
        { maxMs: 1000, maxQueries: 50, maxRounds: 50 },
        c.now,
      );
      expect(r.stoppedBy).toContain("time limit");
      expect(r.queriesRun.length).toBeLessThan(4);
    });

    // The cap has to bind however hostile the planner is.
    it("cannot be exceeded by a planner asking for hundreds at once", async () => {
      const greedy = async () =>
        Array.from({ length: 500 }, (_, i) => ({ query: `q${i}` }));
      const searchSpy = vi.fn(search);
      await runResearch("q", { plan: greedy, search: searchSpy }, { maxQueries: 4 });
      expect(searchSpy).toHaveBeenCalledTimes(4);
    });
  });

  it("honours an abort signal", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const searchSpy = vi.fn(search);
    const r = await runResearch("q", {
      plan: scriptedPlanner([["a"]]),
      search: searchSpy,
      signal: ctrl.signal,
    });
    expect(searchSpy).not.toHaveBeenCalled();
    expect(r.rounds).toEqual([]);
  });

  it("reports progress per round", async () => {
    const onProgress = vi.fn();
    await runResearch("q", { plan: scriptedPlanner([["a"], ["b"], []]), search, onProgress });
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.calls[0][0]).toMatchObject({ round: 0, queries: ["a"] });
  });
});

describe("formatResearchContext", () => {
  it("numbers sources from 1 for citation", () => {
    const out = formatResearchContext([src(1), src(2)]);
    expect(out).toContain("[1] Result 1");
    expect(out).toContain("[2] Result 2");
  });

  it("instructs the model not to cite outside the list", () => {
    expect(formatResearchContext([src(1)])).toContain("not in this list");
  });

  // Answering from memory while appearing to have searched is the worst outcome.
  it("tells the model to say so when nothing was found", () => {
    const out = formatResearchContext([]);
    expect(out).toContain("No sources were found");
    expect(out).toContain("rather than answering from memory");
  });
});

describe("describeRun", () => {
  it("summarises the cost", async () => {
    const r = await runResearch("q", {
      plan: scriptedPlanner([["a", "b"], []]),
      search: async () => [src(1)],
    });
    expect(describeRun(r)).toContain("2 searches");
    expect(describeRun(r)).toContain("1 source");
  });

  it("appends the stop reason when a budget ended the run", async () => {
    const r = await runResearch(
      "q",
      { plan: scriptedPlanner([["a", "b"]]), search: async () => [src(1)] },
      { maxQueries: 1 },
    );
    expect(describeRun(r)).toContain("search limit");
  });

  it("mentions failures", async () => {
    const r = await runResearch("q", {
      plan: scriptedPlanner([["a"]]),
      search: async () => {
        throw new Error("x");
      },
    });
    expect(describeRun(r)).toContain("1 failed");
  });
});
