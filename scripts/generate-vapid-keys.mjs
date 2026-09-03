#!/usr/bin/env node
//
// Generate the VAPID application-server key pair for Atlas News notifications.
//
//   node scripts/generate-vapid-keys.mjs
//
// Run once, put the output in your environment, and never run it again against a
// deployment that has live subscribers: a browser's push subscription is bound
// to the public key it was created with, so rotating these keys silently
// invalidates every existing subscription. Everyone stops receiving briefs, and
// nothing anywhere reports an error — the push service simply answers 401 to a
// cron job nobody is watching.
//
// Written against `node:crypto` directly, mirroring `lib/push/vapid.ts`, so this
// script has no dependency on the app's build and can be run before `npm
// install` has produced anything.

import { generateKeyPairSync } from "node:crypto";

function base64UrlDecode(input) {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

const pub = publicKey.export({ format: "jwk" });
const priv = privateKey.export({ format: "jwk" });

// The wire format for an application server key is the uncompressed EC point —
// 0x04 followed by X then Y — not the JWK coordinates. A key published in the
// JWK spelling is accepted by `subscribe()` and then fails every signature check.
const publicPoint = Buffer.concat([
  Buffer.of(0x04),
  base64UrlDecode(pub.x),
  base64UrlDecode(pub.y),
]).toString("base64url");

process.stdout.write(`
VAPID keys generated. Add these to your environment (.env.local, or your host's
environment settings) — the private key is a secret and must never be committed
or exposed to the browser.

NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicPoint}
VAPID_PRIVATE_KEY=${priv.d}
VAPID_SUBJECT=mailto:you@example.com

Then set a secret for the digest cron, if you have not already:

NEWS_PUSH_SECRET=${Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url")}

Notes
  • NEXT_PUBLIC_VAPID_PUBLIC_KEY is public by design — the browser has to hand it
    to PushManager.subscribe(), so it ships in the client bundle either way.
  • VAPID_SUBJECT must be a mailto: or https: URL. Push services use it to reach
    you before they start blocking a misbehaving deployment.
  • Apply supabase/migrations/0015_news_push.sql. Without a database the hourly
    digest cron runs in a different invocation than the one that took the
    subscription and will find nothing to send.
  • Rotating these keys invalidates every existing subscription. See above.
`);
