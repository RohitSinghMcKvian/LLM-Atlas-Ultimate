import { beforeEach, describe, expect, it } from "vitest";
import { BASELINE_SNAPSHOT } from "@/lib/catalog/baseline";
import { resolveModelId } from "@/lib/catalog/resolve";
import { installSnapshot, resetSnapshot } from "@/lib/catalog/snapshot";
import { MAX_MODELS, canonicalOrg, extractEntities } from "./entities";

// `resolveModelId` reads the installed snapshot, so every test runs against the
// bundled baseline — the same fixture `lib/news/data.test.ts` used before it was
// retired.
beforeEach(() => {
  resetSnapshot();
  installSnapshot(BASELINE_SNAPSHOT);
});

const models = (title: string, body = "") => extractEntities(title, body, BASELINE_SNAPSHOT).models;
const orgs = (title: string, body = "") => extractEntities(title, body, BASELINE_SNAPSHOT).orgs;

describe("extractEntities — models", () => {
  it("links a full model name written the way press writes it", () => {
    expect(models("Anthropic ships Claude Opus 4.8 with a longer context window")).toContain(
      "claude-opus-4-8",
    );
  });

  it("matches across separator styles", () => {
    // Publishers write "GPT-5.5", "GPT 5.5" and occasionally "gpt-5-5".
    for (const spelling of ["GPT-5.5", "GPT 5.5", "gpt-5-5"]) {
      expect(models(`OpenAI launches ${spelling} today`), spelling).toContain("gpt-5-5");
    }
  });

  it("does not link a bare family name", () => {
    // "Llama" alone is a family, not a model. Guessing which one is a
    // confidently wrong answer.
    expect(models("Meta says Llama adoption is growing")).toEqual([]);
    expect(models("Claude is popular with developers")).toEqual([]);
    expect(models("A story about Gemini in general")).toEqual([]);
  });

  it("links the specific member when the version is present", () => {
    expect(models("Llama 4 Maverick tops the open leaderboard")).toContain("llama-4-maverick");
  });

  // The invariant this module exists to guarantee. The retired data.ts carried
  // hand-written ids, two of which had gone stale and rendered as dead chips.
  it("can never emit an id that does not resolve", () => {
    const headlines = [
      "Claude Opus 4.8 and GPT-5.5 trade places on SWE-bench",
      "Gemini 3 Flash, Llama 4 Scout and Mistral Large compared",
      "DeepSeek R1 versus o3-pro on maths benchmarks",
      "A roundup of GPT-4.1, o4-mini, Gemma 3 27B and Claude Haiku 4.5",
    ];
    for (const headline of headlines) {
      for (const id of models(headline)) {
        expect(resolveModelId(id), `${headline} → ${id}`).toBe(id);
      }
    }
  });

  it("caps the number of linked models", () => {
    const listicle =
      "GPT-5.5 vs Claude Opus 4.8 vs Gemini 3 Flash vs Llama 4 Maverick vs " +
      "Llama 4 Scout vs Gemma 3 27B vs Claude Haiku 4.5 vs o4-mini";
    expect(models(listicle).length).toBeLessThanOrEqual(MAX_MODELS);
  });

  it("prefers models named in the headline over ones named in the body", () => {
    const found = models(
      "Claude Opus 4.8 leads a new benchmark",
      "The comparison also covered GPT-5.5, Gemini 3 Flash, Llama 4 Scout and Gemma 3 27B.",
    );
    expect(found[0]).toBe("claude-opus-4-8");
  });

  it("returns nothing for text with no model references", () => {
    expect(models("Regulators publish a consultation on compute reporting")).toEqual([]);
    expect(models("", "")).toEqual([]);
  });

  it("does not match a model name embedded in a longer word", () => {
    expect(models("The o3-proximity sensor shipped")).not.toContain("o3-pro");
  });

  it("is deterministic", () => {
    const input = "Claude Opus 4.8 and GPT-5.5 both improve on agentic tool use";
    const first = models(input);
    for (let i = 0; i < 5; i++) expect(models(input)).toEqual(first);
  });
});

describe("extractEntities — organisations", () => {
  it("recognises labs by name", () => {
    expect(orgs("OpenAI and Anthropic both shipped this week")).toEqual(
      expect.arrayContaining(["OpenAI", "Anthropic"]),
    );
  });

  it("aliases sub-brands to the parent organisation", () => {
    expect(orgs("Google DeepMind publishes new results")).toContain("Google");
    expect(orgs("Meta AI releases a new checkpoint")).toContain("Meta");
  });

  it("does not fire on substrings", () => {
    expect(orgs("The metadata format changed")).not.toContain("Meta");
    expect(orgs("Applesauce recipes")).not.toContain("Apple");
  });

  it("caps the list", () => {
    const many = "OpenAI, Anthropic, Google, Meta, Microsoft, NVIDIA, Mistral and Cohere all commented";
    expect(orgs(many).length).toBeLessThanOrEqual(4);
  });
});

describe("canonicalOrg", () => {
  it("maps aliases to the canonical name", () => {
    expect(canonicalOrg("deepmind")).toBe("Google");
    expect(canonicalOrg("Hugging Face")).toBe("Hugging Face");
    expect(canonicalOrg("huggingface")).toBe("Hugging Face");
  });

  it("returns undefined for an unknown name", () => {
    expect(canonicalOrg("Some Unknown Startup")).toBeUndefined();
  });
});
