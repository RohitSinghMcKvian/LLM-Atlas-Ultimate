import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { performNewsSync } from "@/lib/news/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** ~37 upstream fetches plus clustering over several hundred articles. */
export const maxDuration = 60;

// Trigger a news sync.
//
// POST is the manual/CI entrypoint; GET exists because Vercel Cron issues GET.
// Both require a bearer secret — unauthenticated, this endpoint would be a free
// amplifier for making the server hammer three dozen upstream feeds.
//
// This is the *privileged* trigger, and it is not what the Refresh button in the
// UI calls. That goes to `/api/v1/news/refresh`, which is public and defends
// itself with a global cooldown instead of a secret. The split is deliberate: a
// scheduler needs to bypass the cooldown, and a browser must never hold a secret.
//
// One of four layered triggers. The other three need no configuration here:
// `lib/news/store.ts` refreshes in the background when a served corpus is older
// than the interval, `vercel.json` declares an hourly cron, and
// `.github/workflows/news-sync.yml` covers deployments that are not on Vercel.

function secrets(): string[] {
  return [
    process.env.NEWS_SYNC_SECRET,
    process.env.CATALOG_SYNC_SECRET,
    process.env.CRON_SECRET,
  ].filter((s): s is string => Boolean(s && s.length >= 8));
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // `timingSafeEqual` throws on a length mismatch, which would itself leak the
  // length. Compare only equal-length buffers.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function isAuthorized(req: NextRequest): boolean {
  const configured = secrets();
  if (configured.length === 0) return false;

  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!presented) return false;

  return configured.some((secret) => constantTimeEquals(presented, secret));
}

async function handle(req: NextRequest): Promise<Response> {
  // 404, not 401: with no secret configured the endpoint should not appear to
  // exist at all.
  if (secrets().length === 0) {
    return new Response("Not found", { status: 404 });
  }
  if (!isAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const record = await performNewsSync();
    const rejected = record.warnings.some((w) => w.includes("keeping the previous corpus"));

    return Response.json({
      ok: !rejected,
      version: record.version,
      syncedAt: record.syncedAt,
      origin: record.origin,
      articles: record.articles.length,
      clusters: record.clusters.length,
      stats: record.stats,
      sources: record.results,
      warnings: record.warnings,
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
