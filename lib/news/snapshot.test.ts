import { describe, expect, it } from "vitest";
import { BASELINE_NEWS_SNAPSHOT, isColdStart } from "./baseline";
import {
  BUCKET_IDLE_MS,
  REFRESH_BUCKET,
  isStale,
  minRefreshMinutes,
  refreshCooldownMs,
  syncIntervalMinutes,
  takeToken,
  toWireNews,
  type TokenBucket,
} from "./snapshot";
import type { NewsArticle, NewsSnapshot, NewsSnapshotRecord } from "./types";

const NOW = Date.parse("2025-07-16T12:00:00.000Z");
const minutesAgo = (m: number) => ({ syncedAt: new Date(NOW - m * 60_000).toISOString() });

describe("interval configuration", () => {
  it("defaults to hourly sync and a ten minute refresh floor", () => {
    expect(syncIntervalMinutes({})).toBe(60);
    expect(minRefreshMinutes({})).toBe(10);
  });

  it("reads overrides from the environment", () => {
    expect(syncIntervalMinutes({ ATLAS_NEWS_SYNC_INTERVAL_MINUTES: "15" })).toBe(15);
    expect(minRefreshMinutes({ ATLAS_NEWS_MIN_REFRESH_MINUTES: "2" })).toBe(2);
  });

  it("ignores nonsense values rather than disabling the sync", () => {
    // A zero or negative interval would make every request schedule a sweep.
    for (const bad of ["0", "-5", "abc", ""]) {
      expect(syncIntervalMinutes({ ATLAS_NEWS_SYNC_INTERVAL_MINUTES: bad }), bad).toBe(60);
    }
  });
});

describe("isStale", () => {
  it("is false just inside the interval and true just outside it", () => {
    expect(isStale(minutesAgo(59), NOW, {})).toBe(false);
    expect(isStale(minutesAgo(61), NOW, {})).toBe(true);
  });

  it("treats an unparseable timestamp as stale", () => {
    // Better one wasted sweep than a corpus that can never refresh.
    expect(isStale({ syncedAt: "not a date" }, NOW, {})).toBe(true);
    expect(isStale({ syncedAt: "" }, NOW, {})).toBe(true);
  });

  it("treats the never-synced baseline as stale", () => {
    expect(isStale(BASELINE_NEWS_SNAPSHOT, NOW, {})).toBe(true);
  });

  it("respects a configured interval", () => {
    expect(isStale(minutesAgo(20), NOW, { ATLAS_NEWS_SYNC_INTERVAL_MINUTES: "15" })).toBe(true);
    expect(isStale(minutesAgo(20), NOW, { ATLAS_NEWS_SYNC_INTERVAL_MINUTES: "30" })).toBe(false);
  });
});

describe("refreshCooldownMs", () => {
  it("is zero once the floor has passed", () => {
    expect(refreshCooldownMs(minutesAgo(10), NOW, {})).toBe(0);
    expect(refreshCooldownMs(minutesAgo(45), NOW, {})).toBe(0);
  });

  it("counts down within the floor", () => {
    expect(refreshCooldownMs(minutesAgo(4), NOW, {})).toBe(6 * 60_000);
  });

  it("is zero for an unparseable timestamp", () => {
    // A corrupt field must not lock the Refresh button forever.
    expect(refreshCooldownMs({ syncedAt: "nope" }, NOW, {})).toBe(0);
  });

  it("allows an immediate first sweep from the empty baseline", () => {
    expect(refreshCooldownMs(BASELINE_NEWS_SNAPSHOT, NOW, {})).toBe(0);
  });
});

describe("takeToken", () => {
  const key = "203.0.113.7";

  it("allows up to capacity then denies", () => {
    const buckets = new Map<string, TokenBucket>();
    for (let i = 0; i < REFRESH_BUCKET.capacity; i++) {
      expect(takeToken(buckets, key, NOW).allowed, `attempt ${i}`).toBe(true);
    }
    const denied = takeToken(buckets, key, NOW);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("refills continuously rather than in fixed windows", () => {
    // A fixed window lets a client spend the whole allowance at 11:59 and again
    // at 12:00.
    const buckets = new Map<string, TokenBucket>();
    for (let i = 0; i < REFRESH_BUCKET.capacity; i++) takeToken(buckets, key, NOW);
    expect(takeToken(buckets, key, NOW).allowed).toBe(false);

    const quarter = NOW + REFRESH_BUCKET.refillMs / 4;
    expect(takeToken(buckets, key, quarter).allowed).toBe(true);
  });

  it("never exceeds capacity however long the client waits", () => {
    const buckets = new Map<string, TokenBucket>();
    takeToken(buckets, key, NOW);
    const muchLater = NOW + REFRESH_BUCKET.refillMs * 100;
    for (let i = 0; i < REFRESH_BUCKET.capacity; i++) {
      expect(takeToken(buckets, key, muchLater).allowed).toBe(true);
    }
    expect(takeToken(buckets, key, muchLater).allowed).toBe(false);
  });

  it("keeps clients independent", () => {
    const buckets = new Map<string, TokenBucket>();
    for (let i = 0; i < REFRESH_BUCKET.capacity; i++) takeToken(buckets, "a", NOW);
    expect(takeToken(buckets, "a", NOW).allowed).toBe(false);
    expect(takeToken(buckets, "b", NOW).allowed).toBe(true);
  });

  it("evicts idle buckets so the map cannot grow without bound", () => {
    const buckets = new Map<string, TokenBucket>();
    for (let i = 0; i < 50; i++) takeToken(buckets, `ip-${i}`, NOW);
    expect(buckets.size).toBe(50);

    takeToken(buckets, "fresh", NOW + BUCKET_IDLE_MS + 1);
    expect(buckets.size).toBe(1);
  });
});

describe("toWireNews", () => {
  it("drops every server-only field", () => {
    const record: NewsSnapshotRecord = {
      ...BASELINE_NEWS_SNAPSHOT,
      results: { lab: { status: "ok", items: 3, fresh: 3 } },
      validators: { lab: { etag: 'W/"abc"' } },
      firstSeen: { a1: "2025-07-16T00:00:00.000Z" },
      signatures: { a1: ["deadbeef"] },
      retired: ["old1"],
    };

    const wire = toWireNews(record) as unknown as Record<string, unknown>;
    for (const key of ["results", "validators", "firstSeen", "signatures", "retired"]) {
      expect(wire[key], key).toBeUndefined();
    }
    expect(wire.version).toBe(record.version);
    expect(wire.articles).toBe(record.articles);
  });

  describe("limit", () => {
    // The /news page embeds its articles in the document twice (HTML plus the
    // flight payload). An untruncated corpus measured 2.2 MB for 238 articles.
    const article = (id: string, base: number, publishedAt: string) =>
      ({ id, baseScore: base, publishedAt }) as unknown as NewsArticle;

    const corpus = (n: number): NewsSnapshot => ({
      ...BASELINE_NEWS_SNAPSHOT,
      articles: Array.from({ length: n }, (_, i) =>
        article(`a${i}`, i, new Date(Date.UTC(2026, 0, 1)).toISOString()),
      ),
    });

    it("passes the corpus through untouched when it fits", () => {
      const snapshot = corpus(5);
      expect(toWireNews(snapshot, { limit: 10 }).articles).toBe(snapshot.articles);
      expect(toWireNews(snapshot).articles).toBe(snapshot.articles);
    });

    it("keeps the highest-ranked articles, not the first ones", () => {
      const wire = toWireNews(corpus(20), { limit: 3 });
      expect(wire.articles).toHaveLength(3);
      // Equal recency, so `liveScore` orders by `baseScore` — the tail of the
      // input array is what survives.
      expect(wire.articles.map((a) => a.id)).toEqual(["a19", "a18", "a17"]);
    });

    it("never truncates clusters, sources or stats", () => {
      // They describe the whole corpus and are small; a card's "also reported
      // by" would break if its cluster went missing with the tail.
      const snapshot = corpus(50);
      const wire = toWireNews(snapshot, { limit: 2 });
      expect(wire.clusters).toBe(snapshot.clusters);
      expect(wire.sources).toBe(snapshot.sources);
      expect(wire.stats).toBe(snapshot.stats);
    });
  });
});

describe("baseline", () => {
  it("ships no fabricated articles", () => {
    // The feature's premise is that everything on screen traces to a real
    // publisher. Inventing a starter corpus, badged `verified` and linked to
    // real domains, would contradict that in the one place it matters most.
    expect(BASELINE_NEWS_SNAPSHOT.articles).toEqual([]);
    expect(BASELINE_NEWS_SNAPSHOT.clusters).toEqual([]);
    expect(BASELINE_NEWS_SNAPSHOT.origin).toBe("baseline");
  });

  it("still lists the real sources so the filter UI is not an empty shell", () => {
    expect(BASELINE_NEWS_SNAPSHOT.sources.length).toBeGreaterThan(20);
    expect(BASELINE_NEWS_SNAPSHOT.sources.every((s) => s.count === 0)).toBe(true);
    expect(BASELINE_NEWS_SNAPSHOT.sources.every((s) => s.status === "skipped")).toBe(true);
  });

  it("reports a zeroed but well-formed stats block", () => {
    expect(BASELINE_NEWS_SNAPSHOT.stats.articles).toBe(0);
    expect(Object.values(BASELINE_NEWS_SNAPSHOT.stats.byTopic).every((n) => n === 0)).toBe(true);
  });

  it("detects a cold start", () => {
    expect(isColdStart(BASELINE_NEWS_SNAPSHOT)).toBe(true);
    expect(isColdStart({ origin: "synced", articles: [] })).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(isColdStart({ origin: "synced", articles: [{} as any] })).toBe(false);
  });
});
