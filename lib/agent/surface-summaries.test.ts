import { describe, expect, it } from "vitest";
import { MAX_SUMMARY_CHARS } from "./surface-context";
import {
  clampSummary,
  compareSurface,
  costSurface,
  leaderboardSurface,
  newsSurface,
  playgroundSurface,
} from "./surface-summaries";

/**
 * What the agent is told about the screen.
 *
 * Two properties matter across all of them and are checked for each: the text
 * stays inside the cap, because past it the summary competes with the retrieved
 * facts it exists to complement; and `focus` holds ids rather than prose,
 * because the agent looks those up and cannot look up a sentence.
 */

const ALL = [
  leaderboardSurface({
    matched: 12,
    total: 400,
    sort: "price",
    access: "free",
    license: "open",
    search: "x".repeat(400),
    compareIds: ["a", "b"],
  }),
  costSurface({ selectedIds: ["a"], inputPerMonth: 5_000_000, outputPerMonth: 1_000_000 }),
  newsSurface({ matched: 3, total: 9, topics: ["releases"], query: "", verifiedOnly: true, savedOnly: false }),
  compareSurface({ modelIds: ["a", "b"], running: true }),
  playgroundSurface({ modelIds: ["a"], promptChars: 40 }),
];

describe("every summary", () => {
  it("stays inside the cap", () => {
    for (const s of ALL) expect(s.summary.length, s.moduleId).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
  });

  it("names a module that carries its own label and route", () => {
    for (const s of ALL) expect(s.moduleId).toMatch(/^[a-z]+$/);
  });

  it("never puts prose in focus", () => {
    for (const s of ALL) {
      for (const f of s.focus ?? []) expect(f).not.toContain(" ");
    }
  });
});

describe("clampSummary", () => {
  it("leaves a short line exactly as it is", () => {
    expect(clampSummary("12 models of 400")).toBe("12 models of 400");
  });

  it("collapses the whitespace a template leaves behind", () => {
    expect(clampSummary("a  \n b")).toBe("a b");
  });

  it("cuts on a word boundary, so a name never ends mid-syllable", () => {
    const out = clampSummary("alpha bravo charlie delta", 16);
    expect(out).toBe("alpha bravo…");
    expect(out.length).toBeLessThanOrEqual(16);
  });

  it("falls back to a hard cut when one word fills the budget", () => {
    // A 400-character model id with no spaces has no boundary to find.
    const out = clampSummary("x".repeat(50), 10);
    expect(out).toBe("xxxxxxxxx…");
    expect(out.length).toBe(10);
  });
});

describe("leaderboardSurface", () => {
  it("says how narrow the filter is, not just what matched", () => {
    // "12 models" reads as a small catalog; "12 of 400" reads as a filter, and
    // the difference changes whether the agent should suggest widening it.
    const s = leaderboardSurface({
      matched: 12,
      total: 400,
      sort: "intelligence",
      access: "all",
      license: "all",
      search: "",
    });
    expect(s.summary).toContain("12 models of 400");
    expect(s.focus).toBeUndefined();
  });

  it("puts the expanded row first, ahead of the ticked ones", () => {
    // A question asked with a card open is almost always about that card.
    const s = leaderboardSurface({
      matched: 2,
      total: 2,
      sort: "price",
      access: "all",
      license: "all",
      search: "",
      expandedId: "b",
      compareIds: ["a", "b"],
    });
    expect(s.focus).toEqual(["b", "a"]);
  });

  it("says what the access filter means rather than repeating its value", () => {
    const free = leaderboardSurface({
      matched: 1,
      total: 9,
      sort: "price",
      access: "free",
      license: "all",
      search: "",
    });
    expect(free.summary).toContain("free to run");
    const byok = leaderboardSurface({ ...{
      matched: 1, total: 9, sort: "price", license: "all", search: "",
    }, access: "byok" });
    expect(byok.summary).toContain("their own key");
  });

  it("uses the singular for one match", () => {
    const s = leaderboardSurface({
      matched: 1,
      total: 400,
      sort: "price",
      access: "all",
      license: "all",
      search: "",
    });
    expect(s.summary).toContain("1 model of 400");
  });
});

describe("costSurface", () => {
  it("reads the workload the way a person says it", () => {
    const s = costSurface({
      selectedIds: ["a", "b"],
      inputPerMonth: 5_000_000,
      outputPerMonth: 500_000,
    });
    expect(s.summary).toContain("5M tokens in");
    expect(s.summary).toContain("500k tokens out");
  });

  it("says nothing is selected rather than reporting zero models", () => {
    const s = costSurface({ selectedIds: [], inputPerMonth: 1_000, outputPerMonth: 1_000 });
    expect(s.summary).toContain("no models selected");
    expect(s.focus).toBeUndefined();
  });

  it("keeps one decimal place where it carries information", () => {
    const s = costSurface({ selectedIds: [], inputPerMonth: 1_200_000, outputPerMonth: 12_000_000 });
    expect(s.summary).toContain("1.2M tokens");
    expect(s.summary).toContain("12M tokens");
  });
});

describe("newsSurface", () => {
  it("lets an open story win outright over the filters behind it", () => {
    const s = newsSurface({
      matched: 40,
      total: 200,
      topics: ["releases", "research"],
      query: "gemini",
      verifiedOnly: true,
      savedOnly: false,
      openTitle: "A new model ships",
      openId: "art-1",
    });
    expect(s.summary).toBe('reading "A new model ships"');
    expect(s.focus).toEqual(["art-1"]);
  });

  it("describes the feed when nothing is open", () => {
    const s = newsSurface({
      matched: 40,
      total: 200,
      topics: ["releases"],
      query: "",
      verifiedOnly: true,
      savedOnly: false,
    });
    expect(s.summary).toContain("40 stories of 200");
    expect(s.summary).toContain("releases");
    expect(s.summary).toContain("corroborated only");
  });

  it("pluralises stories correctly", () => {
    const s = newsSurface({
      matched: 1,
      total: 1,
      topics: [],
      query: "",
      verifiedOnly: false,
      savedOnly: false,
    });
    expect(s.summary).toContain("1 story of 1");
  });
});

describe("compareSurface and playgroundSurface", () => {
  it("says a run is in flight, which changes what a question means", () => {
    expect(compareSurface({ modelIds: ["a"], running: true }).summary).toContain("in flight");
    expect(playgroundSurface({ modelIds: ["a"], promptChars: 1, running: true }).summary).toContain(
      "running",
    );
  });

  it("is honest about an empty screen", () => {
    expect(compareSurface({ modelIds: [] }).summary).toContain("no models picked");
    expect(playgroundSurface({ modelIds: [], promptChars: 0 }).summary).toContain("no model loaded");
    expect(playgroundSurface({ modelIds: [], promptChars: 0 }).summary).toContain("empty prompt");
  });
});
