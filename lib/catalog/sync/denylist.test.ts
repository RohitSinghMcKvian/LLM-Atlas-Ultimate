import { describe, expect, it } from "vitest";
import {
  ALL_DENY_RULES,
  META_ROUTER_RULES,
  NON_CHAT_PATTERNS,
  NON_CHAT_RULES,
  isChatCapable,
  isDeniedAtlasId,
} from "./denylist";

// Two guards, and the second matters at least as much as the first:
//
//   * every pattern must still exclude its own example — otherwise a rule rots
//     into a no-op and an embedding model reaches the picker;
//   * a list of REAL chat models must survive — otherwise an over-broad pattern
//     (`/^openrouter\//`, `/flux/`, a stray `.*`) silently eats the catalog. That
//     failure is far worse, because it looks like a successful sync.

describe("every rule is load-bearing", () => {
  it("excludes its own example", () => {
    for (const { pattern, example } of ALL_DENY_RULES) {
      expect(pattern.test(example), `${pattern} should match ${example}`).toBe(true);
      expect(isChatCapable(example), `${example} should be excluded`).toBe(false);
    }
  });

  it("has no rule fully covered by the others", () => {
    for (const { pattern, example } of ALL_DENY_RULES) {
      const others = ALL_DENY_RULES.filter((r) => r.pattern !== pattern);
      const covered = others.some((r) => r.pattern.test(example));
      expect(covered, `${pattern} is redundant — ${example} is matched by another rule`).toBe(
        false,
      );
    }
  });
});

describe("real chat models are never excluded", () => {
  // The negative control. Every id here was observed live on NVIDIA NIM or
  // OpenRouter and must remain publishable.
  const KEEP = [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b:free",
    "google/gemini-2.5-flash",
    "google/gemma-3-27b-it",
    "google/gemma-4-31b-it:free",
    "nvidia/nemotron-4-340b-instruct",
    "nvidia/nemotron-nano-9b-v2:free",
    "meta/llama-3.3-70b-instruct",
    "meta-llama/llama-4-maverick",
    "deepseek-ai/deepseek-v4-pro",
    "qwen/qwen3-next-80b-a3b-instruct",
    "mistralai/mistral-large",
    "anthropic/claude-opus-4.5",
    "cohere/command-a",
    "z-ai/glm-4.6",
    "moonshotai/kimi-k2-thinking",
    "abacusai/dracarys-llama-3.1-70b-instruct",
    "inclusionai/ling-3.0-flash:free",
    "poolside/laguna-s-2.1:free",
    "minimaxai/minimax-m2.7",
    "microsoft/phi-4",
    "thinkingmachines/inkling",
    // Guards against over-eager media patterns: these contain substrings that a
    // sloppy rule would catch.
    "stepfun-ai/step-3.5-flash",
    "nvidia/nemotron-3-super-120b-a12b:free",
  ];

  it("keeps every one", () => {
    for (const id of KEEP) {
      expect(isChatCapable(id), `${id} must NOT be excluded`).toBe(true);
    }
  });
});

describe("media-generation and meta-router rules", () => {
  it("excludes the Lyria music models that reached production", () => {
    expect(isChatCapable("google/lyria-3-pro-preview")).toBe(false);
    expect(isChatCapable("google/lyria-3-clip-preview")).toBe(false);
  });

  it("excludes every OpenRouter meta-router with one rule", () => {
    for (const id of [
      "openrouter/auto",
      "openrouter/auto-beta",
      "openrouter/free",
      "openrouter/fusion",
      "openrouter/bodybuilder",
      "openrouter/pareto-code",
    ]) {
      expect(isChatCapable(id), id).toBe(false);
    }
    expect(META_ROUTER_RULES).toHaveLength(1);
  });

  it("does not exclude a real model merely for mentioning a vendor", () => {
    // `openrouter` only matches as a namespace, not anywhere in the string.
    expect(isChatCapable("someone/openrouter-tuned-7b")).toBe(true);
  });
});

describe("isDeniedAtlasId withdraws already-published entries", () => {
  it("catches meta-routers by their namespace-stripped Atlas id", () => {
    // `openrouter/auto` normalizes to `auto`, which the namespace pattern cannot
    // see — this is why a name list exists alongside the patterns.
    for (const id of ["auto", "auto-beta", "free", "fusion", "bodybuilder", "pareto-code"]) {
      expect(isDeniedAtlasId(id), id).toBe(true);
    }
  });

  it("catches a carried-forward entry by its recorded upstream route", () => {
    expect(
      isDeniedAtlasId("lyria-3-pro-preview", [{ model: "google/lyria-3-pro-preview" }]),
    ).toBe(true);
    expect(isDeniedAtlasId("some-model", [{ model: "vendor/nv-embedqa-e5-v5" }])).toBe(true);
  });

  it("leaves genuine models alone", () => {
    expect(isDeniedAtlasId("gpt-oss-120b", [{ model: "openai/gpt-oss-120b" }])).toBe(false);
    expect(isDeniedAtlasId("llama-3-3-70b", [{ model: "meta/llama-3.3-70b-instruct" }])).toBe(
      false,
    );
    // "free" as an Atlas id is denied, but a `:free` variant route is not.
    expect(isDeniedAtlasId("gemma-4-31b", [{ model: "google/gemma-4-31b-it:free" }])).toBe(false);
  });
});

describe("back-compat exports", () => {
  it("NON_CHAT_PATTERNS still mirrors NON_CHAT_RULES", () => {
    expect(NON_CHAT_PATTERNS).toEqual(NON_CHAT_RULES.map((r) => r.pattern));
  });
});
