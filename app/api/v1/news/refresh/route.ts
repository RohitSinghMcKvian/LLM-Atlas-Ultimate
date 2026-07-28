import { NextRequest } from "next/server";
import { getNewsSnapshot, inflightNewsSync, performNewsSync } from "@/lib/news/store";
import { refreshCooldownMs, takeToken, type TokenBucket } from "@/lib/news/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The Refresh button's endpoint. Public, and therefore the one place in this
// feature with a real abuse surface.
//
// THE PROBLEM, PLAINLY
//
// The read path is public, so a Refresh button that reaches `performNewsSync()`
// is an unauthenticated amplifier: one click makes the server issue ~37 upstream
// requests, and a script can issue thousands of clicks. The secured
// `/api/v1/news/sync` cannot be used here, because a browser must never hold the
// secret.
//
// FOUR DEFENCES, INNERMOST LAST
//
//   1. A kill switch, so an operator can remove the surface entirely.
//   2. A CSRF guard, so the endpoint cannot be triggered cross-origin.
//   3. A per-IP token bucket, which bounds ONE client.
//   4. A global cooldown, which bounds EVERYONE. This is the load-bearing one:
//      however many clients click, upstream sees at most one sweep per window —
//      strictly less traffic than the hourly cron already generates.
//   5. Inflight collapse, so a herd arriving at the cooldown boundary produces
//      exactly one sweep rather than one each.
//
// The UX consequence is good rather than apologetic: inside the cooldown the
// button returns instantly with the real next-eligible time, so the pill can say
// "up to date — next sync in 6m" instead of spinning and lying.

/** Held on `globalThis` for the same reason the snapshot tier is — see `lib/news/store.ts`. */
const BUCKETS_KEY = Symbol.for("atlas.news.refreshBuckets");

type BucketHost = typeof globalThis & { [BUCKETS_KEY]?: Map<string, TokenBucket> };

function buckets(): Map<string, TokenBucket> {
  const host = globalThis as BucketHost;
  if (!host[BUCKETS_KEY]) host[BUCKETS_KEY] = new Map();
  return host[BUCKETS_KEY];
}

/**
 * The client key for rate limiting.
 *
 * The first `x-forwarded-for` hop is the client as seen by the edge. It is
 * spoofable in principle, which is exactly why the *global* cooldown rather than
 * this is what actually bounds upstream load — this only has to make casual
 * hammering inconvenient.
 */
function clientKey(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim().slice(0, 64) || "unknown";
  return req.headers.get("x-real-ip")?.slice(0, 64) ?? "unknown";
}

function disabled(): boolean {
  return (
    process.env.ATLAS_NEWS_PUBLIC_REFRESH === "false" ||
    process.env.ATLAS_NEWS_SYNC_DISABLED === "true"
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  // 1. Kill switch. 404 rather than 403 — a disabled endpoint should not appear
  //    to exist. The client hides the button when the snapshot says so.
  if (disabled()) return new Response("Not found", { status: 404 });

  // 2. CSRF guard. A cross-origin form POST cannot set a custom header without a
  //    preflight, and this route sends no CORS headers, so the preflight fails.
  if (req.headers.get("x-atlas-refresh") !== "1") {
    return Response.json({ error: "Missing refresh header" }, { status: 400 });
  }

  const now = Date.now();
  const snapshot = await getNewsSnapshot();

  // 4. Global cooldown, checked BEFORE the rate limiter spends a token — being
  //    told "already fresh" should never cost the user part of their allowance.
  const cooldown = refreshCooldownMs(snapshot, now);
  if (cooldown > 0) {
    return Response.json(
      {
        status: "fresh",
        syncedAt: snapshot.syncedAt,
        nextEligibleAt: new Date(now + cooldown).toISOString(),
        articles: snapshot.stats.articles,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // 3. Per-IP token bucket.
  const decision = takeToken(buckets(), clientKey(req), now);
  if (!decision.allowed) {
    return Response.json(
      { status: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds },
      {
        status: 429,
        headers: {
          "Retry-After": String(decision.retryAfterSeconds),
          "Cache-Control": "no-store",
        },
      },
    );
  }

  try {
    // 5. Inflight collapse. `performNewsSync` publishes its promise before any
    //    upstream work begins, so a herd at the cooldown boundary shares one sweep.
    const alreadyRunning = Boolean(inflightNewsSync());
    const record = await performNewsSync();

    const rejected = record.warnings.some((w) => w.includes("keeping the previous corpus"));

    return Response.json(
      {
        status: rejected ? "degraded" : "synced",
        joinedInflight: alreadyRunning,
        version: record.version,
        syncedAt: record.syncedAt,
        articles: record.articles.length,
        clusters: record.clusters.length,
        stats: record.stats,
        warnings: record.warnings,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return Response.json(
      { status: "failed", error: err instanceof Error ? err.message : "Refresh failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

/**
 * GET reports whether a refresh would do anything, without doing it.
 *
 * The sync pill polls nothing — it renders from this shape when it needs to know
 * the cooldown after a page has been open a while.
 */
export async function GET(): Promise<Response> {
  if (disabled()) return new Response("Not found", { status: 404 });

  const now = Date.now();
  const snapshot = await getNewsSnapshot();
  const cooldown = refreshCooldownMs(snapshot, now);

  return Response.json(
    {
      status: cooldown > 0 ? "fresh" : "eligible",
      syncedAt: snapshot.syncedAt,
      nextEligibleAt: new Date(now + cooldown).toISOString(),
      running: Boolean(inflightNewsSync()),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
