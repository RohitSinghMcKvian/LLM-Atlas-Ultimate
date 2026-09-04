import { describe, expect, it } from "vitest";
import {
  composeDigest,
  hasBreakingStory,
  isDueForDigest,
  localDayOf,
  localHourOf,
  maxPerSource,
  selectDigestStories,
} from "./digest";
import type { NewsArticle } from "./types";
import { DEFAULT_PUSH_PREFERENCES, type PushPreferences } from "@/lib/push/types";

// Scheduling a recurring notification is arithmetic with several ways to be
// quietly wrong, and every one of them is a bug you discover from a support
// message rather than from a stack trace: a brief that arrives twice, one that
// skips a day, one that lands at 3am for anyone east of London.

const NOW = Date.parse("2026-03-12T08:30:00.000Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

let seq = 0;
function article(patch: Partial<NewsArticle> & { title: string }): NewsArticle {
  seq += 1;
  const id = patch.id ?? `d${seq}`;
  return {
    id,
    title: patch.title,
    summary: patch.summary ?? "A reasonably long summary sentence about the story in question.",
    url: patch.url ?? `https://press.test/${id}`,
    domain: "press.test",
    host: "press.test",
    sourceId: patch.sourceId ?? "press",
    sourceName: patch.sourceName ?? "Example Press",
    tier: patch.tier ?? "press",
    publishedAt: patch.publishedAt ?? hoursAgo(2),
    firstSeenAt: patch.firstSeenAt ?? hoursAgo(2),
    topics: patch.topics ?? ["models"],
    models: [],
    orgs: [],
    // Present by default: the digest requires one, so an article without an
    // image has to be the deliberate exception in a test, never the default.
    image: "image" in patch ? patch.image : { url: `https://cdn.test/${id}.jpg`, host: "cdn.test" },
    baseScore: patch.baseScore ?? 50,
    verification: patch.verification ?? {
      level: "reported",
      score: 40,
      signals: [],
      corroboration: 1,
      distinctDomains: 1,
      firstParty: false,
    },
    clusterId: patch.clusterId ?? `c${seq}`,
    lead: true,
  };
}

const prefs = (patch: Partial<PushPreferences> = {}): PushPreferences => ({
  ...DEFAULT_PUSH_PREFERENCES,
  ...patch,
});

describe("localHourOf", () => {
  it("is the UTC hour at zero offset", () => {
    expect(localHourOf(NOW, 0)).toBe(8);
  });

  it("handles a half-hour offset", () => {
    // India, UTC+5:30. 08:30Z is 14:00 local.
    expect(localHourOf(NOW, 330)).toBe(14);
  });

  it("handles a negative offset that wraps past midnight", () => {
    // 08:30Z at UTC-10 is 22:30 the previous day.
    expect(localHourOf(NOW, -600)).toBe(22);
  });

  it("handles the extreme offsets that actually exist", () => {
    expect(localHourOf(NOW, 840)).toBe(22); // UTC+14, Kiribati
    expect(localHourOf(NOW, -720)).toBe(20); // UTC-12
  });
});

describe("localDayOf", () => {
  it("rolls over at local midnight, not UTC midnight", () => {
    const nearMidnight = Date.parse("2026-03-12T23:30:00.000Z");
    expect(localDayOf(nearMidnight, 0)).toBe("2026-03-12");
    // UTC+1 is already into the 13th.
    expect(localDayOf(nearMidnight, 60)).toBe("2026-03-13");
  });
});

describe("isDueForDigest", () => {
  it("sends at the subscriber's chosen local hour", () => {
    expect(isDueForDigest({ preferences: prefs({ hour: 8 }), now: NOW })).toBe(true);
  });

  it("does not send at any other hour", () => {
    expect(isDueForDigest({ preferences: prefs({ hour: 9 }), now: NOW })).toBe(false);
  });

  it("respects the timezone rather than the server's clock", () => {
    // Someone in India who asked for 08:00 must get it at 02:30Z, not 08:30Z.
    const india = prefs({ hour: 8, utcOffsetMinutes: 330 });
    expect(isDueForDigest({ preferences: india, now: NOW })).toBe(false);
    expect(
      isDueForDigest({ preferences: india, now: Date.parse("2026-03-12T02:30:00.000Z") }),
    ).toBe(true);
  });

  it("never sends when the cadence is off", () => {
    expect(isDueForDigest({ preferences: prefs({ cadence: "off", hour: 8 }), now: NOW })).toBe(
      false,
    );
  });

  describe("idempotence across an hourly cron", () => {
    it("does not send twice in the same hour", () => {
      // The dispatcher runs hourly; a retried or duplicated invocation must not
      // put two identical briefs on someone's lock screen.
      expect(
        isDueForDigest({
          preferences: prefs({ hour: 8 }),
          lastSentAt: new Date(NOW - 60_000).toISOString(),
          now: NOW,
        }),
      ).toBe(false);
    });

    it("still sends the next day when consecutive runs are a few seconds short of 24h", () => {
      // The bug a 24-hour floor would cause: cron firing times drift by seconds,
      // so yesterday's brief is routinely 23h59m ago and the day gets skipped.
      expect(
        isDueForDigest({
          preferences: prefs({ hour: 8 }),
          lastSentAt: new Date(NOW - (24 * 3_600_000 - 45_000)).toISOString(),
          now: NOW,
        }),
      ).toBe(true);
    });

    it("treats an unparseable last-sent as just-sent rather than as never-sent", () => {
      // The failure had to pick a direction. Sending nothing until the next run
      // writes a good timestamp is recoverable; sending on every run forever is
      // how someone ends up with two hundred notifications.
      expect(
        isDueForDigest({ preferences: prefs({ hour: 8 }), lastSentAt: "not a date", now: NOW }),
      ).toBe(false);
    });
  });

  describe("twice-daily", () => {
    const twice = prefs({ cadence: "twice-daily", hour: 8 });

    it("sends at the chosen hour and again twelve hours later", () => {
      expect(isDueForDigest({ preferences: twice, now: NOW })).toBe(true);
      expect(
        isDueForDigest({ preferences: twice, now: Date.parse("2026-03-12T20:15:00.000Z") }),
      ).toBe(true);
    });

    it("does not send in between", () => {
      expect(
        isDueForDigest({ preferences: twice, now: Date.parse("2026-03-12T14:00:00.000Z") }),
      ).toBe(false);
    });

    it("wraps the second slot past midnight", () => {
      const evening = prefs({ cadence: "twice-daily", hour: 20 });
      // 20:00 + 12h is 08:00 the next day.
      expect(isDueForDigest({ preferences: evening, now: NOW })).toBe(true);
    });
  });

  describe("breaking", () => {
    const breaking = prefs({ cadence: "breaking", hour: 8 });

    it("ignores the hour entirely", () => {
      expect(
        isDueForDigest({
          preferences: breaking,
          now: Date.parse("2026-03-12T03:00:00.000Z"),
          hasBreaking: true,
        }),
      ).toBe(true);
    });

    it("sends nothing when there is no breaking story", () => {
      expect(isDueForDigest({ preferences: breaking, now: NOW, hasBreaking: false })).toBe(false);
    });

    it("still honours a three-hour floor between alerts", () => {
      expect(
        isDueForDigest({
          preferences: breaking,
          lastSentAt: new Date(NOW - 2 * 3_600_000).toISOString(),
          now: NOW,
          hasBreaking: true,
        }),
      ).toBe(false);
    });
  });
});

describe("hasBreakingStory", () => {
  it("accepts a recent first-party verified announcement", () => {
    const verified = article({
      title: "Lab ships a model",
      publishedAt: hoursAgo(0.5),
      verification: {
        level: "verified",
        score: 90,
        signals: [],
        corroboration: 1,
        distinctDomains: 1,
        firstParty: true,
      },
    });
    expect(hasBreakingStory([verified], NOW)).toBe(true);
  });

  it("accepts a story three independent publishers agree on", () => {
    const corroborated = article({
      title: "Widely reported",
      publishedAt: hoursAgo(0.5),
      verification: {
        level: "corroborated",
        score: 70,
        signals: [],
        corroboration: 4,
        distinctDomains: 3,
        firstParty: false,
      },
    });
    expect(hasBreakingStory([corroborated], NOW)).toBe(true);
  });

  it("rejects an ordinary reported story, however recent", () => {
    // The bar has to be high. `breaking` is the cadence people turn off in
    // annoyance, and treating every press rewrite as urgent is how they get there.
    expect(hasBreakingStory([article({ title: "A blog post", publishedAt: hoursAgo(0.1) })], NOW)).toBe(
      false,
    );
  });

  it("rejects a verified story that is no longer new", () => {
    const old = article({
      title: "Yesterday's news",
      publishedAt: hoursAgo(6),
      verification: {
        level: "verified",
        score: 90,
        signals: [],
        corroboration: 1,
        distinctDomains: 1,
        firstParty: true,
      },
    });
    expect(hasBreakingStory([old], NOW)).toBe(false);
  });
});

describe("selectDigestStories", () => {
  it("requires an image on every story", () => {
    // The whole reason the OpenGraph pass exists. A notification without a
    // picture is a line of grey text that gets swiped away.
    const stories = selectDigestStories({
      articles: [
        article({ title: "No picture", image: undefined, baseScore: 99 }),
        article({ title: "Has picture", baseScore: 10 }),
      ],
      preferences: prefs(),
      now: NOW,
    });

    expect(stories.map((s) => s.title)).toEqual(["Has picture"]);
  });

  it("takes one story per cluster", () => {
    const stories = selectDigestStories({
      articles: [
        article({ title: "Launch, as told by A", clusterId: "same", baseScore: 90 }),
        article({ title: "Launch, as told by B", clusterId: "same", baseScore: 80 }),
        article({ title: "Something else", clusterId: "other", baseScore: 70 }),
      ],
      preferences: prefs(),
      now: NOW,
    });

    expect(stories.map((s) => s.title)).toEqual(["Launch, as told by A", "Something else"]);
  });

  it("excludes anything older than 36 hours", () => {
    const stories = selectDigestStories({
      articles: [
        article({ title: "Fresh", publishedAt: hoursAgo(30) }),
        article({ title: "Stale", publishedAt: hoursAgo(40), baseScore: 99 }),
      ],
      preferences: prefs(),
      now: NOW,
    });

    expect(stories.map((s) => s.title)).toEqual(["Fresh"]);
  });

  it("honours the topic filter", () => {
    const stories = selectDigestStories({
      articles: [
        article({ title: "About agents", topics: ["agents"] }),
        article({ title: "About pricing", topics: ["pricing"], baseScore: 99 }),
      ],
      preferences: prefs({ topics: ["agents"] }),
      now: NOW,
    });

    expect(stories.map((s) => s.title)).toEqual(["About agents"]);
  });

  it("honours verifiedOnly", () => {
    const stories = selectDigestStories({
      articles: [
        article({ title: "Merely reported", baseScore: 99 }),
        article({
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
      ],
      preferences: prefs({ verifiedOnly: true }),
      now: NOW,
    });

    expect(stories.map((s) => s.title)).toEqual(["Corroborated"]);
  });

  it("caps at maxStories", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      article({ title: `Story ${i}`, clusterId: `c-${i}` }),
    );
    expect(selectDigestStories({ articles: many, preferences: prefs({ maxStories: 3 }), now: NOW })).toHaveLength(3);
  });

  it("skips stories already announced", () => {
    const yesterday = article({ title: "Old lead", baseScore: 99 });
    const stories = selectDigestStories({
      articles: [yesterday, article({ title: "New lead" })],
      preferences: prefs(),
      now: NOW,
      exclude: new Set([yesterday.id]),
    });

    expect(stories.map((s) => s.title)).toEqual(["New lead"]);
  });

  it("returns nothing rather than something bad", () => {
    expect(
      selectDigestStories({
        articles: [article({ title: "No picture", image: undefined })],
        preferences: prefs(),
        now: NOW,
      }),
    ).toEqual([]);
  });
});

describe("composeDigest", () => {
  const base = { now: NOW, utcOffsetMinutes: 0, siteUrl: "https://llmatlas.xyz" };

  it("returns null when there is nothing to say", () => {
    // The dispatcher relies on this to skip a subscriber without marking them
    // sent, so they get a brief as soon as there is one.
    expect(composeDigest({ ...base, stories: [] })).toBeNull();
  });

  it("leads with the story, not with the word 'brief'", () => {
    const lead = article({ title: "Anthropic ships a new model" });
    const payload = composeDigest({ ...base, stories: [lead, article({ title: "Second" })] });

    expect(payload?.title).toBe("Anthropic ships a new model");
    expect(payload?.body).toContain("and 1 more story");
  });

  it("pluralises the remainder correctly", () => {
    const stories = [article({ title: "Lead" }), article({ title: "A" }), article({ title: "B" })];
    expect(composeDigest({ ...base, stories })?.body).toContain("and 2 more stories");
  });

  it("routes the image through the proxy on our own origin", () => {
    // Not the publisher's host: same-origin means the service worker's fetch is
    // covered by the allowlist the corpus already pins.
    const payload = composeDigest({ ...base, stories: [article({ title: "Lead" })] });
    expect(payload?.image).toMatch(/^https:\/\/llmatlas\.xyz\/api\/v1\/news\/image\?u=/);
  });

  it("deep links into Atlas rather than straight to the publisher", () => {
    const lead = article({ title: "Lead" });
    const payload = composeDigest({ ...base, stories: [lead] });
    expect(payload?.url).toBe(`https://llmatlas.xyz/news?a=${lead.id}`);
  });

  it("tags by local day so a day's briefs collapse into one", () => {
    const payload = composeDigest({ ...base, stories: [article({ title: "Lead" })] });
    expect(payload?.tag).toBe("atlas-brief-2026-03-12");
  });

  it("tags a breaking alert by cluster so it never collapses onto the daily brief", () => {
    const lead = article({ title: "Lead", clusterId: "cluster-9" });
    const payload = composeDigest({ ...base, stories: [lead], breaking: true });

    expect(payload?.tag).toBe("atlas-breaking-cluster-9");
    expect(payload?.title).toMatch(/^Breaking · /);
  });

  it("truncates a long headline at a word boundary", () => {
    const title =
      "A quite extraordinarily long headline about a model release that simply keeps going well past any sensible limit";
    const payload = composeDigest({ ...base, stories: [article({ title })] });

    expect(payload!.title.length).toBeLessThanOrEqual(90);
    expect(payload!.title).toMatch(/…$/);

    // The kept text must be a whole-word prefix of the original: the character
    // immediately after it in the source is a space, which is what proves the
    // cut landed on a boundary rather than through the middle of "well".
    const kept = payload!.title.slice(0, -1);
    expect(title.startsWith(kept)).toBe(true);
    expect(title[kept.length]).toBe(" ");
  });

  it("cuts mid-word rather than dropping half a headline", () => {
    // The word-boundary search only wins when a space is reasonably close to the
    // limit. One very long token must still be cut, not shrunk to nothing.
    const title = `Model ${"x".repeat(200)}`;
    const payload = composeDigest({ ...base, stories: [article({ title })] });

    expect(payload!.title.length).toBeLessThanOrEqual(90);
    expect(payload!.title.length).toBeGreaterThan(60);
  });

  it("tolerates a trailing slash on the site URL", () => {
    const payload = composeDigest({
      ...base,
      siteUrl: "https://llmatlas.xyz/",
      stories: [article({ title: "Lead" })],
    });
    expect(payload?.url).not.toContain("//news");
  });

  it("carries every story for the expanded view", () => {
    const stories = [article({ title: "Lead" }), article({ title: "Second" })];
    const payload = composeDigest({ ...base, stories });

    expect(payload?.stories).toHaveLength(2);
    expect(payload?.stories?.[1]).toMatchObject({ title: "Second", source: "Example Press" });
  });

  it("stays inside the smallest push service payload limit", () => {
    // 4 KB is the lowest common denominator across Chrome, Firefox and Safari,
    // and a payload over it is rejected outright rather than truncated.
    const stories = Array.from({ length: 10 }, (_, i) =>
      article({
        title: `A fairly long and realistic headline about an AI development, number ${i}`,
        clusterId: `c${i}`,
      }),
    );
    const payload = composeDigest({ ...base, stories });
    expect(Buffer.byteLength(JSON.stringify(payload), "utf8")).toBeLessThan(3_800);
  });
});

// --- Publisher diversity -----------------------------------------------------
//
// Found by composing a brief from the live corpus: all five stories came back
// from Google Developers, which had published a batch that morning. Every one
// was a genuinely distinct cluster, so the one-per-cluster rule saw nothing
// wrong — a brief can be perfectly de-duplicated and still be a single
// publisher's newsletter.

describe("selectDigestStories — publisher diversity", () => {
  const preferences: PushPreferences = { ...DEFAULT_PUSH_PREFERENCES, maxStories: 5 };

  it("does not let one publisher's batch sweep the brief", () => {
    const articles = [
      // Six posts from one source, ranked above everything else, each its own
      // cluster — exactly the shape that produced the all-Google brief.
      ...Array.from({ length: 6 }, (_, i) =>
        article({ title: `Google post ${i}`, sourceId: "google-dev", sourceName: "Google Developers", baseScore: 95 }),
      ),
      article({ title: "Anthropic ships something", sourceId: "anthropic", sourceName: "Anthropic", baseScore: 60 }),
      article({ title: "Meta ships something", sourceId: "meta", sourceName: "Meta AI", baseScore: 55 }),
      article({ title: "A wire report", sourceId: "wired", sourceName: "WIRED AI", baseScore: 50 }),
    ];

    const chosen = selectDigestStories({ articles, preferences, now: NOW });

    expect(chosen).toHaveLength(5);
    const fromGoogle = chosen.filter((a) => a.sourceId === "google-dev");
    expect(fromGoogle).toHaveLength(maxPerSource(5));
    expect(new Set(chosen.map((a) => a.sourceId)).size).toBeGreaterThan(1);
  });

  it("still leads with the best story, cap or no cap", () => {
    // Diversity must not cost the reader the lead. The top-ranked story is the
    // notification's title; demoting it to make room for variety would trade the
    // one line anyone reads for a rule nobody asked for.
    const articles = [
      article({ title: "The lead", sourceId: "google-dev", sourceName: "Google Developers", baseScore: 99 }),
      article({ title: "Second from the same source", sourceId: "google-dev", sourceName: "Google Developers", baseScore: 98 }),
      article({ title: "Third from the same source", sourceId: "google-dev", sourceName: "Google Developers", baseScore: 97 }),
      article({ title: "Elsewhere", sourceId: "wired", sourceName: "WIRED AI", baseScore: 10 }),
    ];

    const chosen = selectDigestStories({ articles, preferences, now: NOW });
    expect(chosen[0].title).toBe("The lead");
  });

  it("relaxes the cap rather than sending a shorter brief", () => {
    // A quiet day with one publisher is still worth five stories. A diversity
    // rule that shortens the brief is the rule harming what it exists to improve.
    const articles = Array.from({ length: 7 }, (_, i) =>
      article({ title: `Only source, post ${i}`, sourceId: "solo", sourceName: "Solo Press" }),
    );

    const chosen = selectDigestStories({ articles, preferences, now: NOW });
    expect(chosen).toHaveLength(5);
  });

  it("keeps the relaxed fill in rank order", () => {
    const articles = [
      article({ title: "Best", sourceId: "solo", sourceName: "Solo", baseScore: 99 }),
      article({ title: "Second", sourceId: "solo", sourceName: "Solo", baseScore: 90 }),
      article({ title: "Third", sourceId: "solo", sourceName: "Solo", baseScore: 80 }),
      article({ title: "Fourth", sourceId: "solo", sourceName: "Solo", baseScore: 70 }),
    ];

    const chosen = selectDigestStories({ articles, preferences, now: NOW });
    expect(chosen.map((a) => a.title)).toEqual(["Best", "Second", "Third", "Fourth"]);
  });

  it("never returns the same story twice across both passes", () => {
    // The second pass walks the same list again, so the cluster guard is what
    // stops a capped-out story being re-admitted as filler.
    const articles = [
      ...Array.from({ length: 4 }, (_, i) =>
        article({ title: `Batch ${i}`, sourceId: "solo", sourceName: "Solo", baseScore: 90 - i }),
      ),
      article({ title: "Other", sourceId: "wired", sourceName: "WIRED AI", baseScore: 10 }),
    ];

    const chosen = selectDigestStories({ articles, preferences, now: NOW });
    expect(new Set(chosen.map((a) => a.id)).size).toBe(chosen.length);
  });
});

describe("maxPerSource", () => {
  it("gives a five-story brief room for two from one masthead", () => {
    expect(maxPerSource(5)).toBe(2);
  });

  it("allows only one apiece in a three-story brief", () => {
    // Three stories has no room to spend two on the same publisher.
    expect(maxPerSource(3)).toBe(1);
  });

  it("never returns zero", () => {
    expect(maxPerSource(1)).toBe(1);
    expect(maxPerSource(0)).toBe(1);
  });
});
