import { describe, expect, it } from "vitest";
import { MAX_TOPICS, classify, isAiRelevant, relevanceScore } from "./classify";
import type { NewsTopic } from "../types";

const topicsFor = (title: string, summary = ""): NewsTopic[] => classify({ title, summary });

describe("classify", () => {
  // A fixed table beats prose here: when a lexicon change shifts a headline into
  // the wrong bucket, this is what says which one and why.
  const cases: { title: string; expect: NewsTopic }[] = [
    { title: "OpenAI introduces GPT-5.5 with a 1M token context window", expect: "models" },
    { title: "Anthropic cuts Claude Haiku pricing to $0.20 per million tokens", expect: "pricing" },
    { title: "Model Context Protocol adds native tool calling for agents", expect: "agents" },
    { title: "Meta releases Llama 4 weights under a permissive Apache 2.0 license", expect: "open-source" },
    { title: "We present scaling laws for retrieval-augmented generation (arXiv preprint)", expect: "research" },
    { title: "Red-teaming study finds jailbreak guardrails fail under long context", expect: "safety" },
    { title: "New VS Code extension brings inline eval harness to prompt engineering", expect: "tools" },
    { title: "NVIDIA Blackwell GB200 racks push inference throughput past 30k tokens per second", expect: "infrastructure" },
    { title: "EU AI Act enforcement begins as regulators open first inquiry", expect: "policy" },
    { title: "Mistral raises $600M Series C at a $14B valuation", expect: "funding" },
    { title: "Sora rivals: new text-to-video diffusion model handles 60-second clips", expect: "multimodal" },
  ];

  for (const testCase of cases) {
    it(`tags "${testCase.title.slice(0, 44)}…" as ${testCase.expect}`, () => {
      expect(topicsFor(testCase.title)).toContain(testCase.expect);
    });
  }

  it("always assigns at least one topic", () => {
    // An untagged article is invisible the moment a reader touches a filter chip.
    expect(topicsFor("Something entirely unclassifiable happened").length).toBeGreaterThanOrEqual(1);
    expect(classify({ title: "", summary: "" }).length).toBeGreaterThanOrEqual(1);
  });

  it("never assigns more than MAX_TOPICS", () => {
    const kitchenSink =
      "OpenAI launches a new open-source multimodal agent model with cheaper pricing, " +
      "safety evaluations, a research paper, new SDK tools, GPU infrastructure, EU policy " +
      "implications and a funding round";
    expect(classify({ title: kitchenSink, summary: kitchenSink }).length).toBeLessThanOrEqual(
      MAX_TOPICS,
    );
  });

  it("is deterministic across repeated runs", () => {
    const input = {
      title: "Google DeepMind ships Gemini 3 Ultra with agentic tool use",
      summary: "The model tops SWE-bench and is priced below the previous generation.",
    };
    const first = classify(input);
    for (let i = 0; i < 5; i++) expect(classify(input)).toEqual(first);
  });

  it("weights the headline above the summary", () => {
    const [primary] = classify({
      title: "Mistral raises $600M Series C led by General Catalyst",
      summary: "The company also mentioned upcoming model releases and benchmarks.",
    });
    expect(primary).toBe("funding");
  });

  it("matches hyphenated and spaced spellings alike", () => {
    expect(topicsFor("A new open source model")).toContain("open-source");
    expect(topicsFor("A new open-source model")).toContain("open-source");
  });

  it("does not fire on substrings of unrelated words", () => {
    // "ai" inside "chain"/"maintain", "gpt" inside nothing useful.
    expect(isAiRelevant("Supply chain maintenance certification available")).toBe(false);
    expect(isAiRelevant("He said the trail was maintained")).toBe(false);
  });

  it("uses source hints only to break ties, not to override evidence", () => {
    const withHint = classify({
      title: "Mistral raises $600M Series C at a $14B valuation",
      summary: "",
      hints: ["research"],
    });
    expect(withHint[0]).toBe("funding");

    const noEvidence = classify({ title: "Weekly notes", summary: "", hints: ["research"] });
    expect(noEvidence).toContain("research");
  });

  it("reads feed categories as weak evidence", () => {
    const tagged = classify({
      title: "Weekly roundup",
      summary: "Assorted items.",
      categories: ["Safety", "alignment"],
    });
    expect(tagged).toContain("safety");
  });
});

describe("isAiRelevant", () => {
  it("accepts genuine AI stories", () => {
    expect(isAiRelevant("OpenAI ships a new large language model")).toBe(true);
    expect(isAiRelevant("Fine-tuning throughput doubles on the new inference stack")).toBe(true);
    expect(isAiRelevant("Claude gains computer use")).toBe(true);
  });

  it("rejects general technology stories from mixed feeds", () => {
    // The gate exists for The Verge's AI section and personal blogs, which mix
    // phone reviews and deal posts into an otherwise on-topic feed.
    expect(isAiRelevant("Best Black Friday laptop deals this week")).toBe(false);
    expect(isAiRelevant("Apple announces a new keyboard layout for the Magic Keyboard")).toBe(false);
    expect(isAiRelevant("How to back up your photos to an external drive")).toBe(false);
  });

  it("matches 'A.I.' as written by wire services", () => {
    expect(isAiRelevant("The rise of A.I. in medicine")).toBe(true);
  });
});

describe("relevanceScore", () => {
  it("is 0 for unrelated text and rises with distinct AI terms", () => {
    expect(relevanceScore("A story about kitchen appliances")).toBe(0);
    const strong = relevanceScore(
      "OpenAI's new LLM improves inference for generative AI agents with better embeddings and prompting",
    );
    expect(strong).toBeGreaterThan(0.5);
  });

  it("stays within 0..1", () => {
    const saturated = relevanceScore(
      "ai llm gpt claude gemini llama openai anthropic deepmind inference embeddings agentic rag",
    );
    expect(saturated).toBeGreaterThan(0);
    expect(saturated).toBeLessThanOrEqual(1);
  });
});
