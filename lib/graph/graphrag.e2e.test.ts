import { describe, expect, it } from "vitest";
import { reconcileCitations } from "@/lib/research/citations";
import { miniGraph } from "./__fixtures__/mini-catalog";
import { retrieveGraph } from "./retrieve";
import { nodeId } from "./types";

/**
 * The relational fixture.
 *
 * This is the metric the whole graph exists for, written down as a test rather
 * than claimed in a report: twenty questions whose answers are *relations*
 * between catalog facts, each with the nodes an answer would have to be able to
 * cite. Before the graph, every one of these was unanswerable from retrieval -
 * `lib/chat/rag.ts` scores prose chunks and none of these facts are prose - so
 * the model answered them from pre-training.
 *
 * `mustCite` is deliberately the strict bar: the node has to survive ranking
 * into the citation budget, not merely be reachable somewhere in the expansion.
 */

interface Case {
  q: string;
  mustCite: string[];
}

const CASES: Case[] = [
  {
    q: "Which models beat Meridian 70B on MMLU?",
    mustCite: [nodeId("model", "meridian-70b"), nodeId("benchmark", "mmlu")],
  },
  { q: "What does Summit Pro cost per million tokens?", mustCite: [nodeId("model", "summit-pro")] },
  {
    q: "Which open weights models support tool use?",
    mustCite: [nodeId("license", "open"), nodeId("capability", "toolUse")],
  },
  {
    q: "Who makes Meridian 8B?",
    mustCite: [nodeId("model", "meridian-8b"), nodeId("brand", "Cartograph")],
  },
  {
    q: "Which provider serves Delta Reason?",
    mustCite: [nodeId("model", "delta-reason"), nodeId("provider", "nvidia")],
  },
  {
    q: "What is the cheapest model in the Meridian family?",
    mustCite: [nodeId("family", "Cartograph-Meridian"), nodeId("model", "meridian-8b")],
  },
  { q: "Which models can accept images as input?", mustCite: [nodeId("modality", "vision")] },
  {
    q: "Which model can generate an image?",
    mustCite: [nodeId("modality", "out-image"), nodeId("model", "delta-vision")],
  },
  {
    q: "Compare Summit Pro and Delta Reason on GPQA Diamond",
    mustCite: [
      nodeId("model", "summit-pro"),
      nodeId("model", "delta-reason"),
      nodeId("benchmark", "gpqa"),
    ],
  },
  { q: "What is the context window of Summit Mini?", mustCite: [nodeId("model", "summit-mini")] },
  {
    q: "Which models does Alpine make?",
    mustCite: [nodeId("brand", "Alpine"), nodeId("model", "summit-pro")],
  },
  { q: "Show me budget models under a dollar", mustCite: [nodeId("tag", "price-budget")] },
  { q: "Which models are premium priced?", mustCite: [nodeId("tag", "price-premium")] },
  { q: "Which models expose extended reasoning?", mustCite: [nodeId("capability", "reasoning")] },
  { q: "Which models support prompt caching?", mustCite: [nodeId("capability", "caching")] },
  { q: "What are the HumanEval scores?", mustCite: [nodeId("benchmark", "humaneval")] },
  { q: "Which models are proprietary rather than open?", mustCite: [nodeId("license", "proprietary")] },
  { q: "Which models route through OpenRouter?", mustCite: [nodeId("provider", "openrouter")] },
  {
    q: "What does Riverbed make?",
    mustCite: [nodeId("brand", "Riverbed"), nodeId("model", "delta-vision")],
  },
  {
    q: "Is Meridian 70B cheaper than Summit Mini?",
    mustCite: [nodeId("model", "meridian-70b"), nodeId("model", "summit-mini")],
  },
];

const g = miniGraph();
const OPTS = { maxCited: 12, hubDegree: 99 } as const;

function missingFor(c: Case): string[] {
  const ctx = retrieveGraph(g, c.q, OPTS);
  if (!ctx) return c.mustCite;
  const cited = new Set(ctx.cited.map((r) => r.node.id));
  return c.mustCite.filter((id) => !cited.has(id));
}

describe("relational retrieval fixture", () => {
  for (const c of CASES) {
    it(`cites the right nodes for: ${c.q}`, () => {
      expect(missingFor(c)).toEqual([]);
    });
  }

  it("clears the 90% bar across the whole set", () => {
    const passed = CASES.filter((c) => missingFor(c).length === 0).length;
    expect(passed / CASES.length).toBeGreaterThanOrEqual(0.9);
  });
});

describe("citation integrity end to end", () => {
  it("keeps the markers an answer earned and strips the ones it did not", () => {
    const ctx = retrieveGraph(g, "Compare Summit Pro and Delta Reason on GPQA Diamond", OPTS)!;
    const answer = `Summit Pro leads on GPQA [1], ahead of Delta Reason [2]. A stray claim [99].`;
    const reconciled = reconcileCitations(answer, ctx.sources);

    expect(reconciled.invalid).toEqual([99]);
    expect(reconciled.text).not.toContain("[99]");
    expect(reconciled.sources).toHaveLength(2);
    expect(reconciled.uncited).toBe(false);
    // Renumbered to index the list actually shown.
    expect(reconciled.text).toContain("[1]");
    expect(reconciled.text).toContain("[2]");
  });

  it("every marker in the rendered block resolves to a source", () => {
    const ctx = retrieveGraph(g, "Which models beat Meridian 70B on MMLU?", OPTS)!;
    const markers = [...ctx.text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    expect(markers.length).toBeGreaterThan(0);
    for (const n of markers) {
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(ctx.sources.length);
    }
  });

  it("reports an answer that cited nothing, rather than passing it through quietly", () => {
    const ctx = retrieveGraph(g, "Summit Pro", OPTS)!;
    expect(reconcileCitations("It is a good model.", ctx.sources).uncited).toBe(true);
  });

  it("offsetting the start index keeps web and graph citations in one sequence", () => {
    const web = [{ title: "A post", url: "https://x.dev", snippet: "..." }];
    const ctx = retrieveGraph(g, "Summit Pro", { ...OPTS, startIndex: web.length + 1 })!;
    const merged = [...web, ...ctx.sources];
    const answer = `Per the post [1], and per the catalog [2].`;
    const reconciled = reconcileCitations(answer, merged);
    expect(reconciled.invalid).toEqual([]);
    expect(reconciled.sources).toHaveLength(2);
    expect(reconciled.sources[1].title).toContain("Summit Pro");
  });
});
