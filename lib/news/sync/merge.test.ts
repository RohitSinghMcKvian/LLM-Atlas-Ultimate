import { describe, expect, it } from "vitest";
import type { FeedSource } from "../feeds";
import { computeStats, emptyStats, hashArticles, mergeNews } from "./merge";
import { signatureOf } from "./cluster";
import type { FeedFetchOutcome, RawArticle } from "./types";
import type { NewsSnapshotRecord } from "../types";

const NOW = Date.parse("2025-07-16T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const LAB: FeedSource = {
  id: "lab",
  name: "Example Lab",
  url: "https://example-lab.com/rss.xml",
  homepage: "https://example-lab.com/blog",
  tier: "first_party",
  brand: "Example Lab",
  weight: 1,
  domains: ["example-lab.com"],
};

const PRESS: FeedSource = {
  id: "press",
  name: "Example Press",
  url: "https://example-press.com/feed",
  homepage: "https://example-press.com/",
  tier: "press",
  weight: 0.65,
  domains: ["example-press.com"],
};

const FEEDS = [LAB, PRESS];

let seq = 0;
function article(feed: FeedSource, partial: Partial<RawArticle> & { title: string }): RawArticle {
  seq++;
  const id = partial.id ?? `art${seq}`;
  const url = partial.url ?? `https://${feed.domains[0]}/story-${id}`;
  const base: RawArticle = {
    id,
    urlKey: url.replace(/^https?:\/\//, ""),
    title: partial.title,
    summary: partial.summary ?? "A summary of the story that is long enough to be useful.",
    bodyText: partial.bodyText ?? "",
    url,
    domain: partial.domain ?? feed.domains[0],
    host: partial.host ?? partial.domain ?? feed.domains[0],
    sourceId: feed.id,
    sourceName: feed.name,
    tier: feed.tier,
    brand: feed.brand,
    author: partial.author,
    publishedAt: partial.publishedAt ?? hoursAgo(2),
    firstSeenAt: partial.firstSeenAt ?? hoursAgo(2),
    topics: partial.topics ?? ["models"],
    models: partial.models ?? [],
    orgs: partial.orgs ?? [],
    image: partial.image,
    readMinutes: partial.readMinutes,
    domainMatch: partial.domainMatch ?? true,
    signature: [],
    aggregator: false,
    sourceWeight: feed.weight,
  };
  return { ...base, signature: partial.signature ?? signatureOf(base.title, base.models) };
}

function outcome(feed: FeedSource, articles: RawArticle[], overrides: Partial<FeedFetchOutcome> = {}): FeedFetchOutcome {
  return {
    feed,
    result: { status: "ok", items: articles.length, fresh: articles.length },
    articles,
    ...overrides,
  };
}

function failedOutcome(feed: FeedSource, error = "timeout"): FeedFetchOutcome {
  return { feed, result: { status: "failed", items: 0, fresh: 0, error }, articles: [] };
}

const merge = (outcomes: FeedFetchOutcome[], previous?: NewsSnapshotRecord | null) =>
  mergeNews({ outcomes, previous, now: NOW, feeds: FEEDS });

describe("mergeNews — happy path", () => {
  it("builds a record with articles, clusters, stats and sources", () => {
    const { record, ok } = merge([
      outcome(LAB, [article(LAB, { title: "Example Lab introduces Nova 3" })]),
      outcome(PRESS, [article(PRESS, { title: "Something else entirely happened today" })]),
    ]);

    expect(ok).toBe(true);
    expect(record.origin).toBe("synced");
    expect(record.articles.length).toBe(2);
    expect(record.clusters.length).toBe(2);
    expect(record.stats.articles).toBe(2);
    expect(record.sources.length).toBe(FEEDS.length);
  });

  it("marks a first-party announcement verified and press coverage reported", () => {
    const { record } = merge([
      outcome(LAB, [article(LAB, { title: "Example Lab introduces Nova 3" })]),
      outcome(PRESS, [article(PRESS, { title: "Unrelated story about data centre power" })]),
    ]);

    const lab = record.articles.find((a) => a.sourceId === "lab")!;
    const press = record.articles.find((a) => a.sourceId === "press")!;
    expect(lab.verification.level).toBe("verified");
    expect(press.verification.level).toBe("reported");
  });

  it("records image hosts for the proxy allowlist", () => {
    const { record } = merge([
      outcome(LAB, [
        article(LAB, {
          title: "Nova 3 ships",
          image: { url: "https://cdn.example-lab.com/a.jpg", host: "cdn.example-lab.com" },
        }),
      ]),
    ]);
    expect(record.imageHosts).toEqual(["cdn.example-lab.com"]);
  });

  it("stores signatures so a later sync can cluster incrementally", () => {
    const { record } = merge([outcome(LAB, [article(LAB, { title: "Nova 3 ships today" })])]);
    expect(Object.keys(record.signatures).length).toBe(1);
  });
});

describe("mergeNews — sanity gates", () => {
  it("keeps the previous corpus when every source fails", () => {
    const { record: first } = merge([
      outcome(LAB, [article(LAB, { title: "Nova 3 ships today with a longer context window" })]),
    ]);

    const { record, ok } = merge([failedOutcome(LAB), failedOutcome(PRESS)], first);

    expect(ok).toBe(false);
    expect(record.articles.length).toBe(first.articles.length);
    expect(record.warnings.join(" ")).toContain("All 2 sources failed");
    // The run still happened, so staleness must advance — otherwise every
    // request would immediately schedule another doomed sweep.
    expect(record.syncedAt).toBe(new Date(NOW).toISOString());
  });

  it("keeps the previous corpus when the article count collapses", () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      article(LAB, { title: `Distinct headline number ${i} about a model launch` }),
    );
    const { record: first } = merge([outcome(LAB, many)]);
    expect(first.articles.length).toBe(60);

    const { record, ok } = merge(
      [outcome(LAB, [article(LAB, { title: "Only one left" })]), failedOutcome(PRESS)],
      // Simulate the carried corpus being unavailable too, e.g. a parser
      // regression that rejected everything.
      { ...first, articles: first.articles, signatures: first.signatures },
    );

    // The carried-forward articles keep the count healthy, so the gate should
    // NOT fire here — this asserts the gate is not trigger-happy.
    expect(ok).toBe(false); // press failed
    expect(record.articles.length).toBeGreaterThanOrEqual(60);
  });

  it("fires the collapse gate when the corpus genuinely empties", () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      article(LAB, { title: `Distinct headline number ${i} about a model launch` }),
    );
    const { record: first } = merge([outcome(LAB, many)]);

    // Everything ages out of retention at once.
    const later = Date.parse("2026-07-16T12:00:00.000Z");
    const { record, ok } = mergeNews({
      outcomes: [outcome(LAB, [])],
      previous: first,
      now: later,
      feeds: FEEDS,
    });

    expect(ok).toBe(false);
    expect(record.warnings.join(" ")).toContain("keeping the previous corpus");
    expect(record.articles.length).toBe(60);
  });

  it("a failed source removes nothing", () => {
    const { record: first } = merge([
      outcome(LAB, [article(LAB, { title: "Nova 3 ships today with a longer context window" })]),
      outcome(PRESS, [article(PRESS, { title: "A press story about regulation and compute" })]),
    ]);
    expect(first.articles.length).toBe(2);

    const { record } = merge(
      [outcome(LAB, [article(LAB, { title: "Nova 3 ships today with a longer context window" })]), failedOutcome(PRESS)],
      first,
    );

    expect(record.articles.some((a) => a.sourceId === "press")).toBe(true);
    expect(record.warnings.join(" ")).toContain("Example Press");
  });

  it("carries articles forward for a source that answered 304", () => {
    const { record: first } = merge([
      outcome(PRESS, [article(PRESS, { title: "A press story about regulation and compute" })]),
    ]);

    const { record } = merge(
      [{ feed: PRESS, result: { status: "not_modified", items: 0, fresh: 0 }, articles: [] }],
      first,
    );

    expect(record.articles.length).toBe(1);
    expect(record.results.press.status).toBe("not_modified");
  });
});

describe("mergeNews — retention and identity", () => {
  it("prunes articles past the retention window", () => {
    const { record } = mergeNews({
      outcomes: [
        outcome(LAB, [
          article(LAB, { title: "Recent story about a model", publishedAt: hoursAgo(2) }),
          article(LAB, { title: "Ancient story about a model", publishedAt: hoursAgo(24 * 40) }),
        ]),
      ],
      now: NOW,
      feeds: FEEDS,
      retentionDays: 14,
    });

    expect(record.articles.map((a) => a.title)).toEqual(["Recent story about a model"]);
  });

  it("caps the corpus and records what it dropped", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      article(LAB, { title: `Distinct headline number ${i} about a model launch` }),
    );
    const { record } = mergeNews({
      outcomes: [outcome(LAB, many)],
      now: NOW,
      feeds: FEEDS,
      maxArticles: 10,
    });

    expect(record.articles.length).toBe(10);
    expect(record.retired.length).toBe(20);
  });

  it("preserves firstSeenAt across a re-crawl, even when the title changes", () => {
    // "New since your last visit" must not reset because a publisher fixed a typo.
    const original = article(LAB, {
      id: "stable",
      title: "Nova 3 ships",
      publishedAt: hoursAgo(30),
      firstSeenAt: hoursAgo(30),
    });
    const { record: first } = merge([outcome(LAB, [original])]);
    const firstSeen = first.articles[0].firstSeenAt;

    const { record } = merge(
      [outcome(LAB, [{ ...original, title: "Nova 3 ships today", firstSeenAt: hoursAgo(1) }])],
      first,
    );

    expect(record.articles[0].firstSeenAt).toBe(firstSeen);
    expect(record.articles[0].title).toBe("Nova 3 ships today");
  });

  it("prefers the freshly fetched copy of an article", () => {
    const original = article(LAB, { id: "same", title: "Nova 3 ships", summary: "Old summary text here." });
    const { record: first } = merge([outcome(LAB, [original])]);

    const { record } = merge(
      [outcome(LAB, [{ ...original, summary: "Corrected summary text here." }])],
      first,
    );

    expect(record.articles[0].summary).toBe("Corrected summary text here.");
  });

  it("prunes firstSeen bookkeeping down to live articles", () => {
    const { record: first } = merge([
      outcome(LAB, [article(LAB, { id: "gone", title: "Old story", publishedAt: hoursAgo(24 * 40) })]),
    ]);
    const { record } = merge([outcome(LAB, [article(LAB, { title: "Fresh story about models" })])], first);
    expect(Object.keys(record.firstSeen)).toEqual(record.articles.map((a) => a.id));
  });
});

describe("hashArticles", () => {
  it("is identical for identical input", () => {
    const build = () =>
      merge([outcome(LAB, [article(LAB, { id: "fixed", title: "Nova 3 ships today" })])]).record;
    expect(build().version).toBe(build().version);
  });

  // The property that keeps the ETag useful and stops Supabase storing a fresh
  // half-megabyte row every hour when nothing was published.
  it("does not change when only scores or sync time change", () => {
    const articles = [
      {
        id: "a",
        title: "T",
        summary: "",
        url: "https://x.test/a",
        domain: "x.test",
        host: "x.test",
        sourceId: "s",
        sourceName: "S",
        tier: "press" as const,
        publishedAt: "2025-07-16T10:00:00.000Z",
        firstSeenAt: "2025-07-16T10:00:00.000Z",
        topics: [],
        models: [],
        orgs: [],
        baseScore: 50,
        verification: {
          level: "reported" as const,
          score: 40,
          signals: [],
          corroboration: 1,
          distinctDomains: 1,
          firstParty: false,
        },
        clusterId: "c1",
        lead: true,
      },
    ];
    const before = hashArticles(articles);
    const after = hashArticles([{ ...articles[0], baseScore: 91, clusterId: "c2", lead: false }]);
    expect(after).toBe(before);
  });

  it("changes when an article's identity changes", () => {
    const base = {
      id: "a",
      title: "T",
      summary: "",
      url: "https://x.test/a",
      domain: "x.test",
      host: "x.test",
      sourceId: "s",
      sourceName: "S",
      tier: "press" as const,
      publishedAt: "2025-07-16T10:00:00.000Z",
      firstSeenAt: "2025-07-16T10:00:00.000Z",
      topics: [],
      models: [],
      orgs: [],
      baseScore: 50,
      verification: {
        level: "reported" as const,
        score: 40,
        signals: [],
        corroboration: 1,
        distinctDomains: 1,
        firstParty: false,
      },
      clusterId: "c1",
      lead: true,
    };
    expect(hashArticles([{ ...base, title: "Different" }])).not.toBe(hashArticles([base]));
    expect(hashArticles([{ ...base, url: "https://x.test/b" }])).not.toBe(hashArticles([base]));
  });

  it("is order-independent", () => {
    const one = { id: "1", publishedAt: "p", title: "t1", url: "u1" };
    const two = { id: "2", publishedAt: "p", title: "t2", url: "u2" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(hashArticles([one, two] as any)).toBe(hashArticles([two, one] as any));
  });
});

describe("stats", () => {
  it("counts only sources that produced articles as live", () => {
    const { record } = merge([
      outcome(LAB, [article(LAB, { title: "Nova 3 ships today" })]),
      outcome(PRESS, []),
    ]);
    // A headline number that counts dead feeds is a headline number that lies.
    expect(record.stats.sources).toBe(1);
    expect(record.stats.sourcesOk).toBe(2);
  });

  it("counts verified and corroborated together, and last 24h separately", () => {
    const { record } = merge([
      outcome(LAB, [
        article(LAB, { title: "Nova 3 ships today", publishedAt: hoursAgo(2) }),
        article(LAB, { title: "An older lab post about tooling", publishedAt: hoursAgo(72) }),
      ]),
    ]);
    expect(record.stats.verified).toBe(2);
    expect(record.stats.last24h).toBe(1);
    expect(record.stats.firstParty).toBe(2);
  });

  it("has a zeroed topic map when empty", () => {
    const stats = emptyStats();
    expect(stats.articles).toBe(0);
    expect(Object.values(stats.byTopic).every((v) => v === 0)).toBe(true);
  });

  it("counts each topic occurrence", () => {
    const { record } = merge([
      outcome(LAB, [article(LAB, { title: "Nova 3 ships", topics: ["models", "pricing"] })]),
    ]);
    expect(record.stats.byTopic.models).toBe(1);
    expect(record.stats.byTopic.pricing).toBe(1);
    expect(record.stats.byTopic.safety).toBe(0);
  });

  it("computeStats is a pure function of its inputs", () => {
    expect(computeStats([], [], [], NOW).articles).toBe(0);
  });
});

describe("mergeNews — cold start", () => {
  it("produces an empty baseline record when nothing was fetched and nothing was stored", () => {
    const { record, ok } = mergeNews({
      outcomes: [failedOutcome(LAB), failedOutcome(PRESS)],
      previous: null,
      now: NOW,
      feeds: FEEDS,
    });
    expect(ok).toBe(false);
    expect(record.origin).toBe("baseline");
    expect(record.articles).toEqual([]);
    // The source list is still real, so the filter UI has something to show.
    expect(record.sources.length).toBe(FEEDS.length);
  });

  it("handles a run with no outcomes at all", () => {
    const { record } = mergeNews({ outcomes: [], previous: null, now: NOW, feeds: FEEDS });
    expect(record.articles).toEqual([]);
  });
});
