import { describe, expect, it } from "vitest";
import { PROVIDERS, PROVIDER_LIST, type ProviderMeta } from "./providers";
import { isEasyFreeLane, tierLabel, tierLimits, tierSummary } from "./free-tier-copy";

const meta = (over: Partial<ProviderMeta>): ProviderMeta =>
  ({ ...PROVIDERS.groq, ...over }) as ProviderMeta;

const withTier = (tier: ProviderMeta["freeTier"]) => meta({ freeTier: tier });

describe("tierLabel", () => {
  // The honesty rule, at the only place a user sees it.
  it("calls a recurring tier Free and a grant Credits", () => {
    expect(tierLabel(PROVIDERS.groq)).toBe("Free");
    expect(tierLabel(PROVIDERS.cerebras)).toBe("Credits");
  });

  it("calls a provider with no free tier Your key, not Paid", () => {
    // "Your key" says what the user must do; "Paid" only says no.
    expect(tierLabel(PROVIDERS.anthropic)).toBe("Your key");
    expect(tierLabel(PROVIDERS.openai)).toBe("Your key");
  });

  it("never labels a grant as free, whatever numbers it carries", () => {
    const generous = withTier({
      scope: { kind: "all" },
      quota: { kind: "grant", rpm: 999, rpd: 999_999, creditsUsd: 150 },
      signupUrl: "https://example.test",
      cardRequired: false,
    });
    expect(tierLabel(generous)).toBe("Credits");
  });
});

describe("tierLimits", () => {
  it("orders tightest window first", () => {
    const t = withTier({
      scope: { kind: "all" },
      quota: { kind: "recurring", rpm: 30, rpd: 1000, tpMonth: 1_000_000_000 },
      signupUrl: "https://example.test",
      cardRequired: false,
    }).freeTier!;
    expect(tierLimits(t)).toEqual(["30 req/min", "1,000 req/day", "1B tok/month"]);
  });

  it("compacts large numbers and keeps small ones exact", () => {
    const t = (q: Partial<NonNullable<ProviderMeta["freeTier"]>["quota"]>) =>
      tierLimits({
        scope: { kind: "all" },
        quota: { kind: "recurring", ...q },
        signupUrl: "x",
        cardRequired: false,
      });
    expect(t({ rpd: 1000 })).toEqual(["1,000 req/day"]);
    expect(t({ tpd: 500_000 })).toEqual(["500,000 tok/day"]);
    expect(t({ tpMonth: 1_000_000_000 })).toEqual(["1B tok/month"]);
    expect(t({ tpMonth: 1_500_000 })).toEqual(["1.5M tok/month"]);
  });

  it("says nothing for a tier that states no numbers", () => {
    expect(
      tierLimits({
        scope: { kind: "all" },
        quota: { kind: "recurring" },
        signupUrl: "x",
        cardRequired: false,
      }),
    ).toEqual([]);
  });
});

describe("tierSummary", () => {
  it("leads with the honest word and ends with the real price", () => {
    expect(tierSummary(PROVIDERS.groq)).toMatch(/^Free forever/);
    expect(tierSummary(PROVIDERS.groq)).toMatch(/no card$/);
  });

  it("surfaces a card requirement rather than burying it", () => {
    // Cerebras' tier is card-gated, which is the single most important thing
    // to know before clicking "connect".
    expect(tierSummary(PROVIDERS.cerebras)).toMatch(/^Credits, then paid/);
    expect(tierSummary(PROVIDERS.cerebras)).toContain("card required");
  });

  it("surfaces data sharing, which is the actual price of some free tiers", () => {
    const shares = meta({
      freeTier: {
        scope: { kind: "all" },
        quota: { kind: "recurring", rpm: 1 },
        signupUrl: "x",
        cardRequired: false,
        dataSharing: "required",
      },
    });
    expect(tierSummary(shares)).toContain("shares your prompts");
  });

  it("does not mention data sharing when there is none", () => {
    expect(tierSummary(PROVIDERS.groq)).not.toContain("sharing");
    expect(tierSummary(PROVIDERS.groq)).not.toContain("prompts");
  });

  it("says plainly when a provider has no free tier", () => {
    expect(tierSummary(PROVIDERS.anthropic)).toBe("No free tier — runs on your own key");
  });

  it("describes Local as the user's own machine, not somebody's key", () => {
    // Local has no `freeTier` and is marked `operator-funded`, so the generic
    // branches produced "Your key · Runs on the operator's key" — two claims
    // that contradict each other and neither of which is true of a model
    // running on localhost.
    expect(tierLabel(PROVIDERS.local)).toBe("Free");
    expect(tierSummary(PROVIDERS.local)).toBe("Runs on your own machine — no key, no limits");
  });
});

describe("isEasyFreeLane", () => {
  it("accepts a recurring, cardless tier", () => {
    expect(isEasyFreeLane(PROVIDERS.groq)).toBe(true);
  });

  it("rejects a card-gated tier, which is not free in the sense users mean", () => {
    expect(isEasyFreeLane(PROVIDERS.cerebras)).toBe(false);
  });

  it("rejects providers with no tier at all", () => {
    expect(isEasyFreeLane(PROVIDERS.anthropic)).toBe(false);
  });
});

describe("every provider produces usable copy", () => {
  // Guards the table and this formatter drifting apart: a new provider with a
  // malformed tier would otherwise render an empty or nonsensical line.
  it("gives a non-empty summary and a valid label for all of them", () => {
    for (const p of PROVIDER_LIST) {
      expect(tierSummary(p).length).toBeGreaterThan(0);
      expect(["Free", "Credits", "Your key"]).toContain(tierLabel(p));
    }
  });

  it("never claims a card-required tier is free of charge", () => {
    for (const p of PROVIDER_LIST) {
      if (p.freeTier?.cardRequired) expect(tierSummary(p)).toContain("card required");
    }
  });
});
