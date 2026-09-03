import { encryptPayload } from "./crypto";
import type { PushNotificationPayload, PushSubscriptionJson } from "./types";
import { vapidHeaders, type VapidKeys } from "./vapid";

// Posting one sealed message to one push service.
//
// The important design decision here is the taxonomy of failure. A push endpoint
// can fail in three materially different ways and treating them alike is how a
// subscription table fills with corpses or, worse, how a live subscriber gets
// deleted because their phone was in a tunnel:
//
//   gone      — 404/410. The subscription no longer exists. Delete it, now.
//   rejected  — 400/401/403/413. WE are wrong: a bad key, a bad token, an
//               oversized payload. Retrying is pointless and deleting is wrong;
//               this needs an operator, so it is surfaced rather than swallowed.
//   failed    — 429/5xx/timeout. Transient. Count it and try again next run.

export type PushDeliveryStatus = "sent" | "gone" | "rejected" | "failed";

export interface PushDeliveryResult {
  status: PushDeliveryStatus;
  httpStatus?: number;
  error?: string;
  /** Seconds the service asked us to wait, from `Retry-After`. */
  retryAfterSeconds?: number;
}

export interface SendPushOptions {
  /** Seconds the push service should hold an undeliverable message. */
  ttlSeconds?: number;
  /**
   * `high` wakes a sleeping device; `normal` may be batched until it next wakes.
   *
   * A daily brief is genuinely not urgent, and `normal` is the setting that
   * respects a phone's battery. Breaking news raises it.
   */
  urgency?: "very-low" | "low" | "normal" | "high";
  /** Collapse key: a newer message with the same topic replaces an undelivered older one. */
  topic?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Encrypt and deliver one notification.
 *
 * Never throws. Every caller is a loop over subscribers, and one malformed row
 * must not be able to abandon a digest run halfway through.
 */
export async function sendPush(
  subscription: PushSubscriptionJson,
  payload: PushNotificationPayload,
  keys: VapidKeys,
  options: SendPushOptions = {},
): Promise<PushDeliveryResult> {
  const { ttlSeconds = 12 * 3_600, urgency = "normal", topic, timeoutMs = 10_000, signal } = options;

  let body: Buffer;
  try {
    body = encryptPayload(JSON.stringify(payload), subscription.keys).body;
  } catch (err) {
    // A malformed p256dh or auth secret. The row is unusable and will stay
    // unusable, so this is `rejected` rather than `failed` — but not `gone`,
    // because deleting on our own encoding bug would destroy real subscribers.
    return { status: "rejected", error: err instanceof Error ? err.message : "encrypt failed" };
  }

  const headers: Record<string, string> = {
    ...vapidHeaders(subscription.endpoint, keys),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    "Content-Length": String(body.length),
    TTL: String(ttlSeconds),
    Urgency: urgency,
  };
  // `Topic` must be short and base64url-ish per RFC 8030 §5.4; anything else is
  // a 400 from the service.
  if (topic) headers.Topic = topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);

  try {
    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers,
      body: new Uint8Array(body),
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
    });

    // The body is never useful and is sometimes large; releasing it keeps the
    // socket from being held open until GC across a few hundred sends.
    await response.body?.cancel().catch(() => {});

    if (response.ok) return { status: "sent", httpStatus: response.status };

    if (response.status === 404 || response.status === 410) {
      return { status: "gone", httpStatus: response.status };
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      return {
        status: "failed",
        httpStatus: 429,
        retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
      };
    }

    if (response.status >= 400 && response.status < 500) {
      return {
        status: "rejected",
        httpStatus: response.status,
        error: describeRejection(response.status),
      };
    }

    return { status: "failed", httpStatus: response.status };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return {
      status: "failed",
      error: name === "TimeoutError" || name === "AbortError" ? "timed out" : "request failed",
    };
  }
}

/**
 * Turn a status code into something an operator can act on.
 *
 * These four are the entire set of ways a correctly-built request gets refused,
 * and each has exactly one cause worth naming.
 */
function describeRejection(status: number): string {
  switch (status) {
    case 400:
      return "Malformed request — usually a bad VAPID token or content encoding";
    case 401:
    case 403:
      return "VAPID rejected — the subscription was created with a different public key";
    case 413:
      return "Payload too large for this push service";
    default:
      return `Push service refused the request (${status})`;
  }
}
