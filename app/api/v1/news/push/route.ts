import { NextRequest } from "next/server";
import { isPushDurable, saveSubscription, subscriptionId, deleteSubscription } from "@/lib/push/store";
import { isValidPushSubscription, normalisePreferences } from "@/lib/push/types";
import { isPushConfigured, readVapidKeys } from "@/lib/push/vapid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Subscription management for the daily AI brief.
//
// PUBLIC BY DESIGN, AND WHY THAT IS SAFE
//
// There is no account behind this. A push subscription IS the credential: the
// endpoint is a bearer URL the browser minted, and only a browser that already
// holds it can present it. So "authentication" here would mean asking someone to
// create an account in order to receive a notification they can already receive,
// and would put a real email address next to a delivery-hour preference that is
// otherwise anonymous. The endpoint is stored hashed, and the only thing this
// route will ever send to it is a news headline.
//
// What that leaves is a write endpoint anyone can post to, so the bounds are:
//   • the payload must be a well-formed subscription (`isValidPushSubscription`)
//   • the row key is derived from the endpoint, so re-posting overwrites rather
//     than accumulates — one device can only ever occupy one row
//   • a same-origin header, so it cannot be driven cross-site
//   • the body is capped before it is parsed
//
// A determined attacker can register endpoints they control and make the server
// send them news headlines on a schedule. That is a strange thing to want, and
// it is bounded by the same hourly dispatcher every real subscriber shares.

/** Largest body accepted. A subscription plus preferences is ~600 bytes. */
const MAX_BODY_BYTES = 4_000;

/**
 * Same-origin guard.
 *
 * A cross-origin `fetch` with `Content-Type: application/json` requires a
 * preflight, and this route answers no CORS headers, so the preflight fails. The
 * explicit header check covers the simple-request shapes that skip preflight.
 */
function sameOrigin(req: NextRequest): boolean {
  return req.headers.get("x-atlas-push") === "1";
}

async function readBody(req: NextRequest): Promise<unknown> {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) throw new Error("Body too large");
  return JSON.parse(raw);
}

/**
 * What the client needs to decide whether to offer the control at all.
 *
 * `publicKey` is not a secret — the browser has to hand it to `subscribe()`, and
 * it is in the client bundle via `NEXT_PUBLIC_VAPID_PUBLIC_KEY` regardless. It is
 * served from here rather than read from the bundle so that the service worker,
 * which has no access to the page's environment, can re-subscribe after a
 * browser-initiated key rotation.
 */
export async function GET(): Promise<Response> {
  const keys = readVapidKeys();

  return Response.json(
    {
      enabled: keys !== null,
      publicKey: keys?.publicKey ?? null,
      // Surfaced honestly: without Supabase the hourly dispatcher runs in a
      // different invocation than the one that took the subscription and will
      // find nothing. The UI says so rather than promising a brief that will
      // never arrive. See the note at the top of `lib/push/store.ts`.
      durable: isPushDurable(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!isPushConfigured()) {
    // 404 rather than 503: with no VAPID keys this capability does not exist on
    // this deployment, and should not appear to.
    return new Response("Not found", { status: 404 });
  }
  if (!sameOrigin(req)) {
    return Response.json({ error: "Missing origin header" }, { status: 400 });
  }

  let body: { subscription?: unknown; preferences?: unknown; previousEndpoint?: unknown };
  try {
    body = (await readBody(req)) as typeof body;
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!isValidPushSubscription(body.subscription)) {
    return Response.json({ error: "Invalid subscription" }, { status: 400 });
  }

  // A browser-rotated endpoint. Dropping the old row here is what stops the
  // table filling with dead endpoints that the dispatcher then spends seven runs
  // failing against before pruning them.
  if (typeof body.previousEndpoint === "string" && body.previousEndpoint.startsWith("https://")) {
    const previous = subscriptionId(body.previousEndpoint);
    if (previous !== subscriptionId(body.subscription.endpoint)) {
      await deleteSubscription(previous).catch(() => {});
    }
  }

  try {
    const record = await saveSubscription(
      body.subscription,
      normalisePreferences(body.preferences),
    );

    return Response.json(
      { ok: true, id: record.id, preferences: record.preferences, durable: isPushDurable() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not save subscription" },
      { status: 500 },
    );
  }
}

/**
 * Update preferences for a subscription that already exists.
 *
 * Takes the whole subscription rather than an id: possession of the endpoint is
 * the only proof of ownership there is, and accepting a bare id would let anyone
 * who guessed one rewrite a stranger's delivery schedule.
 */
export async function PATCH(req: NextRequest): Promise<Response> {
  if (!isPushConfigured()) return new Response("Not found", { status: 404 });
  if (!sameOrigin(req)) {
    return Response.json({ error: "Missing origin header" }, { status: 400 });
  }

  let body: { subscription?: unknown; preferences?: unknown };
  try {
    body = (await readBody(req)) as typeof body;
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!isValidPushSubscription(body.subscription)) {
    return Response.json({ error: "Invalid subscription" }, { status: 400 });
  }

  const record = await saveSubscription(body.subscription, normalisePreferences(body.preferences));
  return Response.json(
    { ok: true, preferences: record.preferences },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Unsubscribe.
 *
 * Idempotent, and deliberately answers 200 for an endpoint that was never
 * registered. The client calls this immediately before `subscription.
 * unsubscribe()`, and a 404 there would surface as an error on a flow the user
 * has already completed successfully from their point of view.
 */
export async function DELETE(req: NextRequest): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ error: "Missing origin header" }, { status: 400 });
  }

  let body: { endpoint?: unknown };
  try {
    body = (await readBody(req)) as typeof body;
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  if (typeof body.endpoint !== "string" || !body.endpoint.startsWith("https://")) {
    return Response.json({ error: "Invalid endpoint" }, { status: 400 });
  }

  await deleteSubscription(subscriptionId(body.endpoint));
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
