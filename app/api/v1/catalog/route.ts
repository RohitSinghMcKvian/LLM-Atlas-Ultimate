import { NextRequest } from "next/server";
import { getCatalogSnapshot } from "@/lib/catalog/store";

export const runtime = "nodejs";
// Reads a runtime snapshot that changes daily; never prerender it.
export const dynamic = "force-dynamic";

/**
 * The model catalog as one snapshot.
 *
 * The client read path for the two shell widgets that render after hydration
 * (`model-switcher-body`, `command-palette-models`). Catalog *pages* never call
 * this — they receive the snapshot as a server prop, so they pay no request at
 * all.
 *
 * `?fields=stats` returns just the headline counts, for callers that want the
 * numbers without ~400 models.
 */
export async function GET(req: NextRequest) {
  const snapshot = await getCatalogSnapshot();
  const { searchParams } = new URL(req.url);

  if (searchParams.get("fields") === "stats") {
    return Response.json(
      {
        version: snapshot.version,
        syncedAt: snapshot.syncedAt,
        origin: snapshot.origin,
        stats: snapshot.stats,
      },
      { headers: cacheHeaders(snapshot.version, "stats") },
    );
  }

  // The version is a content hash, so a conditional request costs one hash
  // comparison instead of ~40 KB on the wire.
  const etag = `"${snapshot.version}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: cacheHeaders(snapshot.version) });
  }

  return Response.json(snapshot, { headers: cacheHeaders(snapshot.version) });
}

function cacheHeaders(version: string, suffix = ""): Record<string, string> {
  return {
    ETag: `"${version}${suffix ? `-${suffix}` : ""}"`,
    // Revalidate with the origin every time, but let a CDN keep serving the last
    // copy for a day and refresh behind the request. Mirrors the server-side
    // stale-while-revalidate in `lib/catalog/store.ts`.
    "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
  };
}
