import { describe, expect, it } from "vitest";
import { bestVerification, isNegativeSignal, signalLabel, verifyArticle } from "./verify";
import type { ClusterEvidence } from "./verify";
import type { RawArticle } from "./types";

function article(partial: Partial<RawArticle> = {}): RawArticle {
  return {
    id: "a1",
    urlKey: "example.com/story",
    title: "A headline",
    summary: "",
    bodyText: "",
    url: "https://example.com/story",
    domain: "example.com",
    host: "example.com",
    sourceId: "src",
    sourceName: "Source",
    tier: "press",
    publishedAt: "2025-07-15T10:00:00.000Z",
    firstSeenAt: "2025-07-15T10:00:00.000Z",
    topics: ["models"],
    models: [],
    orgs: [],
    domainMatch: true,
    signature: [],
    aggregator: false,
    sourceWeight: 0.7,
    ...partial,
  };
}

function evidence(partial: Partial<ClusterEvidence> = {}): ClusterEvidence {
  return { domains: ["example.com"], sourceIds: ["src"], hasFirstParty: false, ...partial };
}

const alone = evidence();

describe("verifyArticle — levels", () => {
  it("marks a first-party announcement on its own domain as verified", () => {
    const result = verifyArticle(
      article({ tier: "first_party", domain: "openai.com", url: "https://openai.com/news/nova", brand: "OpenAI" }),
      evidence({ domains: ["openai.com"] }),
    );
    expect(result.level).toBe("verified");
    expect(result.signals).toContain("first_party_source");
  });

  it("marks a cross-domain story including a first-party source as verified", () => {
    const result = verifyArticle(
      article({ domain: "techcrunch.com", url: "https://techcrunch.com/story" }),
      evidence({
        domains: ["techcrunch.com", "openai.com"],
        sourceIds: ["techcrunch-ai", "openai"],
        hasFirstParty: true,
      }),
    );
    expect(result.level).toBe("verified");
  });

  it("marks an arXiv preprint as verified on its own", () => {
    // The preprint IS the primary document, even though arXiv is nobody's press office.
    const result = verifyArticle(
      article({
        tier: "research",
        domain: "arxiv.org",
        url: "https://arxiv.org/abs/2507.01234",
        sourceWeight: 0.85,
      }),
      evidence({ domains: ["arxiv.org"] }),
    );
    expect(result.level).toBe("verified");
    expect(result.signals).toContain("research_preprint");
  });

  it("does not treat an arXiv listing page as a preprint", () => {
    const result = verifyArticle(
      article({ tier: "research", domain: "arxiv.org", url: "https://arxiv.org/list/cs.AI/recent" }),
      evidence({ domains: ["arxiv.org"] }),
    );
    expect(result.signals).not.toContain("research_preprint");
    expect(result.level).toBe("reported");
  });

  it("marks two independent domains as corroborated", () => {
    const result = verifyArticle(
      article({ domain: "techcrunch.com", url: "https://techcrunch.com/story" }),
      evidence({
        domains: ["techcrunch.com", "theverge.com"],
        sourceIds: ["techcrunch-ai", "theverge-ai"],
      }),
    );
    expect(result.level).toBe("corroborated");
    expect(result.distinctDomains).toBe(2);
  });

  // The signal that stops syndication from masquerading as confirmation.
  it("does NOT reach corroborated on three feeds from one publisher", () => {
    const result = verifyArticle(
      article({ domain: "techcrunch.com", url: "https://techcrunch.com/story" }),
      evidence({
        domains: ["techcrunch.com", "techcrunch.com", "techcrunch.com"],
        sourceIds: ["tc-ai", "tc-startups", "tc-venture"],
      }),
    );
    expect(result.level).toBe("reported");
    expect(result.distinctDomains).toBe(1);
    expect(result.corroboration).toBe(3);
    expect(result.signals).toContain("multi_source");
    expect(result.signals).not.toContain("multi_domain");
  });

  it("marks a single trusted on-domain source as reported", () => {
    const result = verifyArticle(article({ sourceWeight: 0.7 }), alone);
    expect(result.level).toBe("reported");
  });

  // A first-party feed republishing someone else's story is still republishing.
  it("caps a domain mismatch at unconfirmed even for a first-party feed", () => {
    const result = verifyArticle(
      article({
        tier: "first_party",
        brand: "OpenAI",
        domain: "somewhereelse.test",
        url: "https://somewhereelse.test/story",
        domainMatch: false,
        sourceWeight: 1,
      }),
      evidence({ domains: ["somewhereelse.test", "other.test"], hasFirstParty: true }),
    );
    expect(result.level).toBe("unconfirmed");
    expect(result.signals).toContain("domain_mismatch");
    expect(result.signals).not.toContain("first_party_source");
  });

  it("marks an item with no usable link as unconfirmed", () => {
    const result = verifyArticle(article({ url: "" }), alone);
    expect(result.level).toBe("unconfirmed");
    expect(result.signals).toContain("no_canonical_link");
  });

  it("treats a bare homepage link as no canonical link", () => {
    const result = verifyArticle(
      article({ url: "https://example.com/", domain: "example.com" }),
      alone,
    );
    expect(result.signals).toContain("no_canonical_link");
    expect(result.level).toBe("unconfirmed");
  });
});

describe("verifyArticle — signals and score", () => {
  it("flags a lone low-trust source", () => {
    const result = verifyArticle(article({ sourceWeight: 0.35 }), alone);
    expect(result.signals).toContain("single_low_trust");
  });

  it("does not flag low trust once the story is corroborated", () => {
    const result = verifyArticle(
      article({ sourceWeight: 0.35 }),
      evidence({ domains: ["a.test", "b.test"], sourceIds: ["a", "b"] }),
    );
    expect(result.signals).not.toContain("single_low_trust");
  });

  it("records an author byline", () => {
    expect(verifyArticle(article({ author: "Ada" }), alone).signals).toContain("author_attributed");
    expect(verifyArticle(article(), alone).signals).not.toContain("author_attributed");
  });

  it("scores a first-party corroborated story above a lone press item", () => {
    const strong = verifyArticle(
      article({ tier: "first_party", domain: "openai.com", url: "https://openai.com/news/x", sourceWeight: 1 }),
      evidence({ domains: ["openai.com", "theverge.com"], sourceIds: ["openai", "verge"], hasFirstParty: true }),
    );
    const weak = verifyArticle(article({ sourceWeight: 0.55 }), alone);
    expect(strong.score).toBeGreaterThan(weak.score);
  });

  it("keeps the score inside 0..100 in every case", () => {
    const cases = [
      verifyArticle(article({ url: "" }), evidence({ domains: [] })),
      verifyArticle(article({ domainMatch: false }), alone),
      verifyArticle(
        article({ tier: "first_party", domain: "openai.com", url: "https://openai.com/a", author: "A", sourceWeight: 1 }),
        evidence({
          domains: ["a.test", "b.test", "c.test", "d.test", "e.test", "openai.com"],
          sourceIds: ["1", "2", "3", "4", "5", "6"],
          hasFirstParty: true,
        }),
      ),
    ];
    for (const result of cases) {
      expect(Number.isFinite(result.score)).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }
  });

  it("is deterministic", () => {
    const input = article({ tier: "research", domain: "arxiv.org", url: "https://arxiv.org/abs/2507.00001" });
    const first = verifyArticle(input, alone);
    for (let i = 0; i < 5; i++) expect(verifyArticle(input, alone)).toEqual(first);
  });
});

describe("bestVerification", () => {
  it("picks the strongest verdict in a cluster", () => {
    const reported = verifyArticle(article(), alone);
    const verified = verifyArticle(
      article({ tier: "first_party", domain: "openai.com", url: "https://openai.com/a", sourceWeight: 1 }),
      evidence({ domains: ["openai.com"] }),
    );
    expect(bestVerification([reported, verified]).level).toBe("verified");
  });

  it("returns an unconfirmed placeholder for an empty cluster", () => {
    expect(bestVerification([]).level).toBe("unconfirmed");
  });
});

describe("signal presentation", () => {
  it("has a plain-English label for every signal", () => {
    const result = verifyArticle(
      article({ tier: "first_party", brand: "OpenAI", domain: "openai.com", url: "https://openai.com/a", author: "Ada" }),
      evidence({ domains: ["openai.com", "b.test"], sourceIds: ["a", "b"], hasFirstParty: true }),
    );
    for (const signal of result.signals) {
      const label = signalLabel(signal, { host: "openai.com", brand: "OpenAI" });
      expect(label.length, signal).toBeGreaterThan(10);
    }
  });

  it("identifies the negative signals", () => {
    expect(isNegativeSignal("domain_mismatch")).toBe(true);
    expect(isNegativeSignal("no_canonical_link")).toBe(true);
    expect(isNegativeSignal("single_low_trust")).toBe(true);
    expect(isNegativeSignal("first_party_source")).toBe(false);
    expect(isNegativeSignal("multi_domain")).toBe(false);
  });
});
