import type { NewsTopic } from "@/lib/news/types";

// The push subscription model.
//
// Kept free of `server-only` and of any Node import, because the client bundle
// needs these shapes to build a subscribe request and to render the preferences
// panel — the same split `lib/news/types.ts` maintains against `lib/news/store.ts`.

/**
 * What the browser hands back from `PushManager.subscribe()`.
 *
 * The endpoint is a bearer URL: whoever holds it can send this device a
 * notification. It is treated as a credential everywhere below — never logged in
 * full, never returned to a client, and hashed before it is used as an id.
 */
export interface PushSubscriptionJson {
  endpoint: string;
  /** Milliseconds since epoch. Set by Safari and by nobody else; may be null. */
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export type DigestCadence = "daily" | "twice-daily" | "breaking" | "off";

export interface PushPreferences {
  cadence: DigestCadence;
  /**
   * Local hour (0–23) the daily brief should arrive.
   *
   * Stored alongside `utcOffsetMinutes` rather than as a UTC hour, because the
   * two are not interchangeable across a daylight-saving boundary: a UTC hour
   * computed in January delivers an hour late all summer. The dispatcher
   * re-derives the UTC hour on every run from these two fields.
   */
  hour: number;
  /**
   * The subscriber's offset from UTC in minutes, in the sign convention of
   * `-Date.prototype.getTimezoneOffset()` — so UTC+5:30 is `+330`.
   *
   * Deliberately not an IANA zone name. A zone would be more correct across a
   * DST change, but it would also mean shipping a timezone database to resolve
   * it server-side; the browser re-registers its offset on every visit, which
   * corrects the drift within a day for anyone actually using the feature.
   */
  utcOffsetMinutes: number;
  /** Empty means every topic. */
  topics: NewsTopic[];
  /** Only include stories at `verified` or `corroborated`. */
  verifiedOnly: boolean;
  /** Headlines carried in one digest. */
  maxStories: number;
}

export const DEFAULT_PUSH_PREFERENCES: PushPreferences = {
  cadence: "daily",
  // 08:00 local. Early enough to be the morning's news, late enough not to be an
  // alarm clock for anybody who left the phone on the nightstand.
  hour: 8,
  utcOffsetMinutes: 0,
  topics: [],
  verifiedOnly: false,
  maxStories: 5,
};

export interface StoredPushSubscription {
  /** SHA-256 of the endpoint, base64url. The primary key, so the endpoint itself never becomes one. */
  id: string;
  subscription: PushSubscriptionJson;
  preferences: PushPreferences;
  createdAt: string;
  updatedAt: string;
  /** ISO instant of the last digest actually delivered, so a run is idempotent. */
  lastSentAt?: string;
  /**
   * Consecutive delivery failures.
   *
   * A push service answers 404/410 for a subscription that is gone, and those
   * are pruned immediately. This counts the ambiguous ones — 500s, timeouts, a
   * phone that has been off for a fortnight — so a permanently dead endpoint is
   * eventually dropped rather than retried forever on every hourly run.
   */
  failures: number;
}

/** The notification body, as the service worker expects to receive it. */
export interface PushNotificationPayload {
  title: string;
  body: string;
  /** Deep link opened on click. */
  url: string;
  /**
   * Large hero image. This is the whole reason the OpenGraph pass exists: a
   * notification with a picture is read, and one without is dismissed.
   */
  image?: string;
  icon?: string;
  badge?: string;
  /**
   * Collapse key. Two digests with the same tag replace rather than stack, so a
   * phone that was off overnight shows one brief and not six.
   */
  tag?: string;
  /** ISO instant, shown by the platform on the notification itself. */
  timestamp?: number;
  /** Rendered as buttons by Chrome and Edge; ignored elsewhere. */
  actions?: { action: string; title: string }[];
  /** Headlines beyond the first, shown in the expanded view where supported. */
  stories?: { title: string; url: string; source: string }[];
}

export function isValidPushSubscription(value: unknown): value is PushSubscriptionJson {
  if (!value || typeof value !== "object") return false;
  const candidate = value as PushSubscriptionJson;

  if (typeof candidate.endpoint !== "string") return false;
  // https only, and bounded: this string is stored, and later used to build a
  // request from the server's own network position.
  if (!candidate.endpoint.startsWith("https://")) return false;
  if (candidate.endpoint.length > 1_000) return false;

  const keys = candidate.keys;
  if (!keys || typeof keys !== "object") return false;
  if (typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return false;
  // Bounded before any base64 decode, so a hostile client cannot make the server
  // allocate from a length it chose.
  if (keys.p256dh.length > 200 || keys.auth.length > 100) return false;

  return true;
}

const CADENCES: DigestCadence[] = ["daily", "twice-daily", "breaking", "off"];

/**
 * Coerce whatever a client sent into preferences that are safe to store.
 *
 * Never rejects. A preferences object is not a security boundary — the worst a
 * bad one can do is send a notification at the wrong hour — and refusing the
 * whole subscription because `maxStories` arrived as a string would be a
 * dramatically worse outcome than clamping it.
 */
export function normalisePreferences(
  input: unknown,
  fallback: PushPreferences = DEFAULT_PUSH_PREFERENCES,
): PushPreferences {
  const raw = (input ?? {}) as Partial<PushPreferences>;

  const hour = Number(raw.hour);
  const offset = Number(raw.utcOffsetMinutes);
  const maxStories = Number(raw.maxStories);

  return {
    cadence: CADENCES.includes(raw.cadence as DigestCadence)
      ? (raw.cadence as DigestCadence)
      : fallback.cadence,
    hour: Number.isFinite(hour) ? Math.max(0, Math.min(23, Math.floor(hour))) : fallback.hour,
    // ±14:00 is the real-world range of UTC offsets, Kiribati included.
    utcOffsetMinutes: Number.isFinite(offset)
      ? Math.max(-840, Math.min(840, Math.round(offset)))
      : fallback.utcOffsetMinutes,
    topics: Array.isArray(raw.topics)
      ? (raw.topics.filter((t) => typeof t === "string").slice(0, 12) as NewsTopic[])
      : fallback.topics,
    verifiedOnly:
      typeof raw.verifiedOnly === "boolean" ? raw.verifiedOnly : fallback.verifiedOnly,
    maxStories: Number.isFinite(maxStories)
      ? Math.max(1, Math.min(10, Math.floor(maxStories)))
      : fallback.maxStories,
  };
}
