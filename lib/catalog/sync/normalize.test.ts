import { describe, it, expect } from "vitest";
import { MODELS } from "../models";
import {
  atlasId,
  clampBlurb,
  fnv1a,
  isoDate,
  matchKey,
  perMillion,
  round6,
  stripVariant,
  variantOf,
} from "./normalize";

describe("atlasId", () => {
  const cases: Record<string, string> = {
    // The alignment that makes the whole overlay match work: a provider id
    // normalizes to the id the curated catalog already uses.
    "openai/gpt-5.5": "gpt-5-5",
    "anthropic/claude-opus-4.8": "claude-opus-4-8",
    "meta-llama/llama-3.3-70b-instruct": "llama-3-3-70b-instruct",
    "deepseek/deepseek-v4-pro:free": "deepseek-v4-pro",
    "~anthropic/claude-opus-latest": "claude-opus-latest",
    "nvidia/llama-3.3-nemotron-super-49b-v1.5": "llama-3-3-nemotron-super-49b-v1-5",
    "mistralai/mixtral-8x22b-instruct": "mixtral-8x22b-instruct",
    "bare-model-id": "bare-model-id",
  };

  for (const [input, expected] of Object.entries(cases)) {
    it(`${input} → ${expected}`, () => {
      expect(atlasId(input)).toBe(expected);
    });
  }

  it("is idempotent", () => {
    for (const input of Object.keys(cases)) {
      expect(atlasId(atlasId(input))).toBe(atlasId(input));
    }
  });

  it("produces url-safe ids", () => {
    for (const input of Object.keys(cases)) {
      expect(atlasId(input)).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
  });

  it("never emits leading, trailing, or doubled separators", () => {
    for (const input of ["vendor/--weird..name--", "vendor/A_B  C"]) {
      const id = atlasId(input);
      expect(id.startsWith("-")).toBe(false);
      expect(id.endsWith("-")).toBe(false);
      expect(id).not.toContain("--");
    }
  });
});

describe("variant suffixes", () => {
  it("strips known suffixes only", () => {
    expect(stripVariant("deepseek/deepseek-r1:free")).toBe("deepseek/deepseek-r1");
    expect(stripVariant("x/y:nitro")).toBe("x/y");
    expect(stripVariant("x/y:something-else")).toBe("x/y:something-else");
    expect(stripVariant("x/y")).toBe("x/y");
  });

  it("reports the suffix", () => {
    expect(variantOf("deepseek/deepseek-r1:free")).toBe("free");
    expect(variantOf("x/y:thinking")).toBe("thinking");
    expect(variantOf("x/y")).toBeUndefined();
    expect(variantOf("x/y:unknown")).toBeUndefined();
  });
});

describe("matchKey", () => {
  it("collapses naming noise that carries no identity", () => {
    expect(matchKey("meta-llama/llama-3.3-70b-instruct")).toBe(matchKey("meta/llama-3.3-70b"));
    expect(matchKey("google/gemma-3-27b-it")).toBe(matchKey("google/gemma-3-27b"));
    expect(matchKey("vendor/model-hf")).toBe(matchKey("vendor/model"));
  });

  it("keeps -preview distinct", () => {
    // A preview build is frequently a different model with different pricing;
    // collapsing it would merge two real catalog entries.
    expect(matchKey("google/gemini-3-pro-preview")).not.toBe(matchKey("google/gemini-3-pro"));
  });

  it("distinguishes different versions", () => {
    expect(matchKey("openai/gpt-5.5")).not.toBe(matchKey("openai/gpt-5"));
    expect(matchKey("x/model-70b")).not.toBe(matchKey("x/model-7b"));
  });

  it("is unique across every curated catalog id", () => {
    // The overlay match index drops ambiguous keys, so a collision here silently
    // costs curated metadata on a real model. Catch it at the source instead.
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const m of MODELS) {
      const key = matchKey(m.id);
      const previous = seen.get(key);
      if (previous) collisions.push(`${previous} ↔ ${m.id} (${key})`);
      else seen.set(key, m.id);
    }
    expect(collisions).toEqual([]);
  });
});

describe("pricing conversion", () => {
  it("converts per-token strings to per-million", () => {
    expect(perMillion("0.000005")).toBe(5);
    expect(perMillion("0.0000003")).toBe(0.3);
    expect(perMillion("0")).toBe(0);
    expect(perMillion(0.000_002)).toBe(2);
  });

  it("avoids float dust that would churn the snapshot hash every run", () => {
    // Number("0.0000003") * 1e6 === 0.30000000000000004
    expect(String(perMillion("0.0000003"))).toBe("0.3");
    expect(String(perMillion("0.0000007"))).toBe("0.7");
  });

  it("treats missing or malformed prices as free rather than NaN", () => {
    expect(perMillion(null)).toBe(0);
    expect(perMillion(undefined)).toBe(0);
    expect(perMillion("")).toBe(0);
    expect(perMillion("not-a-number")).toBe(0);
    expect(perMillion("-1")).toBe(0);
  });

  it("round6 rounds to six places", () => {
    expect(round6(0.123_456_789)).toBe(0.123_457);
    expect(round6(5)).toBe(5);
  });
});

describe("clampBlurb", () => {
  it("takes the first sentence when it is substantial", () => {
    expect(clampBlurb("A fast model. It also does other things.")).toBe("A fast model. It also does other things.");
    expect(
      clampBlurb("The most capable Opus model to date and then some. Second sentence here."),
    ).toBe("The most capable Opus model to date and then some.");
  });

  it("unwraps markdown links to their label", () => {
    expect(clampBlurb("Fast variant of [Opus 5](/anthropic/claude-opus-5) with more speed.")).toBe(
      "Fast variant of Opus 5 with more speed.",
    );
  });

  it("caps length — this is the dominant client payload lever", () => {
    const long = `${"word ".repeat(200)}end.`;
    const out = clampBlurb(long);
    expect(out.length).toBeLessThanOrEqual(181);
    expect(out.endsWith("…")).toBe(true);
  });

  it("handles empty input", () => {
    expect(clampBlurb("")).toBe("");
    expect(clampBlurb(null)).toBe("");
    expect(clampBlurb(undefined)).toBe("");
  });
});

describe("isoDate", () => {
  it("converts unix seconds to a date", () => {
    expect(isoDate(1_780_000_000, "2026-07-25")).toBe(
      new Date(1_780_000_000_000).toISOString().slice(0, 10),
    );
  });

  it("falls back for junk, zero, and out-of-range values", () => {
    expect(isoDate(null, "2026-07-25")).toBe("2026-07-25");
    expect(isoDate(0, "2026-07-25")).toBe("2026-07-25");
    expect(isoDate(NaN, "2026-07-25")).toBe("2026-07-25");
    // NVIDIA reports a nonsense `created` of 735790403 (≈1993) for every model.
    expect(isoDate(735_790_403, "2026-07-25")).toBe("2026-07-25");
  });
});

describe("fnv1a", () => {
  it("is deterministic and 8 hex chars", () => {
    expect(fnv1a("hello")).toBe(fnv1a("hello"));
    expect(fnv1a("hello")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("differs for different input", () => {
    expect(fnv1a("hello")).not.toBe(fnv1a("hellp"));
    expect(fnv1a("")).not.toBe(fnv1a("a"));
  });
});
