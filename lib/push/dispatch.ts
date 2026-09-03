import "server-only";
import {
  composeDigest,
  hasBreakingStory,
  isDueForDigest,
  selectDigestStories,
} from "@/lib/news/digest";
import { getNewsSnapshot } from "@/lib/news/store";
import type { NewsArticle } from "@/lib/news/types";
import { sendPush } from "./send";
import { listSubscriptions, markFailure, markSent, recordPushRun } from "./store";
import type { StoredPushSubscription } from "./types";
import { readVapidKeys } from "./vapid";

// One digest run.
//
// Called hourly by the cron. Most runs send nothing at all and that is the
// design: the cron fires every hour so that every local delivery hour on earth
// is covered, and `isDueForDigest` decides per subscriber whether *this* hour is
// theirs. A single global send time would mean a 3am notification for most of
// the world.
//
// Everything expensive is bounded, because this shares a serverless invocation
// ceiling with the rest of the platform.

export interface DispatchOptions {
  now?: number;
  /** Compose and count, but send nothing. Used by the route's `?dry=1` preview. */
  dryRun?: boolean;
  /** Absolute origin for deep links and images. */
  siteUrl?: string;
  /** Subscribers considered in one run. */
  limit?: number;
  concurrency?: number;
  signal?: AbortSignal;
}

export interface DispatchResult {
  ok: boolean;
  /** Subscribers whose delivery hour is now. */
  candidates: number;
  sent: number;
  failed: number;
  /** Rows deleted because the push service said the subscription is gone. */
  pruned: number;
  /** Subscribers due a brief for whom the corpus had nothing to say. */
  skippedEmpty: number;
  leadArticle?: string;
  error?: string;
}

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function siteOrigin(explicit?: string): string {
  return (
    explicit ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "https://llmatlas.xyz")
  );
}

export async function dispatchDigest(options: DispatchOptions = {}): Promise<DispatchResult> {
  const {
    now = Date.now(),
    dryRun = false,
    limit = envInt("ATLAS_PUSH_BATCH_LIMIT", 2_000),
    concurrency = envInt("ATLAS_PUSH_CONCURRENCY", 12),
    signal,
  } = options;

  const empty: DispatchResult = {
    ok: true,
    candidates: 0,
    sent: 0,
    failed: 0,
    pruned: 0,
    skippedEmpty: 0,
  };

  const keys = readVapidKeys();
  if (!keys) return { ...empty, ok: false, error: "Push is not configured" };

  const snapshot = await getNewsSnapshot();
  if (snapshot.articles.length === 0) {
    // A cold corpus. Sending "here is nothing" is worse than sending nothing.
    return { ...empty, error: "Corpus is empty" };
  }

  const breaking = hasBreakingStory(snapshot.articles, now);
  const subscriptions = await listSubscriptions(limit);

  const due = subscriptions.filter((entry) =>
    isDueForDigest({
      preferences: entry.preferences,
      lastSentAt: entry.lastSentAt,
      now,
      hasBreaking: breaking,
    }),
  );

  const result: DispatchResult = { ...empty, candidates: due.length };
  if (!due.length) return result;

  const origin = siteOrigin(options.siteUrl);
  let cursor = 0;

  const deliver = async (entry: StoredPushSubscription): Promise<void> => {
    const stories = selectDigestStories({
      articles: snapshot.articles,
      preferences: entry.preferences,
      now,
    });

    const payload = composeDigest({
      stories,
      now,
      utcOffsetMinutes: entry.preferences.utcOffsetMinutes,
      siteUrl: origin,
      breaking: entry.preferences.cadence === "breaking",
    });

    if (!payload) {
      // Their topic filter matched nothing with a picture in the last 36 hours.
      // Deliberately NOT marked as sent: the gap gate stays open so they get a
      // brief as soon as there is one, rather than losing the day.
      result.skippedEmpty += 1;
      return;
    }

    result.leadArticle ??= stories[0]?.id;
    if (dryRun) {
      result.sent += 1;
      return;
    }

    const delivery = await sendPush(entry.subscription, payload, keys, {
      urgency: entry.preferences.cadence === "breaking" ? "high" : "normal",
      topic: payload.tag,
      signal,
    });

    switch (delivery.status) {
      case "sent":
        result.sent += 1;
        await markSent(entry.id, new Date(now).toISOString());
        break;
      case "gone":
        // The subscription no longer exists. This is the normal end of life for
        // a row — a cleared browser, an uninstalled app — and is not a failure.
        result.pruned += 1;
        await markFailure(entry.id).catch(() => {});
        break;
      case "rejected":
      case "failed":
      default: {
        result.failed += 1;
        const dropped = await markFailure(entry.id).catch(() => false);
        if (dropped) result.pruned += 1;
        break;
      }
    }
  };

  async function drain(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= due.length) return;
      if (signal?.aborted) return;
      // `deliver` is contracted never to throw; this guards the pool lane so one
      // unexpected error cannot strand the remaining subscribers.
      await deliver(due[index]).catch(() => {
        result.failed += 1;
      });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, due.length) }, drain));

  if (!dryRun) {
    await recordPushRun({
      utcHour: new Date(now).getUTCHours(),
      candidates: result.candidates,
      sent: result.sent,
      failed: result.failed,
      pruned: result.pruned,
      leadArticle: result.leadArticle,
    }).catch(() => {
      // Telemetry must never be the thing that fails a delivery run.
    });
  }

  return result;
}

/**
 * Compose a brief for one subscriber without sending it.
 *
 * Backs the "send me a test" button and the digest route's preview mode, so an
 * operator can see exactly what a notification will say before anyone's phone
 * buzzes.
 */
export async function previewDigest(
  preferences: StoredPushSubscription["preferences"],
  options: { now?: number; siteUrl?: string } = {},
): Promise<{ payload: ReturnType<typeof composeDigest>; stories: NewsArticle[] }> {
  const now = options.now ?? Date.now();
  const snapshot = await getNewsSnapshot();

  const stories = selectDigestStories({ articles: snapshot.articles, preferences, now });

  return {
    stories,
    payload: composeDigest({
      stories,
      now,
      utcOffsetMinutes: preferences.utcOffsetMinutes,
      siteUrl: siteOrigin(options.siteUrl),
    }),
  };
}
