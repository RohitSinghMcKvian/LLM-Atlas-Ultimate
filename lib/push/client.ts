"use client";

import type { PushPreferences } from "./types";

// The browser half of the subscription flow.
//
// Everything here runs in the page, and every function is written to be
// re-entrant and idempotent: a reader who taps "Turn on" twice, or reloads
// mid-flow, or has a subscription from a previous visit that the server has
// since forgotten, must all converge on the same working state rather than on an
// error. The single most common way a push implementation breaks is that the
// browser still holds a subscription the server has never heard of, and nothing
// in the UI can tell.

export type PushSupport =
  | { supported: true }
  | { supported: false; reason: "unsupported" | "insecure" | "ios-needs-install" };

/**
 * Can this browser receive a push at all?
 *
 * The iOS case is the one worth spelling out, because it is invisible otherwise.
 * Safari on iOS supports Web Push only for a site the user has added to their
 * Home Screen — the API objects exist in a normal tab, `requestPermission()`
 * resolves, and `subscribe()` then fails. Detecting it up front is the
 * difference between an instruction and a dead end.
 */
export function detectPushSupport(): PushSupport {
  if (typeof window === "undefined") return { supported: false, reason: "unsupported" };

  // Service workers require a secure context. localhost counts as one.
  if (!window.isSecureContext) return { supported: false, reason: "insecure" };

  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    // On iOS below 16.4 the constructor is genuinely absent, which is the same
    // answer as an unsupported desktop browser.
    return { supported: false, reason: isIos() ? "ios-needs-install" : "unsupported" };
  }

  if (isIos() && !isStandalone()) return { supported: false, reason: "ios-needs-install" };

  return { supported: true };
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as a Mac; the touch-point count is what separates
  // an iPad from a MacBook with a trackpad.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari's own non-standard flag, which is the only one iOS sets.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export interface PushServerConfig {
  enabled: boolean;
  publicKey: string | null;
  /** False when subscriptions are held in process memory and the cron will not see them. */
  durable: boolean;
}

export async function fetchPushConfig(): Promise<PushServerConfig> {
  try {
    const response = await fetch("/api/v1/news/push", { cache: "no-store" });
    if (!response.ok) return { enabled: false, publicKey: null, durable: false };
    return (await response.json()) as PushServerConfig;
  } catch {
    return { enabled: false, publicKey: null, durable: false };
  }
}

/**
 * Register the worker, reusing an existing registration.
 *
 * `register()` is already idempotent for the same script URL — it resolves with
 * the existing registration rather than creating a second one — but waiting for
 * `ready` matters: `pushManager.subscribe()` on a registration that is still
 * installing rejects, and that is a race that only shows up on a first visit.
 */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  return registration;
}

/**
 * The application server key must reach `subscribe()` as bytes.
 *
 * Chrome accepts a base64url string; Firefox and Safari do not, and the failure
 * is an `InvalidCharacterError` from deep inside the browser with no indication
 * of which argument was wrong.
 */
// The return type is pinned to `Uint8Array<ArrayBuffer>` rather than left as a
// bare `Uint8Array`. Since TypeScript 5.7 the typed arrays are generic over
// their backing buffer, and `BufferSource` — which is what `subscribe()` accepts
// — excludes `SharedArrayBuffer`. Allocating the buffer explicitly is what makes
// the narrower type true rather than merely asserted.
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalised);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

/** The reader's current UTC offset, in the sign convention the server stores. */
export function currentUtcOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

export type SubscribeOutcome =
  | { status: "subscribed"; subscription: PushSubscriptionJSON }
  | { status: "denied" }
  | { status: "unsupported"; reason: PushSupport extends { supported: false } ? string : never }
  | { status: "error"; message: string };

export type PushSubscriptionJSON = {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
};

/**
 * Grant permission, subscribe, and register with the server.
 *
 * The order is deliberate and not the obvious one: permission is requested
 * BEFORE the service worker does anything visible, so that a reader who declines
 * has not been made to wait for a registration they will never use. And the
 * server registration happens last, so a subscription is never recorded that the
 * browser did not actually create.
 */
export async function subscribeToPush(
  preferences: Partial<PushPreferences>,
): Promise<SubscribeOutcome> {
  const support = detectPushSupport();
  if (!support.supported) {
    return { status: "unsupported", reason: support.reason } as SubscribeOutcome;
  }

  const config = await fetchPushConfig();
  if (!config.enabled || !config.publicKey) {
    return { status: "error", message: "Notifications are not configured on this deployment." };
  }

  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    // Older Safari only supports the callback form and rejects the promise one.
    return { status: "error", message: "This browser would not show the permission prompt." };
  }

  if (permission !== "granted") return { status: "denied" };

  try {
    const registration = await ensureServiceWorker();

    // Reuse an existing subscription rather than creating a second one. Calling
    // `subscribe()` with a different application server key than the existing
    // subscription throws `InvalidStateError`, which is exactly what happens
    // after VAPID keys are rotated — so the old one is torn down first.
    let subscription = await registration.pushManager.getSubscription();
    const applicationServerKey = urlBase64ToUint8Array(config.publicKey);

    if (subscription && !sameKey(subscription, applicationServerKey)) {
      await subscription.unsubscribe().catch(() => {});
      subscription = null;
    }

    subscription ??= await registration.pushManager.subscribe({
      // Required, and enforced: a worker that receives a push and shows no
      // notification loses the permission. `public/sw.js` always shows one.
      userVisibleOnly: true,
      applicationServerKey,
    });

    const json = subscription.toJSON() as PushSubscriptionJSON;

    const response = await fetch("/api/v1/news/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-atlas-push": "1" },
      body: JSON.stringify({
        subscription: json,
        preferences: { ...preferences, utcOffsetMinutes: currentUtcOffsetMinutes() },
      }),
    });

    if (!response.ok) {
      // The browser now holds a subscription the server does not know about,
      // which is the state that silently produces "I subscribed and nothing ever
      // arrived". Roll it back so the next attempt starts clean.
      await subscription.unsubscribe().catch(() => {});
      return { status: "error", message: "Could not register with Atlas. Try again in a moment." };
    }

    return { status: "subscribed", subscription: json };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Subscription failed",
    };
  }
}

function sameKey(subscription: PushSubscription, key: Uint8Array<ArrayBuffer>): boolean {
  const existing = subscription.options?.applicationServerKey;
  if (!existing) return true; // Nothing to compare against; assume it is fine.
  const bytes = new Uint8Array(existing as ArrayBuffer);
  if (bytes.length !== key.length) return false;
  return bytes.every((byte, index) => byte === key[index]);
}

/** The browser's current subscription, if it holds one. */
export async function currentSubscription(): Promise<PushSubscriptionJSON | null> {
  if (!detectPushSupport().supported) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    return (subscription?.toJSON() as PushSubscriptionJSON) ?? null;
  } catch {
    return null;
  }
}

/**
 * Unsubscribe, server first.
 *
 * If the browser drops its subscription before the server does, the endpoint is
 * gone and there is no way left to identify the row — it lingers until the
 * dispatcher fails against it seven times. Telling the server first costs
 * nothing and leaves no orphan.
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return true;

    await fetch("/api/v1/news/push", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "x-atlas-push": "1" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }).catch(() => {});

    return await subscription.unsubscribe();
  } catch {
    return false;
  }
}

export async function updatePushPreferences(
  preferences: Partial<PushPreferences>,
): Promise<boolean> {
  const subscription = await currentSubscription();
  if (!subscription) return false;

  try {
    const response = await fetch("/api/v1/news/push", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-atlas-push": "1" },
      body: JSON.stringify({
        subscription,
        // Re-sent on every update, so a reader who travels gets their brief in
        // the new timezone without having to know that is a thing they should do.
        preferences: { ...preferences, utcOffsetMinutes: currentUtcOffsetMinutes() },
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export interface PreviewResult {
  ok: boolean;
  message?: string;
  stories?: number;
}

/** Ask the server to send this device a real brief right now. */
export async function sendPreviewPush(
  preferences: Partial<PushPreferences>,
): Promise<PreviewResult> {
  const subscription = await currentSubscription();
  if (!subscription) return { ok: false, message: "Not subscribed on this device." };

  try {
    const response = await fetch("/api/v1/news/push/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-atlas-push": "1" },
      body: JSON.stringify({ subscription, preferences }),
    });

    const body = (await response.json()) as PreviewResult & { error?: string };
    if (response.status === 429) {
      return { ok: false, message: "Too many previews. Try again in a few minutes." };
    }
    return { ok: Boolean(body.ok), message: body.message ?? body.error, stories: body.stories };
  } catch {
    return { ok: false, message: "Could not reach Atlas." };
  }
}
