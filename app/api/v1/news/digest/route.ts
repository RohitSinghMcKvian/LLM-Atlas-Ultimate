import { NextRequest } from "next/server";
import { dispatchDigest } from "@/lib/push/dispatch";
import { secretEquals } from "@/lib/push/crypto";
import { isPushConfigured } from "@/lib/push/vapid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Up to a few thousand encrypted sends, twelve at a time. */
export const maxDuration = 60;

// The daily brief dispatcher.
//
// WHY THIS RUNS HOURLY WHEN THE BRIEF IS DAILY
//
// Subscribers pick a local hour. Sending every brief at one global time would
// put the news in front of Europe at breakfast and in front of California at
// midnight, so the cron fires every hour and `isDueForDigest` decides which
// subscribers this particular hour belongs to. Most runs send nothing, which is
// the correct and expected outcome.
//
// The run is idempotent: a subscriber's `last_sent_at` and the cadence gap floor
// mean a second invocation in the same hour — a retried cron, a redeploy, an
// operator running it by hand — cannot double-send.
//
// GET exists because Vercel Cron issues GET. Both verbs require the shared
// secret: unauthenticated, this endpoint would let anyone make the server
// dispatch a notification to every subscriber it has.

function secrets(): string[] {
  return [
    process.env.NEWS_PUSH_SECRET,
    process.env.NEWS_SYNC_SECRET,
    process.env.CRON_SECRET,
  ].filter((s): s is string => Boolean(s && s.length >= 8));
}

function isAuthorized(req: NextRequest): boolean {
  const configured = secrets();
  if (configured.length === 0) return false;

  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!presented) return false;

  return configured.some((secret) => secretEquals(presented, secret));
}

async function handle(req: NextRequest): Promise<Response> {
  // 404 rather than 401 in both of the "this deployment does not do that" cases,
  // so neither the absence of VAPID keys nor the absence of a cron secret
  // advertises a surface that is not there.
  if (!isPushConfigured() || secrets().length === 0) {
    return new Response("Not found", { status: 404 });
  }
  if (!isAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // `?dry=1` composes every brief and reports what would go out without sending
  // anything or touching `last_sent_at` — the safe way to check a schedule
  // change against real subscribers.
  const dryRun = new URL(req.url).searchParams.get("dry") === "1";

  try {
    const result = await dispatchDigest({ dryRun });
    return Response.json(
      { ...result, dryRun },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Digest failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
