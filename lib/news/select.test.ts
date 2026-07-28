import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  clusterSiblings,
  hasActiveFilters,
  parseNewsSearchParams,
  relatedArticles,
  selectArticles,
  toNewsSearchParams,
  trendingFromNews,
} from "./select";
import type { NewsArticle, NewsCluster, NewsFilterState, NewsTopic } from "./types";

const NOW = Date.parse("2025-07-16T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

let seq = 0;
function article(partial: Partial<NewsArticle> & { title: string }): NewsArticle {
  seq++;
  const id = partial.id ?? `a${seq}`;
  return {
    id,
    title: partial.title,
    summary: partial.summary ?? "",
    url: partial.url ?? `https://press.test/${id}`,
    domain: partial.domain ?? "press.test",
    host: partial.host ?? partial.domain ?? "press.test",
    sourceId: partial.sourceId ?? "press",
    sourceName: partial.sourceName ?? "Example Press",
    tier: partial.tier ?? "press",
    brand: partial.brand,
    author: partial.author,
    publishedAt: partial.publishedAt ?? hoursAgo(2),
    firstSeenAt: partial.firstSeenAt ?? hoursAgo(2),
    topics: partial.topics ?? ["models"],
    models: partial.models ?? [],
    orgs: partial.orgs ?? [],
    image: partial.image,
    baseScore: partial.baseScore ?? 50,
    verification: partial.verification ?? {
      level: "reported",
      score: 40,
      signals: [],
      corroboration: 1,
      distinctDomains: 1,
      firstParty: false,
    },
    clusterId: partial.clusterId ?? `c-${id}`,
    lead: partial.lead ?? true,
    readMinutes: partial.readMinutes,
  };
}

function cluster(id: string, memberIds: string[]): NewsCluster {
  return {
    id,
    leadId: memberIds[0],
    memberIds,
    domains: ["press.test"],
    topics: ["models"],
    models: [],
    latestAt: hoursAgo(1),
    firstAt: hoursAgo(3),
    baseScore: 50,
    verification: {
      level: "reported",
      score: 40,
      signals: [],
      corroboration: memberIds.length,
      distinctDomains: 1,
      firstParty: false,
    },
  };
}

const filters = (patch: Partial<NewsFilterState> = {}): NewsFilterState => ({
  ...DEFAULT_FILTERS,
  ...patch,
});

const run = (
  articles: NewsArticle[],
  patch: Partial<NewsFilterState> = {},
  extra: { clusters?: NewsCluster[]; saved?: Set<string> } = {},
) =>
  selectArticles({
    articles,
    clusters: extra.clusters ?? articles.map((a) => cluster(a.clusterId, [a.id])),
    filters: filters(patch),
    saved: extra.saved,
    now: NOW,
  });

describe("URL round-trip", () => {
  it("serialises and parses a full filter state", () => {
    const state = filters({
      topics: ["models", "agents"],
      query: "opus",
      sources: ["openai", "techcrunch-ai"],
      verifiedOnly: true,
      savedOnly: true,
      sort: "latest",
      view: "compact",
      articleId: "abc123",
    });
    expect(parseNewsSearchParams(new URLSearchParams(toNewsSearchParams(state)))).toEqual(state);
  });

  it("omits defaults so a clean view has a clean URL", () => {
    expect(toNewsSearchParams(DEFAULT_FILTERS)).toBe("");
  });

  it("ignores unknown topics, sorts and views rather than throwing", () => {
    const parsed = parseNewsSearchParams(
      new URLSearchParams("t=models,notatopic&sort=bogus&view=nope"),
    );
    expect(parsed.topics).toEqual(["models"]);
    expect(parsed.sort).toBe("top");
    expect(parsed.view).toBe("magazine");
  });

  it("accepts a Next-style searchParams record", () => {
    expect(parseNewsSearchParams({ t: "agents", q: "kimi" }).topics).toEqual(["agents"]);
    expect(parseNewsSearchParams({ t: ["agents", "models"] }).topics).toEqual(["agents"]);
  });

  it("reports whether anything is filtering", () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters(filters({ topics: ["safety"] }))).toBe(true);
    expect(hasActiveFilters(filters({ query: "  " }))).toBe(false);
    // A sort or layout choice is a preference, not a filter — the "Clear
    // filters" button must not appear because someone picked Timeline.
    expect(hasActiveFilters(filters({ sort: "latest", view: "timeline" }))).toBe(false);
  });
});

describe("topic filtering", () => {
  const corpus = [
    article({ id: "m", title: "A model launch", topics: ["models"] }),
    article({ id: "s", title: "A safety study", topics: ["safety"] }),
    article({ id: "ms", title: "A safe model", topics: ["models", "safety"] }),
    article({ id: "p", title: "A policy story", topics: ["policy"] }),
  ];

  it("is OR within topics", () => {
    const ids = run(corpus, { topics: ["models", "policy"] }).articles.map((a) => a.id);
    expect(new Set(ids)).toEqual(new Set(["m", "ms", "p"]));
  });

  it("is AND across filter kinds", () => {
    const withSource = [
      ...corpus,
      article({ id: "other", title: "A model launch elsewhere", sourceId: "verge" }),
    ];
    const ids = run(withSource, { topics: ["models"], sources: ["verge"] }).articles.map((a) => a.id);
    expect(ids).toEqual(["other"]);
  });

  it("counts topics as if that topic were selected, not as filtered", () => {
    // A chip reading 0 for everything unticked would tell the reader nothing.
    const counts = run(corpus, { topics: ["policy"] }).topicCounts;
    expect(counts.models).toBe(2);
    expect(counts.safety).toBe(2);
    expect(counts.policy).toBe(1);
  });
});

describe("search", () => {
  const corpus = [
    article({ id: "t", title: "Claude Opus 5 ships" }),
    article({ id: "s", title: "Something else", summary: "A story about Opus pricing" }),
    article({ id: "d", title: "Unrelated", host: "openai.com", domain: "openai.com" }),
    article({ id: "m", title: "Also unrelated", models: ["claude-opus-4-8"] }),
    article({ id: "o", title: "Org story", orgs: ["Anthropic"] }),
    article({ id: "n", title: "Nothing matching here" }),
  ];

  it("matches the title and the summary", () => {
    expect(run(corpus, { query: "opus" }).articles.map((a) => a.id).sort()).toEqual(["m", "s", "t"]);
  });

  it("matches the domain, so a reader can paste a host", () => {
    expect(run(corpus, { query: "openai.com" }).articles.map((a) => a.id)).toEqual(["d"]);
  });

  it("matches a model id and an organisation", () => {
    expect(run(corpus, { query: "claude-opus-4-8" }).articles.map((a) => a.id)).toEqual(["m"]);
    expect(run(corpus, { query: "anthropic" }).articles.map((a) => a.id)).toEqual(["o"]);
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(run(corpus, { query: "  OPUS  " }).articles.length).toBe(3);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(run(corpus, { query: "zzzzz" }).articles).toEqual([]);
  });
});

describe("verified and saved filters", () => {
  const corpus = [
    article({
      id: "v",
      title: "Verified",
      verification: {
        level: "verified",
        score: 90,
        signals: [],
        corroboration: 1,
        distinctDomains: 1,
        firstParty: true,
      },
    }),
    article({
      id: "c",
      title: "Corroborated",
      verification: {
        level: "corroborated",
        score: 70,
        signals: [],
        corroboration: 2,
        distinctDomains: 2,
        firstParty: false,
      },
    }),
    article({ id: "r", title: "Reported" }),
    article({
      id: "u",
      title: "Unconfirmed",
      verification: {
        level: "unconfirmed",
        score: 5,
        signals: [],
        corroboration: 1,
        distinctDomains: 1,
        firstParty: false,
      },
    }),
  ];

  it("keeps verified and corroborated, drops reported and unconfirmed", () => {
    const ids = run(corpus, { verifiedOnly: true }).articles.map((a) => a.id).sort();
    expect(ids).toEqual(["c", "v"]);
  });

  it("filters to saved ids", () => {
    const ids = run(corpus, { savedOnly: true }, { saved: new Set(["r", "u"]) }).articles.map(
      (a) => a.id,
    );
    expect(ids.sort()).toEqual(["r", "u"]);
  });

  it("shows nothing when savedOnly is set and nothing is saved", () => {
    expect(run(corpus, { savedOnly: true }, { saved: new Set() }).articles).toEqual([]);
  });
});

describe("sorting", () => {
  const corpus = [
    article({ id: "old-strong", title: "Old but strong", baseScore: 95, publishedAt: hoursAgo(40) }),
    article({ id: "new-weak", title: "New but weak", baseScore: 20, publishedAt: hoursAgo(1) }),
    article({
      id: "corroborated",
      title: "Corroborated",
      baseScore: 60,
      publishedAt: hoursAgo(10),
      verification: {
        level: "corroborated",
        score: 75,
        signals: [],
        corroboration: 3,
        distinctDomains: 3,
        firstParty: false,
      },
    }),
  ];

  it("latest is strictly chronological", () => {
    expect(run(corpus, { sort: "latest" }).articles.map((a) => a.id)).toEqual([
      "new-weak",
      "corroborated",
      "old-strong",
    ]);
  });

  it("corroborated ranks by distinct domains", () => {
    expect(run(corpus, { sort: "corroborated" }).articles[0].id).toBe("corroborated");
  });

  it("verified ranks by level then score", () => {
    expect(run(corpus, { sort: "verified" }).articles[0].id).toBe("corroborated");
  });

  it("every mode is a total order with no NaN", () => {
    for (const sort of ["top", "latest", "verified", "corroborated"] as const) {
      const first = run(corpus, { sort }).articles.map((a) => a.id);
      // Stable across repeated runs — an unstable sort reshuffles the feed on
      // every keystroke of the search box.
      expect(run(corpus, { sort }).articles.map((a) => a.id), sort).toEqual(first);
      expect(first.length).toBe(corpus.length);
    }
  });

  it("breaks ties deterministically when scores and times are identical", () => {
    const twins = [
      article({ id: "zzz", title: "Twin", baseScore: 50, publishedAt: hoursAgo(1) }),
      article({ id: "aaa", title: "Twin", baseScore: 50, publishedAt: hoursAgo(1) }),
    ];
    expect(run(twins, { sort: "top" }).articles.map((a) => a.id)).toEqual(["aaa", "zzz"]);
  });
});

describe("source diversity in the default ranking", () => {
  // Publishers post in bursts. On live data one source shipped twelve items in
  // one window at nearly identical scores and took the entire first screen,
  // hiding thirty other sources below the fold.
  const burst = Array.from({ length: 12 }, (_, i) =>
    article({
      id: `burst${i}`,
      title: `Burst item ${i} about a model`,
      sourceId: "google-dev",
      baseScore: 70,
      publishedAt: hoursAgo(1),
      clusterId: `cb${i}`,
    }),
  );
  const others = Array.from({ length: 6 }, (_, i) =>
    article({
      id: `other${i}`,
      title: `Other item ${i} about a model`,
      sourceId: `source-${i}`,
      baseScore: 66,
      publishedAt: hoursAgo(1),
      clusterId: `co${i}`,
    }),
  );
  const corpus = [...burst, ...others];

  it("interleaves publishers in the top slots", () => {
    const top = run(corpus, { sort: "top" }).articles.slice(0, 8);
    const distinct = new Set(top.map((a) => a.sourceId));
    expect(distinct.size).toBeGreaterThan(3);
  });

  it("still lets the strongest source lead", () => {
    expect(run(corpus, { sort: "top" }).articles[0].sourceId).toBe("google-dev");
  });

  it("keeps every article — diversity reorders, it never drops", () => {
    const result = run(corpus, { sort: "top" });
    expect(result.articles.length).toBe(corpus.length);
    expect(new Set(result.articles.map((a) => a.id)).size).toBe(corpus.length);
  });

  it("leaves the chronological sort strictly chronological", () => {
    // Reordering "Latest" would be lying about what the reader asked for.
    const dated = [
      article({ id: "n1", title: "One", sourceId: "a", publishedAt: hoursAgo(1), clusterId: "x1" }),
      article({ id: "n2", title: "Two", sourceId: "a", publishedAt: hoursAgo(2), clusterId: "x2" }),
      article({ id: "n3", title: "Three", sourceId: "b", publishedAt: hoursAgo(3), clusterId: "x3" }),
    ];
    expect(run(dated, { sort: "latest" }).articles.map((a) => a.id)).toEqual(["n1", "n2", "n3"]);
  });

  it("is deterministic", () => {
    const first = run(corpus, { sort: "top" }).articles.map((a) => a.id);
    for (let i = 0; i < 3; i++) {
      expect(run(corpus, { sort: "top" }).articles.map((a) => a.id)).toEqual(first);
    }
  });
});

describe("cluster collapsing", () => {
  const lead = article({ id: "lead", title: "The announcement", clusterId: "c1", lead: true });
  const member = article({
    id: "member",
    title: "The coverage",
    clusterId: "c1",
    lead: false,
    topics: ["policy"],
  });
  const solo = article({ id: "solo", title: "Unrelated story", clusterId: "c2" });
  const corpus = [lead, member, solo];
  const clusters = [cluster("c1", ["lead", "member"]), cluster("c2", ["solo"])];

  it("shows one card per cluster", () => {
    const ids = run(corpus, {}, { clusters }).articles.map((a) => a.id).sort();
    expect(ids).toEqual(["lead", "solo"]);
  });

  // The rule that stops a filter from hiding a story it actually matches.
  it("promotes a surviving member when the lead is filtered out", () => {
    const ids = run(corpus, { topics: ["policy"] }, { clusters }).articles.map((a) => a.id);
    expect(ids).toEqual(["member"]);
  });

  it("never returns two members of the same cluster", () => {
    const result = run(corpus, {}, { clusters });
    const clusterIds = result.articles.map((a) => a.clusterId);
    expect(new Set(clusterIds).size).toBe(clusterIds.length);
  });

  it("reports the total as collapsed clusters, not raw articles", () => {
    expect(run(corpus, {}, { clusters }).total).toBe(2);
  });
});

describe("clusterSiblings", () => {
  it("returns the other members in order, excluding the article itself", () => {
    const a = article({ id: "a", title: "A", clusterId: "c1" });
    const b = article({ id: "b", title: "B", clusterId: "c1" });
    const c = article({ id: "c", title: "C", clusterId: "c1" });
    const siblings = clusterSiblings(a, [cluster("c1", ["a", "b", "c"])], [a, b, c]);
    expect(siblings.map((x) => x.id)).toEqual(["b", "c"]);
  });

  it("is empty for a single-member cluster or an unknown one", () => {
    const a = article({ id: "a", title: "A", clusterId: "c1" });
    expect(clusterSiblings(a, [cluster("c1", ["a"])], [a])).toEqual([]);
    expect(clusterSiblings(a, [], [a])).toEqual([]);
  });
});

describe("relatedArticles", () => {
  it("prefers a shared model over a shared topic", () => {
    const subject = article({
      id: "subject",
      title: "Subject",
      models: ["gpt-5-5"],
      topics: ["models"],
    });
    const sameModel = article({
      id: "model",
      title: "Same model",
      models: ["gpt-5-5"],
      topics: ["policy"],
      clusterId: "c-model",
    });
    const sameTopic = article({
      id: "topic",
      title: "Same topic",
      topics: ["models"],
      clusterId: "c-topic",
    });
    const unrelated = article({ id: "none", title: "None", topics: ["funding"], clusterId: "c-none" });

    const related = relatedArticles(subject, [subject, sameModel, sameTopic, unrelated], 4, NOW);
    expect(related.map((a) => a.id)).toEqual(["model", "topic"]);
  });

  it("excludes the article itself and its own cluster", () => {
    const subject = article({ id: "s", title: "S", clusterId: "c1", topics: ["models"] });
    const sibling = article({ id: "sib", title: "Sib", clusterId: "c1", topics: ["models"] });
    expect(relatedArticles(subject, [subject, sibling], 4, NOW)).toEqual([]);
  });
});

describe("trendingFromNews", () => {
  it("ranks model ids by mention count", () => {
    const corpus = [
      article({ id: "1", title: "a", models: ["gpt-5-5", "claude-opus-4-8"] }),
      article({ id: "2", title: "b", models: ["gpt-5-5"] }),
      article({ id: "3", title: "c", models: ["gemini-3-flash"] }),
    ];
    expect(trendingFromNews(corpus, 2)).toEqual(["gpt-5-5", "claude-opus-4-8"]);
  });

  it("is empty when nothing is linked", () => {
    expect(trendingFromNews([article({ id: "1", title: "a" })])).toEqual([]);
  });
});

describe("empty corpus", () => {
  it("returns an empty result rather than throwing", () => {
    const result = selectArticles({
      articles: [],
      clusters: [],
      filters: DEFAULT_FILTERS,
      now: NOW,
    });
    expect(result.articles).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.topicCounts).toEqual({});
  });
});
