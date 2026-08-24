import { describe, expect, it } from "vitest";
import { atlasGraph } from "@/lib/graph/atlas-graph";
import { miniGraph } from "@/lib/graph/__fixtures__/mini-catalog";
import { refineTranscript } from "./transcript";
import {
  buildLexicon,
  correctTranscript,
  editDistance,
  phoneticKey,
  similarity,
  variantsOf,
  TECHNICAL_TERMS,
} from "./lexicon";

const lexicon = buildLexicon(miniGraph());
const fix = (s: string) => correctTranscript(s, lexicon).text;

/**
 * The real shipped vocabulary, for the accuracy fixture.
 *
 * The mini catalog is right for unit behaviour and wrong for measuring
 * accuracy: the question is whether this works against the ~190 terms Atlas
 * actually ships, not against six invented ones.
 */
const real = buildLexicon(atlasGraph());
const heard = (s: string) => refineTranscript(s, real).text;

describe("phoneticKey", () => {
  it("collapses the substitutions a transcriber actually makes", () => {
    expect(phoneticKey("Qwen")).toBe(phoneticKey("Quinn"));
    expect(phoneticKey("vLLM")).toBe(phoneticKey("VLM"));
    expect(phoneticKey("Nemotron")).toBe(phoneticKey("Nemo Tron"));
  });

  it("keeps the leading sound, so unrelated words do not collide", () => {
    expect(phoneticKey("Atlas")).not.toBe(phoneticKey("Titles"));
  });

  it("survives punctuation and empty input", () => {
    expect(phoneticKey("SWE-bench")).toBe(phoneticKey("swe bench"));
    expect(phoneticKey("...")).toBe("");
    expect(phoneticKey("")).toBe("");
  });
});

describe("editDistance / similarity", () => {
  it("measures what it says", () => {
    expect(editDistance("abc", "abc")).toBe(0);
    expect(editDistance("abc", "abd")).toBe(1);
    expect(editDistance("", "abc")).toBe(3);
    expect(similarity("abc", "abc")).toBe(1);
    expect(similarity("", "")).toBe(1);
    expect(similarity("abc", "xyz")).toBe(0);
  });
});

describe("variantsOf", () => {
  it("expands one acronym letter into its spoken name", () => {
    expect(variantsOf("MMLU")).toContain("mmlyou");
    expect(variantsOf("GPQA")).toContain("gpcuea");
  });

  it("spells a version digit out, because people read it aloud", () => {
    expect(variantsOf("Qwen3")).toContain("qwenthree");
    expect(variantsOf("Llama 4")).toContain("llamafour");
  });

  it("leaves an ordinary name alone", () => {
    expect(variantsOf("Summit Pro")).toEqual(["summit pro", "summitpro"]);
  });
});

describe("buildLexicon", () => {
  it("learns the catalog's own vocabulary", () => {
    const terms = lexicon.terms.map((t) => t.term);
    expect(terms).toContain("Summit Pro");
    expect(terms).toContain("Cartograph");
    expect(terms).toContain("MMLU");
  });

  it("includes the technical terms no table holds", () => {
    for (const t of TECHNICAL_TERMS.slice(0, 5)) {
      expect(lexicon.terms.some((x) => x.term === t.term)).toBe(true);
    }
  });

  it("refuses a term that is an ordinary English word", () => {
    const withCommon = buildLexicon(null, { extra: [{ term: "model", kind: "x" }] });
    expect(withCommon.terms.some((t) => t.term === "model")).toBe(false);
  });

  it("works with no graph at all", () => {
    expect(buildLexicon(null).terms.length).toBeGreaterThan(5);
  });
});

/**
 * The accuracy fixture.
 *
 * Every one of these is a mishearing a transcriber really produces on this
 * vocabulary, run through the whole pipeline (`normalizeSpoken` then
 * `correctTranscript`) against the shipped catalog.
 *
 * Known misses, left out deliberately rather than tuned for: very short terms
 * like LoRA and BYOK sit below the phonetic key floor, so "low rah" and "byoke"
 * are not corrected. Lowering the floor to catch them re-opens the
 * false-correction path the clean set below exists to close, and a mangled word
 * costs less than a confidently wrong one.
 */
const MISHEARD: { heard: string; expect: string }[] = [
  { heard: "how does Quinn three compare", expect: "Qwen3" },
  { heard: "what about Nemo Tron three", expect: "Nemotron 3" },
  { heard: "the MML you score", expect: "MMLU" },
  { heard: "its GP QA result", expect: "GPQA" },
  { heard: "serve it with VLM", expect: "vLLM" },
  { heard: "run it on Olama", expect: "Ollama" },
  { heard: "the human eval number", expect: "HumanEval" },
  { heard: "use Open Router", expect: "OpenRouter" },
  { heard: "tell me about Lama four", expect: "Llama 4" },
  { heard: "Mistrall large three pricing", expect: "Mistral Large 3" },
  { heard: "deep seek v four", expect: "DeepSeek V4" },
  { heard: "an M C P server", expect: "MCP" },
  { heard: "the KV cash", expect: "KV cache" },
  { heard: "swee bench verified", expect: "SWE-bench Verified" },
  { heard: "what is the context windo", expect: "context window" },
  { heard: "Gemma four", expect: "Gemma 4" },
  { heard: "quantisation options", expect: "quantization" },
  { heard: "an M M L U score of eighty", expect: "MMLU" },
  { heard: "Gemini three pro", expect: "Gemini 3" },
];

describe("correction fixture", () => {
  for (const c of MISHEARD) {
    it(`hears "${c.heard}" as ${c.expect}`, () => {
      expect(heard(c.heard)).toContain(c.expect);
    });
  }

  it("clears the 95% bar across the whole set", () => {
    const passed = MISHEARD.filter((c) => heard(c.heard).includes(c.expect)).length;
    expect(passed / MISHEARD.length).toBeGreaterThanOrEqual(0.95);
  });
});

/**
 * The other half of the metric, and the more important one: a wrong correction
 * makes the model confidently answer about a different model, which is worse
 * than leaving a word mangled.
 */
const CLEAN = [
  "what is the cheapest model with a big context window",
  "compare the two on price and speed",
  "how much would that cost per month at ten thousand requests a day",
  "show me open weights models I can self host",
  "which one is better for code",
  "I need something fast and cheap for classification",
  "does it support tool use and structured output",
  "what changed in the last week",
  "give me a table of the top five",
  "explain how retrieval works",
  "Summit Pro versus Meridian 70B on MMLU",
  "the price went up so I want an alternative",
  "can you run that again with a bigger workload",
  "no I meant the other one",
  "thanks that is what I needed",
];

describe("no false corrections", () => {
  for (const s of CLEAN) {
    it(`leaves clean text alone: "${s}"`, () => {
      expect(correctTranscript(s, lexicon).corrections).toEqual([]);
    });
  }

  it("makes zero corrections across the whole clean set", () => {
    const total = CLEAN.reduce((n, s) => n + correctTranscript(s, lexicon).corrections.length, 0);
    expect(total).toBe(0);
  });

  it("makes zero corrections against the full shipped vocabulary either", () => {
    // The harder direction: ~190 terms is far more opportunity to match
    // something by accident than six.
    const total = CLEAN.reduce((n, s) => n + refineTranscript(s, real).corrections.length, 0);
    expect(total).toBe(0);
  });
});

describe("guards", () => {
  it("declines a real catalog ambiguity rather than picking a side", () => {
    // "Groc" sounds exactly like both Groq the provider and Grok the model.
    // Guessing between them would answer confidently about the wrong thing.
    expect(refineTranscript("the Groc provider", real).corrections).toEqual([]);
  });

  it("does not turn an ordinary word into a short model name", () => {
    // The regression: "other" and "o3" reduce to the same phonetic skeleton, so
    // "no I meant the other one" became "no I meant the o3 one".
    expect(refineTranscript("no I meant the other one", real).corrections).toEqual([]);
  });

  it("leaves an ambiguous mishearing alone rather than guessing", () => {
    // Two terms one edit apart: picking either would be a confident wrong answer.
    const lex = buildLexicon(null, {
      extra: [
        { term: "Zephyr One", kind: "model" },
        { term: "Zephyr Ona", kind: "model" },
      ],
    });
    expect(correctTranscript("about zephyr onx", lex).corrections).toEqual([]);
  });

  it("does not rewrite text that was already right", () => {
    expect(correctTranscript("Summit Pro and MMLU", lexicon).corrections).toEqual([]);
  });

  it("keeps punctuation attached to the corrected word", () => {
    expect(heard("what about Nemo Tron three?")).toContain("Nemotron 3?");
  });

  it("reports what it changed, with a score", () => {
    const r = correctTranscript("the MML you score", lexicon);
    expect(r.corrections).toHaveLength(1);
    expect(r.corrections[0]).toMatchObject({ to: "MMLU", kind: "benchmark" });
    expect(r.corrections[0].score).toBeGreaterThan(0.8);
  });

  it("corrects a multi-word run as one unit, not each word alone", () => {
    const r = refineTranscript("about Nemo Tron three", real);
    expect(r.corrections).toHaveLength(1);
    expect(r.corrections[0].from).toBe("Nemo Tron three");
  });

  it("handles an empty or whitespace transcript", () => {
    expect(correctTranscript("", lexicon).text).toBe("");
    expect(correctTranscript("   ", lexicon).corrections).toEqual([]);
  });

  it("a stricter threshold corrects less, never more", () => {
    const strict = correctTranscript("what is Summit Prow", lexicon, { threshold: 0.99 });
    expect(strict.corrections).toEqual([]);
  });
});
