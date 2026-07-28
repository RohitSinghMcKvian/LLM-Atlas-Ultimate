import { describe, expect, it } from "vitest";
import { NEWS_FEEDS, activeFeeds, FEED_TIER_ORDER, type FeedSource } from "./feeds";
import { AI_RELEVANCE_TERMS, NEWS_TOPICS, TOPIC_LEXICON, TOPIC_IDS } from "./topics";
import type { NewsTopic } from "./types";

// The feed registry is the trust root of the whole feature: `verify.ts` decides
// what "verified" means by comparing an article's link against the `domains`
// declared here. A typo in one entry silently downgrades every article from that
// source forever, and nothing at runtime would complain. These tests are the
// only thing standing between a copy-paste and a permanently broken source.

/** Mirrors the suffix rule in `sync/normalize.ts`: subdomains match implicitly. */
function coveredBy(host: string, domains: string[]): boolean {
  const h = host.toLowerCase();
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
}

describe("news feed registry", () => {
  it("has unique ids", () => {
    const seen = new Map<string, FeedSource>();
    for (const feed of NEWS_FEEDS) {
      expect(seen.has(feed.id), `duplicate feed id: ${feed.id}`).toBe(false);
      seen.set(feed.id, feed);
    }
  });

  it("has unique feed URLs", () => {
    const urls = NEWS_FEEDS.map((f) => f.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("uses absolute http(s) URLs for the feed and the homepage", () => {
    for (const feed of NEWS_FEEDS) {
      const url = new URL(feed.url);
      expect(["http:", "https:"], `${feed.id} feed protocol`).toContain(url.protocol);
      const home = new URL(feed.homepage);
      expect(home.protocol, `${feed.id} homepage protocol`).toBe("https:");
    }
  });

  // The one that actually catches mistakes. If a feed is hosted on a domain it
  // does not declare, every article it produces fails `publisher_domain_match`
  // and is capped at `unconfirmed` — the source looks untrustworthy forever, and
  // the only symptom is a badge nobody thinks to question.
  it("declares domains that cover its own feed and homepage hosts", () => {
    for (const feed of NEWS_FEEDS) {
      const feedHost = new URL(feed.url).hostname;
      const homeHost = new URL(feed.homepage).hostname;
      expect(
        coveredBy(feedHost, feed.domains),
        `${feed.id}: feed host ${feedHost} is not covered by ${JSON.stringify(feed.domains)}`,
      ).toBe(true);
      expect(
        coveredBy(homeHost, feed.domains),
        `${feed.id}: homepage host ${homeHost} is not covered by ${JSON.stringify(feed.domains)}`,
      ).toBe(true);
    }
  });

  it("declares bare registrable domains, not hosts or URLs", () => {
    for (const feed of NEWS_FEEDS) {
      expect(feed.domains.length, `${feed.id} has no domains`).toBeGreaterThan(0);
      for (const domain of feed.domains) {
        expect(domain, `${feed.id}: "${domain}"`).toBe(domain.toLowerCase());
        expect(domain, `${feed.id}: "${domain}" looks like a URL`).not.toMatch(/[:/]/);
        expect(domain, `${feed.id}: "${domain}" should not start with www.`).not.toMatch(/^www\./);
        expect(domain, `${feed.id}: "${domain}" needs a dot`).toMatch(/\./);
      }
    }
  });

  it("keeps weights in 0..1, with first-party ranked above press", () => {
    for (const feed of NEWS_FEEDS) {
      expect(feed.weight, `${feed.id} weight`).toBeGreaterThan(0);
      expect(feed.weight, `${feed.id} weight`).toBeLessThanOrEqual(1);
    }

    const lowestFirstParty = Math.min(
      ...NEWS_FEEDS.filter((f) => f.tier === "first_party").map((f) => f.weight),
    );
    const highestPress = Math.max(
      ...NEWS_FEEDS.filter((f) => f.tier === "press" && !f.aggregator).map((f) => f.weight),
    );
    expect(lowestFirstParty).toBeGreaterThan(highestPress);
  });

  it("sets `brand` on first-party channels and only there", () => {
    for (const feed of NEWS_FEEDS) {
      if (feed.tier === "first_party") {
        expect(feed.brand, `${feed.id} is first-party but has no brand`).toBeTruthy();
      } else {
        // `brand` is what makes an item an announcement rather than coverage of
        // one. A press feed carrying it would let coverage reach `verified`.
        expect(feed.brand, `${feed.id} is ${feed.tier} but claims a brand`).toBeUndefined();
      }
    }
  });

  it("only uses topic hints that exist in the taxonomy", () => {
    const valid = new Set<NewsTopic>(TOPIC_IDS);
    for (const feed of NEWS_FEEDS) {
      for (const hint of feed.topicHint ?? []) {
        expect(valid.has(hint), `${feed.id} hints unknown topic ${hint}`).toBe(true);
      }
    }
  });

  it("marks aggregators as low weight and excludes them by default", () => {
    const aggregators = NEWS_FEEDS.filter((f) => f.aggregator);
    expect(aggregators.length).toBeGreaterThan(0);
    for (const feed of aggregators) {
      // Their links are redirect shims, so they can corroborate but never lead.
      expect(feed.weight, `${feed.id} weight`).toBeLessThan(0.5);
    }

    const off = activeFeeds({});
    expect(off.some((f) => f.aggregator)).toBe(false);

    const on = activeFeeds({ ATLAS_NEWS_AGGREGATORS: "true" });
    expect(on.filter((f) => f.aggregator).length).toBe(aggregators.length);
  });

  it("respects the `enabled: false` kill switch", () => {
    const disabled = NEWS_FEEDS.filter((f) => f.enabled === false).map((f) => f.id);
    const active = activeFeeds({}).map((f) => f.id);
    for (const id of disabled) expect(active).not.toContain(id);
  });

  // The sweep runs under a global abort. Tier order is what guarantees that if
  // it fires, we have the announcements rather than only coverage of them.
  it("orders the fetch queue first-party first", () => {
    const order = activeFeeds({}).map((f) => FEED_TIER_ORDER.indexOf(f.tier));
    for (let i = 1; i < order.length; i++) {
      expect(order[i], "feeds are not tier-ordered").toBeGreaterThanOrEqual(order[i - 1]);
    }
  });

  it("covers enough independent domains for corroboration to be possible", () => {
    // `corroborated` requires two DISTINCT registrable domains. A registry that
    // is mostly one publisher's subdomains could never produce that level.
    const domains = new Set(activeFeeds({}).flatMap((f) => f.domains));
    expect(domains.size).toBeGreaterThanOrEqual(25);
  });
});

describe("topic taxonomy", () => {
  it("has a lexicon entry for every topic", () => {
    for (const topic of TOPIC_IDS) {
      expect(TOPIC_LEXICON[topic]?.length, `${topic} has no keywords`).toBeGreaterThan(0);
    }
  });

  it("has display metadata for every topic in the lexicon", () => {
    expect(Object.keys(TOPIC_LEXICON).sort()).toEqual([...TOPIC_IDS].sort());
    for (const def of NEWS_TOPICS) {
      expect(def.label).toBeTruthy();
      expect(def.blurb).toBeTruthy();
    }
  });

  it("uses lowercase terms with sane weights", () => {
    for (const topic of TOPIC_IDS) {
      for (const { term, weight } of TOPIC_LEXICON[topic]) {
        expect(term, `${topic}: "${term}" must be lowercase`).toBe(term.toLowerCase());
        expect(term.trim(), `${topic}: "${term}" is padded`).toBe(term);
        expect(term.length, `${topic}: "${term}" is too short to be selective`).toBeGreaterThan(1);
        expect([1, 2, 3], `${topic}: "${term}" weight ${weight}`).toContain(weight);
      }
    }
  });

  it("has no duplicate terms within a topic", () => {
    for (const topic of TOPIC_IDS) {
      const terms = TOPIC_LEXICON[topic].map((e) => e.term);
      const dupes = terms.filter((x, i) => terms.indexOf(x) !== i);
      expect(dupes, `${topic} repeats ${dupes.join(", ")}`).toEqual([]);
    }
  });

  it("keeps the AI relevance gate lowercase and non-trivial", () => {
    expect(AI_RELEVANCE_TERMS.length).toBeGreaterThan(20);
    for (const term of AI_RELEVANCE_TERMS) {
      expect(term).toBe(term.toLowerCase());
      expect(term.trim()).toBe(term);
    }
    expect(new Set(AI_RELEVANCE_TERMS).size).toBe(AI_RELEVANCE_TERMS.length);
  });
});
