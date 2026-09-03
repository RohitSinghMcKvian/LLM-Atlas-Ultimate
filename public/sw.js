// Atlas News service worker.
//
// Scope: notifications only. This worker deliberately does NOT cache anything,
// does not intercept `fetch`, and does not attempt to make the app work offline.
// A caching service worker on a Next.js app is a category of bug rather than a
// feature — it serves last week's JavaScript against this week's RSC payload,
// and the failure mode is a white screen that a hard reload does not fix. The
// only reason this file exists is that `PushManager` requires a registered
// worker, so it does exactly that job and nothing else.
//
// Served from /public, so it is a static asset at the site root and its scope
// covers the whole origin.

const FALLBACK_URL = "/news";

// Take over immediately rather than waiting for every tab to close. A worker
// whose only job is showing notifications has no cross-version state to protect,
// and the alternative is a user granting permission and then receiving nothing
// until they close every Atlas tab they have open.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * A push arrived.
 *
 * `showNotification` MUST be called, and must be awaited inside
 * `event.waitUntil`. A push event that resolves without showing anything is a
 * permission violation: Chrome and Firefox both respond by displaying their own
 * "This site has been updated in the background" notification, and repeat
 * offenders have their push permission revoked outright. So every path below —
 * including a completely malformed payload — ends in a notification.
 */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Not JSON. Some push services send an empty body to wake a worker.
    payload = {};
  }

  const title = payload.title || "Atlas News";
  const url = typeof payload.url === "string" ? payload.url : FALLBACK_URL;

  const options = {
    body: payload.body || "New AI stories are in your feed.",
    icon: payload.icon || "/icons/icon-192.png",
    badge: payload.badge || "/icons/badge-72.png",
    // The large hero. Android renders it in the expanded view; desktop Chrome
    // shows it inline. Platforms that do not support it ignore the key, so there
    // is nothing to feature-detect.
    image: payload.image,
    tag: payload.tag || "atlas-news",
    // With a tag set, `renotify` is what makes a genuinely new brief buzz rather
    // than silently replacing the previous one. Without it, the second brief of
    // the day would arrive invisibly.
    renotify: Boolean(payload.tag),
    timestamp: payload.timestamp || Date.now(),
    // Never `requireInteraction`. A news brief that will not go away until it is
    // clicked is how a useful notification becomes an uninstall.
    requireInteraction: false,
    actions: Array.isArray(payload.actions) ? payload.actions.slice(0, 2) : [],
    data: { url, stories: Array.isArray(payload.stories) ? payload.stories : [] },
  };

  event.waitUntil(
    self.registration.showNotification(title, options).catch(() =>
      // Last resort. If the rich notification failed — an unreachable image, an
      // action shape a platform dislikes — show a plain one rather than nothing,
      // because nothing is what costs the permission.
      self.registration.showNotification(title, { body: options.body, data: options.data }),
    ),
  );
});

/**
 * The notification was clicked.
 *
 * Focus an existing Atlas tab rather than opening a new one. Someone who taps a
 * brief four days running should not end up with four tabs, and a focused tab
 * that navigates keeps their session, scroll position and open drawer.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const stories = Array.isArray(data.stories) ? data.stories : [];

  // "All news" goes to the feed; the default click and "Read" both go to the
  // lead story.
  const target =
    event.action === "browse" ? FALLBACK_URL : data.url || stories[0]?.url || FALLBACK_URL;

  event.waitUntil(
    (async () => {
      const url = new URL(target, self.location.origin);
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of clientList) {
        if (new URL(client.url).origin !== url.origin) continue;
        await client.focus();
        // `navigate` is not implemented everywhere, and a focused tab on the
        // wrong page is still better than a new one.
        if ("navigate" in client) {
          await client.navigate(url.href).catch(() => {});
        }
        return;
      }

      await self.clients.openWindow(url.href);
    })(),
  );
});

/**
 * The push subscription was rotated by the browser.
 *
 * Browsers rotate endpoints — on their own schedule, without asking. Until the
 * server hears about the new one it is sending to a dead endpoint, and the user
 * simply stops receiving briefs with no error anywhere.
 *
 * `event.newSubscription` is populated by Chrome; Firefox leaves it undefined
 * and expects the worker to re-subscribe itself, which needs the application
 * server key. It is fetched rather than hardcoded so that rotating VAPID keys
 * does not require redeploying this file to every browser that has cached it.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        let subscription = event.newSubscription;

        if (!subscription) {
          const response = await fetch("/api/v1/news/push");
          const { publicKey } = await response.json();
          if (!publicKey) return;

          subscription = await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          });
        }

        await fetch("/api/v1/news/push", {
          method: "POST",
          // `x-atlas-push` is the route's same-origin guard. Omitting it here
          // makes the re-registration 400, which would leave the browser holding
          // a rotated subscription the server has never seen — the exact silent
          // failure this handler exists to prevent.
          headers: { "Content-Type": "application/json", "x-atlas-push": "1" },
          body: JSON.stringify({
            subscription: subscription.toJSON(),
            // The old endpoint, so the server can drop the row it is now sending
            // into a void instead of leaving a duplicate behind.
            previousEndpoint: event.oldSubscription?.endpoint,
          }),
        });
      } catch {
        // Nothing useful to do from here. The next visit to /news re-registers.
      }
    })(),
  );
});

/**
 * The VAPID public key must reach `subscribe()` as bytes, not as the base64url
 * string it is transported as.
 *
 * Duplicated from `lib/push/client.ts` on purpose: a service worker has no
 * module graph shared with the page, and the alternative is a build step that
 * bundles this file — which would put a caching layer's worth of complexity in
 * front of a twelve-line function.
 */
function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = self.atob(normalised);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}
