import { describe, expect, it } from "vitest";
import { clusterArticles, signatureOf, titleTokens } from "./cluster";
import type { RawArticle } from "./types";

// A builder rather than fixtures: clustering depends on a dozen fields at once,
// and spelling them out per case buries the one that matters in each test.
let seq = 0;
function article(partial: Partial<RawArticle> & { title: string }): RawArticle {
  seq++;
  const id = partial.id ?? `a${seq}`;
  const url = partial.url ?? `https://${partial.domain ?? "press.test"}/story-${id}`;
  const base: RawArticle = {
    id,
    urlKey: partial.urlKey ?? url.replace(/^https?:\/\//, ""),
    title: partial.title,
    summary: partial.summary ?? "",
    bodyText: partial.bodyText ?? "",
    url,
    domain: partial.domain ?? "press.test",
    host: partial.host ?? partial.domain ?? "press.test",
    sourceId: partial.sourceId ?? `src-${id}`,
    sourceName: partial.sourceName ?? "Source",
    tier: partial.tier ?? "press",
    brand: partial.brand,
    author: partial.author,
    publishedAt: partial.publishedAt ?? "2025-07-15T10:00:00.000Z",
    firstSeenAt: partial.firstSeenAt ?? "2025-07-15T10:00:00.000Z",
    topics: partial.topics ?? ["models"],
    models: partial.models ?? [],
    orgs: partial.orgs ?? [],
    image: partial.image,
    readMinutes: partial.readMinutes,
    domainMatch: partial.domainMatch ?? true,
    signature: [],
    aggregator: partial.aggregator ?? false,
    sourceWeight: partial.sourceWeight ?? 0.6,
  };
  return { ...base, signature: partial.signature ?? signatureOf(base.title, base.models) };
}

/** Are these two article ids in the same cluster? */
function together(articles: RawArticle[], a: string, b: string): boolean {
  const { clusterOf } = clusterArticles(articles);
  return clusterOf.get(a) === clusterOf.get(b);
}

describe("titleTokens", () => {
  it("drops stopwords and keeps version numbers intact", () => {
    expect(titleTokens("OpenAI announces the new GPT-5.5 for developers")).toEqual([
      "openai",
      "announces",
      "gpt-5.5",
      "developers",
    ]);
  });

  it("returns an empty list for a title of only stopwords", () => {
    expect(titleTokens("the and of to")).toEqual([]);
  });
});

describe("signatureOf", () => {
  it("is deterministic and bounded", () => {
    const one = signatureOf("Nova 3 ships with a longer context window");
    const two = signatureOf("Nova 3 ships with a longer context window");
    expect(one).toEqual(two);
    expect(one.length).toBeLessThanOrEqual(12);
  });

  it("is empty for a title with no significant tokens", () => {
    expect(signatureOf("the and of")).toEqual([]);
  });
});

describe("clusterArticles", () => {
  it("groups near-duplicate headlines about the same launch", () => {
    const items = [
      article({
        id: "first",
        title: "OpenAI launches GPT-5.5 with a one million token context window",
        domain: "openai.com",
        tier: "first_party",
        sourceWeight: 1,
        models: ["gpt-5-5"],
        orgs: ["OpenAI"],
      }),
      article({
        id: "tc",
        title: "OpenAI launches GPT-5.5 with one million token context",
        domain: "techcrunch.com",
        models: ["gpt-5-5"],
        orgs: ["OpenAI"],
      }),
      article({
        id: "verge",
        title: "GPT-5.5 launches from OpenAI with a million token context window",
        domain: "theverge.com",
        models: ["gpt-5-5"],
        orgs: ["OpenAI"],
      }),
    ];

    const { members, clusterOf } = clusterArticles(items);
    expect(members.size).toBe(1);
    expect(clusterOf.get("first")).toBe(clusterOf.get("tc"));
    expect(clusterOf.get("first")).toBe(clusterOf.get("verge"));
  });

  it("keeps unrelated stories apart", () => {
    const items = [
      article({ id: "x", title: "OpenAI launches GPT-5.5", models: ["gpt-5-5"], orgs: ["OpenAI"] }),
      article({
        id: "y",
        title: "EU regulators open an inquiry into data centre power use",
        orgs: [],
        topics: ["policy"],
      }),
    ];
    expect(together(items, "x", "y")).toBe(false);
  });

  // The dual gate. Similarity alone merges these — same headline shape, entirely
  // different story — so a shared entity is required as well.
  it("does not merge same-shaped headlines about different companies", () => {
    const items = [
      article({
        id: "openai",
        title: "OpenAI announces a price cut for its flagship model",
        domain: "openai.com",
        orgs: ["OpenAI"],
        models: ["gpt-5-5"],
      }),
      article({
        id: "google",
        title: "Google announces a price cut for its flagship model",
        domain: "blog.google",
        orgs: ["Google"],
        models: ["gemini-3-flash"],
      }),
    ];
    expect(together(items, "openai", "google")).toBe(false);
  });

  it("does not merge two stories that merely share an organisation", () => {
    const items = [
      article({ id: "a", title: "OpenAI launches GPT-5.5 for developers", orgs: ["OpenAI"] }),
      article({ id: "b", title: "OpenAI hires a new chief financial officer", orgs: ["OpenAI"] }),
    ];
    expect(together(items, "a", "b")).toBe(false);
  });

  it("merges two items with the same destination even if headlines differ", () => {
    const shared = "example.com/the-same-article";
    const items = [
      article({ id: "a", title: "One phrasing of a headline", urlKey: shared }),
      article({ id: "b", title: "A completely different rewrite", urlKey: shared }),
    ];
    expect(together(items, "a", "b")).toBe(true);
  });

  it("merges same-domain duplicates without requiring a shared entity", () => {
    // One publisher does not publish the same headline twice by coincidence.
    const items = [
      article({ id: "a", title: "Inference costs fall as capacity grows", domain: "press.test" }),
      article({ id: "b", title: "Inference costs fall while capacity grows", domain: "press.test" }),
    ];
    expect(together(items, "a", "b")).toBe(true);
  });

  // Both of these are real pairs from a live sync that the n-gram-only gate
  // missed. A rewritten headline destroys almost every bigram, so the sketch
  // scored them far below threshold while a human reads them as one story.
  it("merges a first-party announcement with reworded press coverage", () => {
    const items = [
      article({
        id: "nvidia",
        title:
          "Ilya Sutskever's Safe Superintelligence Inc. and NVIDIA Announce Long-Term Strategic Partnership",
        domain: "nvidia.com",
        tier: "first_party",
        sourceWeight: 0.9,
        orgs: ["NVIDIA"],
      }),
      article({
        id: "tc",
        title:
          "Ilya Sutskever's Safe Superintelligence partners with Nvidia to scale its AI research",
        domain: "techcrunch.com",
        orgs: ["NVIDIA"],
      }),
    ];
    expect(together(items, "nvidia", "tc")).toBe(true);
  });

  it("merges a short and a long headline about the same launch", () => {
    // Neither carries a catalog model or a known organisation, so the merge
    // rests entirely on the shared distinctive tokens.
    const items = [
      article({ id: "hf", title: "Welcome Inkling by Thinking Machines", domain: "huggingface.co" }),
      article({
        id: "together",
        title: "Together AI brings Thinking Machines Lab's new model Inkling on day 0",
        domain: "together.ai",
      }),
    ];
    expect(together(items, "hf", "together")).toBe(true);
  });

  // Both of these are real FALSE merges the looser gate produced on live data.
  it("does not merge two unrelated stories that share only human-interest words", () => {
    // Shared: "ai", "people", "work" — high overlap, zero information. This one
    // was badged `verified` across two domains, which is the worst possible
    // outcome: a fabricated corroboration claim wearing the strongest badge.
    const items = [
      article({
        id: "openai",
        title: "How AI is expanding what people do at work",
        domain: "openai.com",
        tier: "first_party",
        sourceWeight: 1,
        orgs: ["OpenAI"],
      }),
      article({
        id: "meta",
        title: "Announcing the AI Glasses Impact Grant Recipients: Helping People Work and Learn",
        domain: "fb.com",
        tier: "first_party",
        sourceWeight: 0.95,
        orgs: ["Meta"],
      }),
    ];
    expect(together(items, "openai", "meta")).toBe(false);
  });

  it("does not merge two arXiv papers that share only a technique name", () => {
    // Same domain, so the same-event check is skipped — the higher same-domain
    // textual bar is what has to catch this.
    const items = [
      article({
        id: "moe",
        title: "MoE-LoRA: When MoE Models Meet MoE-style Low-Rank Adaptation",
        domain: "arxiv.org",
        tier: "research",
        sourceWeight: 0.85,
      }),
      article({
        id: "conv",
        title: "On the Convergence of Stochastic Low-Rank Adaptation",
        domain: "arxiv.org",
        tier: "research",
        sourceWeight: 0.85,
      }),
    ];
    expect(together(items, "moe", "conv")).toBe(false);
  });

  it("still refuses a merge whose only shared words are newsroom filler", () => {
    // The counterweight to the two cases above: high overlap, nothing distinctive.
    const items = [
      article({
        id: "a",
        title: "OpenAI announces a price cut for its flagship model",
        domain: "openai.com",
        orgs: ["OpenAI"],
      }),
      article({
        id: "b",
        title: "Google announces a price cut for its flagship model",
        domain: "blog.google",
        orgs: ["Google"],
      }),
    ];
    expect(together(items, "a", "b")).toBe(false);
  });

  it("does not merge reports published more than a few days apart", () => {
    const items = [
      article({
        id: "old",
        title: "OpenAI launches GPT-5.5 with a longer context window",
        publishedAt: "2025-07-01T10:00:00.000Z",
        orgs: ["OpenAI"],
        models: ["gpt-5-5"],
      }),
      article({
        id: "new",
        title: "OpenAI launches GPT-5.5 with a longer context window",
        domain: "other.test",
        publishedAt: "2025-07-15T10:00:00.000Z",
        orgs: ["OpenAI"],
        models: ["gpt-5-5"],
      }),
    ];
    expect(together(items, "old", "new")).toBe(false);
  });

  it("elects the first-party announcement as the lead", () => {
    const items = [
      article({
        id: "press",
        title: "OpenAI launches GPT-5.5 with a longer context window",
        domain: "techcrunch.com",
        publishedAt: "2025-07-15T09:00:00.000Z",
        orgs: ["OpenAI"],
        models: ["gpt-5-5"],
      }),
      article({
        id: "lab",
        title: "Introducing GPT-5.5: OpenAI launches a longer context window",
        domain: "openai.com",
        tier: "first_party",
        sourceWeight: 1,
        publishedAt: "2025-07-15T10:00:00.000Z",
        orgs: ["OpenAI"],
        models: ["gpt-5-5"],
      }),
    ];
    const { leads, clusterOf } = clusterArticles(items);
    // Later in time, but it is the announcement — that is where a reader should land.
    expect(leads.get(clusterOf.get("lab")!)).toBe("lab");
  });

  it("never leads with an aggregator", () => {
    const items = [
      article({
        id: "agg",
        title: "OpenAI launches GPT-5.5 with a longer context window",
        domain: "google.com",
        aggregator: true,
        sourceWeight: 0.35,
        publishedAt: "2025-07-15T08:00:00.000Z",
        orgs: ["OpenAI"],
        models: ["gpt-5-5"],
      }),
      article({
        id: "real",
        title: "OpenAI launches GPT-5.5 with a longer context window",
        domain: "techcrunch.com",
        publishedAt: "2025-07-15T09:00:00.000Z",
        orgs: ["OpenAI"],
        models: ["gpt-5-5"],
      }),
    ];
    const { leads, clusterOf } = clusterArticles(items);
    expect(leads.get(clusterOf.get("agg")!)).toBe("real");
  });

  it("never leads with a republished item when an on-domain one exists", () => {
    const items = [
      article({
        id: "republished",
        title: "OpenAI launches GPT-5.5 with a longer context window",
        domain: "syndicator.test",
        domainMatch: false,
        sourceWeight: 0.95,
        tier: "first_party",
        publishedAt: "2025-07-15T08:00:00.000Z",
        orgs: ["OpenAI"],
        models: ["gpt-5-5"],
      }),
      article({
        id: "ondomain",
        title: "OpenAI launches GPT-5.5 with a longer context window",
        domain: "techcrunch.com",
        publishedAt: "2025-07-15T09:00:00.000Z",
        orgs: ["OpenAI"],
        models: ["gpt-5-5"],
      }),
    ];
    const { leads, clusterOf } = clusterArticles(items);
    expect(leads.get(clusterOf.get("republished")!)).toBe("ondomain");
  });

  it("puts the lead first in the member list", () => {
    const items = [
      article({
        id: "press",
        title: "OpenAI launches GPT-5.5 with a longer context window",
        domain: "techcrunch.com",
        orgs: ["OpenAI"],
        models: ["gpt-5-5"],
      }),
      article({
        id: "lab",
        title: "OpenAI launches GPT-5.5 with a longer context window",
        domain: "openai.com",
        tier: "first_party",
        sourceWeight: 1,
        orgs: ["OpenAI"],
        models: ["gpt-5-5"],
      }),
    ];
    const { members, clusterOf } = clusterArticles(items);
    expect(members.get(clusterOf.get("lab")!)?.[0]).toBe("lab");
  });

  it("keeps the cluster id stable when a fourth member joins", () => {
    const core = [
      article({
        id: "lab",
        title: "OpenAI launches GPT-5.5 with a longer context window",
        domain: "openai.com",
        tier: "first_party",
        sourceWeight: 1,
        orgs: ["OpenAI"],
        models: ["gpt-5-5"],
      }),
      article({
        id: "tc",
        title: "OpenAI launches GPT-5.5 with a longer context window",
        domain: "techcrunch.com",
        orgs: ["OpenAI"],
        models: ["gpt-5-5"],
      }),
    ];
    const before = clusterArticles(core).clusterOf.get("lab");

    const later = clusterArticles([
      ...core,
      article({
        id: "verge",
        title: "OpenAI launches GPT-5.5 with longer context windows",
        domain: "theverge.com",
        orgs: ["OpenAI"],
        models: ["gpt-5-5"],
      }),
    ]);
    // The lead did not change, so neither did the id — which is what lets
    // expanded UI state and shared links survive an hourly rebuild.
    expect(later.clusterOf.get("lab")).toBe(before);
  });

  it("gives every article exactly one cluster", () => {
    const items = Array.from({ length: 25 }, (_, i) =>
      article({ id: `n${i}`, title: `Distinct headline number ${i} about a model release` }),
    );
    const { clusterOf, members } = clusterArticles(items);
    expect(clusterOf.size).toBe(items.length);
    const counted = [...members.values()].reduce((sum, m) => sum + m.length, 0);
    expect(counted).toBe(items.length);
  });

  it("handles an empty corpus", () => {
    const { clusterOf, members, leads } = clusterArticles([]);
    expect(clusterOf.size).toBe(0);
    expect(members.size).toBe(0);
    expect(leads.size).toBe(0);
  });

  it("does not merge items whose titles produce no signature", () => {
    const items = [
      article({ id: "a", title: "the and of", signature: [] }),
      article({ id: "b", title: "to be or", signature: [], domain: "other.test" }),
    ];
    expect(together(items, "a", "b")).toBe(false);
  });
});
