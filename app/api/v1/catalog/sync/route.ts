import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { performSync } from "@/lib/catalog/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Two upstream fetches plus a merge over ~400 models. */
export const maxDuration = 60;

// Trigger a catalog sync.
//
// POST is the manual/CI entrypoint; GET exists because Vercel Cron issues GET.
// Both require a bearer secret — unauthenticated, this endpoint would be a free
// amplifier for making the server hammer two upstream APIs, and the repo has no
// other authenticated route to borrow a convention from.
//
// This is one of three layered triggers. The other two need no configuration:
// `lib/catalog/store.ts` refreshes in the background when a served snapshot is
// older than the interval, and a CDN keeps serving the previous copy meanwhile.

function secrets(): string[] {
  return [process.env.CATALOG_SYNC_SECRET, process.env.CRON_SECRET].filter(
    (s): s is string => Boolean(s && s.length >= 8),
  );
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // `timingSafeEqual` throws on a length mismatch, which would itself leak the
  // length. Compare against a fixed-size digest-shaped buffer instead.
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
    const record = await performSync();
    const rejected = record.warnings.some((w) => w.includes("keeping the previous catalog"));

    return Response.json({
      ok: !rejected,
      version: record.version,
      syncedAt: record.syncedAt,
      origin: record.origin,
      models: record.models.length,
      stats: record.stats,
      sources: record.sources,
      diff: record.diff.slice(0, 50),
      diffCount: record.diff.length,
      tombstones: record.tombstones.length,
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
