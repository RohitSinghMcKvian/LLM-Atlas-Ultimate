import { describe, expect, it } from "vitest";
import { PROVIDERS, hasCreditGrant, inFreeTier, type FreeTier } from "./providers";

// `inFreeTier` is the descriptor half of `routeCost`. The rule it encodes is the
// product decision that "free" must mean free *forever*, so a signup credit or a
// card-gated trial can never render as Free — only as Credits.

const tier = (over: Partial<FreeTier> = {}): FreeTier => ({
  scope: { kind: "all" },
  quota: { kind: "recurring" },
  signupUrl: "https://example.test",
  cardRequired: false,
  ...over,
});

describe("inFreeTier", () => {
  it("is false when the provider has no free tier at all", () => {
    expect(inFreeTier(undefined, "anything")).toBe(false);
  });

  it("covers every route under an `all` scope", () => {
    expect(inFreeTier(tier(), "llama-3.3-70b")).toBe(true);
  });

  it("covers only the suffixed routes under a `suffix` scope", () => {
    const t = tier({ scope: { kind: "suffix", suffix: ":free" } });
    expect(inFreeTier(t, "openai/gpt-oss-20b:free")).toBe(true);
    expect(inFreeTier(t, "cohere/command-a")).toBe(false);
    // Not a substring match: the suffix has to actually end the id.
    expect(inFreeTier(t, "openai/gpt-oss-20b:free-preview")).toBe(false);
  });

  it("covers only the named routes under a `models` scope", () => {
    // Z.ai's shape: the Flash models are free, everything else on the same key
    // is billed. A provider-wide flag cannot express this, which is why the
    // scope exists.
    const t = tier({ scope: { kind: "models", ids: ["glm-4.7-flash", "glm-4.5-flash"] } });
    expect(inFreeTier(t, "glm-4.7-flash")).toBe(true);
    expect(inFreeTier(t, "glm-5.1")).toBe(false);
  });

  // THE honesty rule. Cerebras' $5 trial, xAI's signup credits and DeepSeek's
  // token grant all run out; labelling them Free would promise something the
  // server cannot honour a month later.
  it("never counts a grant as free, whatever its scope", () => {
    expect(inFreeTier(tier({ quota: { kind: "grant", creditsUsd: 25 } }), "grok-4")).toBe(false);
    expect(
      inFreeTier(
        tier({ scope: { kind: "suffix", suffix: ":free" }, quota: { kind: "grant" } }),
        "x:free",
      ),
    ).toBe(false);
  });
});

describe("hasCreditGrant", () => {
  it("is true only for an expiring allowance", () => {
    expect(hasCreditGrant({ ...PROVIDERS.groq, freeTier: tier({ quota: { kind: "grant" } }) })).toBe(
      true,
    );
    expect(hasCreditGrant(PROVIDERS.groq)).toBe(false);
    expect(hasCreditGrant(PROVIDERS.local)).toBe(false);
  });
});

describe("the shipped provider table", () => {
  it("gives every free tier a signup URL", () => {
    // The connect flow deep-links this; a blank one is a dead end.
    for (const p of Object.values(PROVIDERS)) {
      if (!p.freeTier) continue;
      expect(p.freeTier.signupUrl, p.id).toMatch(/^https:\/\//);
    }
  });

  it("states at least one concrete limit for every recurring tier", () => {
    // A tier with no numbers cannot drive a meter, and "Free · unlimited" is a
    // claim no provider actually makes.
    for (const p of Object.values(PROVIDERS)) {
      const q = p.freeTier?.quota;
      if (!q || q.kind !== "recurring") continue;
      const stated = [q.rpm, q.rpd, q.tpm, q.tpd, q.tpMonth].some(
        (v) => typeof v === "number" && v > 0,
      );
      expect(stated, p.id).toBe(true);
    }
  });

  it("keeps OpenRouter's :free suffix as the only suffix-scoped tier", () => {
    // If a second provider ever adopts the convention this should be revisited
    // deliberately rather than by accident.
    const suffixed = Object.values(PROVIDERS).filter(
      (p) => p.freeTier?.scope.kind === "suffix",
    );
    expect(suffixed.map((p) => p.id)).toEqual(["openrouter"]);
  });
});
