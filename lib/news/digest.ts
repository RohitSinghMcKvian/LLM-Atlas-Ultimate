import { newsImageSrc } from "./image";
import { liveScore } from "./rank";
import type { NewsArticle } from "./types";
import type { PushNotificationPayload, PushPreferences } from "@/lib/push/types";

// What goes in the daily brief, and when it goes out.
//
// Deliberately pure — no database, no clock of its own, no network. Scheduling a
// recurring notification is arithmetic with several ways to be subtly wrong
// (double-sending across a cron boundary, skipping a day because two runs were
// 23h59m apart, delivering at 3am to someone who moved timezone), and every one
// of those is a bug you find in production at 3am unless it is a pure function
// with a test.

/**
 * Cadence floors: the minimum gap between two briefs.
 *
 * Twenty hours for a daily brief, not twenty-four. The dispatcher runs hourly on
 * a cron whose firing time drifts by seconds, so consecutive days are frequently
 * 23h59m apart — a 24-hour floor silently skips a day roughly whenever the cron
 * runs a moment early, which is the kind of bug that looks like "notifications
 * are flaky" for a month before anyone catches it.
 */
const MIN_GAP_MS: Record<PushPreferences["cadence"], number> = {
  daily: 20 * 3_600_000,
  "twice-daily": 8 * 3_600_000,
  breaking: 3 * 3_600_000,
  off: Number.POSITIVE_INFINITY,
};

/**
 * The subscriber's local hour, 0–23.
 *
 * `utcOffsetMinutes` follows `-getTimezoneOffset()`, so UTC+5:30 is +330. The
 * modulo is doubled because a negative offset can push the result below zero and
 * JavaScript's `%` keeps the sign.
 */
export function localHourOf(now: number, utcOffsetMinutes: number): number {
  const shifted = new Date(now + utcOffsetMinutes * 60_000);
  return shifted.getUTCHours();
}

/**
 * The local calendar day, as `YYYY-MM-DD`.
 *
 * Used for the notification's collapse tag, so two briefs on the same day
 * replace each other on the lock screen rather than stacking.
 */
export function localDayOf(now: number, utcOffsetMinutes: number): string {
  return new Date(now + utcOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

export interface DueOptions {
  preferences: PushPreferences;
  lastSentAt?: string;
  now: number;
  /** Whether anything in the corpus is urgent enough to justify a `breaking` send. */
  hasBreaking?: boolean;
}

/**
 * Is this subscriber due for a brief right now?
 *
 * Two independent gates, and both must pass. The hour gate says "this is when
 * they asked for it"; the gap gate says "and we have not already sent one". The
 * gap gate is what makes the hourly cron idempotent — a run that fires twice in
 * the same hour, or a deployment that triggers a catch-up run, cannot double-send.
 */
export function isDueForDigest({
  preferences,
  lastSentAt,
  now,
  hasBreaking = false,
}: DueOptions): boolean {
  if (preferences.cadence === "off") return false;

  const since = lastSentAt ? now - Date.parse(lastSentAt) : Number.POSITIVE_INFINITY;
  // An unparseable timestamp must not mean "send forever": treat it as just sent
  // and let the next run, with a well-formed value, decide.
  if (lastSentAt && !Number.isFinite(since)) return false;
  if (since < MIN_GAP_MS[preferences.cadence]) return false;

  if (preferences.cadence === "breaking") {
    // Not hour-gated at all — the whole point is that it arrives when the news
    // does. The gap floor above is the only thing bounding it.
    return hasBreaking;
  }

  const hour = localHourOf(now, preferences.utcOffsetMinutes);
  if (hour === preferences.hour) return true;

  // The second slot is twelve hours from the first, so someone who asked for
  // 08:00 also gets 20:00.
  return preferences.cadence === "twice-daily" && hour === (preferences.hour + 12) % 24;
}

/**
 * Does the corpus hold something worth interrupting someone for?
 *
 * A high bar on purpose. `breaking` is the cadence most likely to be turned off
 * in annoyance, and the fastest way to get there is to treat every press rewrite
 * as urgent. It must be recent, it must be corroborated or first-party, and it
 * must come from a source that speaks for itself.
 */
export function hasBreakingStory(articles: readonly NewsArticle[], now: number): boolean {
  const cutoff = now - 90 * 60_000;
  return articles.some((article) => {
    if (Date.parse(article.publishedAt) < cutoff) return false;
    if (article.verification.level === "verified") return true;
    return (
      article.verification.level === "corroborated" && article.verification.distinctDomains >= 3
    );
  });
}

export interface SelectDigestOptions {
  articles: readonly NewsArticle[];
  preferences: PushPreferences;
  now: number;
  /** Stories already announced, so a brief never repeats yesterday's lead. */
  exclude?: ReadonlySet<string>;
}

/**
 * Pick the stories for one brief.
 *
 * Three rules beyond the ranking, in order of how much they matter:
 *
 *   1. **An image is mandatory.** A notification without a picture is a line of
 *      grey text that gets swiped away; one with a picture gets opened. This is
 *      the payoff for the OpenGraph pass in `sync/og.ts`, and it is the reason
 *      the brief is worth sending at all.
 *   2. **One story per cluster.** Five headlines about the same launch is not a
 *      brief, it is a malfunction.
 *   3. **Last 36 hours only.** A "daily brief" whose lead is from Tuesday is not
 *      a brief. Thirty-six rather than twenty-four so a Monday-morning reader
 *      still gets the weekend's news.
 */
export function selectDigestStories({
  articles,
  preferences,
  now,
  exclude,
}: SelectDigestOptions): NewsArticle[] {
  const cutoff = now - 36 * 3_600_000;
  const topics = new Set(preferences.topics);

  const eligible = articles.filter((article) => {
    if (!article.image?.url) return false;
    if (exclude?.has(article.id)) return false;
    if (Date.parse(article.publishedAt) < cutoff) return false;
    if (topics.size && !article.topics.some((t) => topics.has(t))) return false;
    if (preferences.verifiedOnly) {
      const level = article.verification.level;
      if (level !== "verified" && level !== "corroborated") return false;
    }
    return true;
  });

  eligible.sort(
    (a, b) => liveScore(b, now) - liveScore(a, now) || (a.id < b.id ? -1 : 1),
  );

  const chosen: NewsArticle[] = [];
  const seenClusters = new Set<string>();
  for (const article of eligible) {
    if (seenClusters.has(article.clusterId)) continue;
    seenClusters.add(article.clusterId);
    chosen.push(article);
    if (chosen.length >= preferences.maxStories) break;
  }

  return chosen;
}

export interface ComposeDigestOptions {
  stories: readonly NewsArticle[];
  now: number;
  utcOffsetMinutes: number;
  /** Absolute origin, so the service worker can resolve the image and the deep link. */
  siteUrl: string;
  /** `breaking` phrases the notification as an alert rather than as a brief. */
  breaking?: boolean;
}

/** Longest a headline may be before it is cut. Beyond this every platform truncates anyway. */
const TITLE_LIMIT = 90;

/**
 * Build the notification.
 *
 * The lead story *is* the notification: its headline is the title and its
 * artwork is the hero. Naming the brief in the title instead ("Your AI brief, 5
 * stories") tells the reader nothing they cannot already see and wastes the one
 * line they will actually read on the lock screen. The count goes in the body,
 * where it belongs.
 */
export function composeDigest({
  stories,
  now,
  utcOffsetMinutes,
  siteUrl,
  breaking = false,
}: ComposeDigestOptions): PushNotificationPayload | null {
  const [lead, ...rest] = stories;
  if (!lead) return null;

  const origin = siteUrl.replace(/\/+$/, "");
  const day = localDayOf(now, utcOffsetMinutes);

  const body = rest.length
    ? `${lead.sourceName} · and ${rest.length} more ${rest.length === 1 ? "story" : "stories"}\n${truncate(rest[0].title, TITLE_LIMIT)}`
    : `${lead.sourceName} · ${truncate(lead.summary, 120)}`;

  return {
    title: breaking ? `Breaking · ${truncate(lead.title, TITLE_LIMIT - 11)}` : truncate(lead.title, TITLE_LIMIT),
    body,
    // Deep link to the story inside Atlas rather than straight to the publisher:
    // the reader arrives with the provenance panel, the cluster, and the rest of
    // the brief, and the outbound link is one tap away.
    url: `${origin}/news?a=${encodeURIComponent(lead.id)}`,
    // Through the proxy, not the publisher's host. Same-origin means the service
    // worker's fetch is covered by the allowlist the corpus already pins, and it
    // arrives with the long cache headers the proxy sets.
    image: lead.image?.url ? `${origin}${newsImageSrc(lead.image.url)}` : undefined,
    icon: `${origin}/icons/icon-192.png`,
    badge: `${origin}/icons/badge-72.png`,
    // Same tag for the whole local day, so a phone that was off overnight shows
    // one brief rather than a stack of them.
    tag: breaking ? `atlas-breaking-${lead.clusterId}` : `atlas-brief-${day}`,
    timestamp: Date.parse(lead.publishedAt) || now,
    actions: [
      { action: "read", title: "Read" },
      { action: "browse", title: "All news" },
    ],
    stories: stories.map((article) => ({
      title: truncate(article.title, TITLE_LIMIT),
      url: `${origin}/news?a=${encodeURIComponent(article.id)}`,
      source: article.sourceName,
    })),
  };
}

/**
 * Cut at a word boundary where one is close enough to the limit.
 *
 * Mid-word truncation ("Anthropic ships Claude Op…") reads as a bug; a slightly
 * shorter cut at a space does not.
 */
function truncate(input: string, limit: number): string {
  const text = input.trim();
  if (text.length <= limit) return text;

  const cut = text.slice(0, limit - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
