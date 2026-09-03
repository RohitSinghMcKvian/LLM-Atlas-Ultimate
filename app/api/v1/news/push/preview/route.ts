import { NextRequest } from "next/server";
import { previewDigest } from "@/lib/push/dispatch";
import { sendPush } from "@/lib/push/send";
import { takeToken, type TokenBucket } from "@/lib/news/snapshot";
import { isValidPushSubscription, normalisePreferences } from "@/lib/push/types";
import { isPushConfigured, readVapidKeys } from "@/lib/push/vapid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Show me what I'll get."
//
// The single most valuable thing in this whole feature's onboarding. Granting
// notification permission is irreversible from the site's side — a reader who
// grants it and then hears nothing for eighteen hours has no way to tell whether
// it worked, whether they got the timezone right, or whether Atlas is broken,
// and the browser will not ask them a second time if they revoke it in
// frustration. One notification, immediately, closes that loop.
//
// It sends a *real* brief — the actual stories the next scheduled one would
// carry — rather than a "Test notification" placeholder. A preview that does not
// resemble the product tells the reader nothing about whether they want it.
//
// This posts to a caller-supplied endpoint, so it is rate limited hard. The
// bucket is shared machinery with the MCP route and the news refresh; see
// `takeToken` in `lib/news/snapshot.ts`.

const BUCKETS_KEY = Symbol.for("atlas.push.previewBuckets");

type BucketHost = typeof globalThis & { [BUCKETS_KEY]?: Map<string, TokenBucket> };

function buckets(): Map<string, TokenBucket> {
  const host = globalThis as BucketHost;
  if (!host[BUCKETS_KEY]) host[BUCKETS_KEY] = new Map();
  return host[BUCKETS_KEY];
}

/** Three previews per fifteen minutes. Enough to retry after fixing a setting, not enough to spam. */
const PREVIEW_BUCKET = { capacity: 3, refillMs: 15 * 60_000 };

function clientKey(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim().slice(0, 64) || "unknown";
  return req.headers.get("x-real-ip")?.slice(0, 64) ?? "unknown";
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!isPushConfigured()) return new Response("Not found", { status: 404 });
  if (req.headers.get("x-atlas-push") !== "1") {
    return Response.json({ error: "Missing origin header" }, { status: 400 });
  }

  const decision = takeToken(buckets(), clientKey(req), Date.now(), PREVIEW_BUCKET);
  if (!decision.allowed) {
    return Response.json(
      { error: "Too many previews", retryAfterSeconds: decision.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } },
    );
  }

  let body: { subscription?: unknown; preferences?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > 4_000) throw new Error("Body too large");
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!isValidPushSubscription(body.subscription)) {
    return Response.json({ error: "Invalid subscription" }, { status: 400 });
  }

  const keys = readVapidKeys();
  if (!keys) return new Response("Not found", { status: 404 });

  const preferences = normalisePreferences(body.preferences);
  const { payload, stories } = await previewDigest(preferences);

  if (!payload) {
    // Not an error. The corpus genuinely has nothing matching their filters, and
    // saying so is far more useful than a notification that says nothing.
    return Response.json(
      {
        ok: false,
        reason: "empty",
        message:
          stories.length === 0
            ? "No stories match those topics in the last 36 hours. Your brief will arrive as soon as one does."
            : "Nothing to preview yet.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const delivery = await sendPush(body.subscription, payload, keys, {
    // A preview the reader is waiting for, so it skips any batching the push
    // service would otherwise apply — the one legitimate use of `high` here.
    urgency: "high",
    // No collapse tag: a preview must never replace, or be replaced by, the real
    // brief sitting on the reader's lock screen.
    ttlSeconds: 300,
  });

  if (delivery.status !== "sent") {
    return Response.json(
      {
        ok: false,
        reason: delivery.status,
        message:
          delivery.status === "gone"
            ? "That subscription is no longer valid. Turning notifications off and on again will fix it."
            : (delivery.error ?? "The push service would not accept the message."),
      },
      { status: delivery.status === "rejected" ? 400 : 502 },
    );
  }

  return Response.json(
    { ok: true, stories: stories.length, title: payload.title },
    { headers: { "Cache-Control": "no-store" } },
  );
}
