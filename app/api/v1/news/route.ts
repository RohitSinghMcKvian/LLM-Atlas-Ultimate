import { NextRequest } from "next/server";
import { getNewsSnapshot } from "@/lib/news/store";
import { liveScore } from "@/lib/news/rank";
import type { NewsArticle } from "@/lib/news/types";

export const runtime = "nodejs";
// Reads a runtime snapshot that changes hourly; never prerender it.
export const dynamic = "force-dynamic";

/**
 * The news corpus.
 *
 * The client read path for anything that renders after hydration — the infinite
 * scroll tail, the ⌘K headlines group, and the sync pill's post-refresh
 * reconciliation. The /news *page* never calls this: it receives the snapshot as
 * a server prop and pays no request at all.
 *
 * Query parameters:
 *   ?fields=stats       headline counts only
 *   ?fields=headlines   the top N titles, for the command palette
 *   ?offset= &limit=    the ranked tail, for infinite scroll
 *   ?since=<iso>        only articles first seen after an instant
 *   ?cluster=<id>       one cluster's members
 */
export async function GET(req: NextRequest) {
  const snapshot = await getNewsSnapshot();
  const { searchParams } = new URL(req.url);
  const fields = searchParams.get("fields");

  if (fields === "stats") {
    return Response.json(
      {
        version: snapshot.version,
        syncedAt: snapshot.syncedAt,
        origin: snapshot.origin,
        stats: snapshot.stats,
        warnings: snapshot.warnings,
        enrichment: snapshot.enrichment,
      },
      { headers: cacheHeaders(snapshot.version, "stats") },
    );
  }

  const now = Date.now();

  if (fields === "headlines") {
    const limit = clampInt(searchParams.get("limit"), 5, 1, 20);
    const headlines = rankedArticles(snapshot.articles, now)
      .slice(0, limit)
      .map((a) => ({
        id: a.id,
        title: a.title,
        domain: a.domain,
        sourceName: a.sourceName,
        publishedAt: a.publishedAt,
        level: a.verification.level,
      }));

    return Response.json(
      { version: snapshot.version, syncedAt: snapshot.syncedAt, headlines },
      { headers: cacheHeaders(snapshot.version, "headlines") },
    );
  }

  const clusterId = searchParams.get("cluster");
  if (clusterId) {
    const cluster = snapshot.clusters.find((c) => c.id === clusterId);
    if (!cluster) return Response.json({ error: "Unknown cluster" }, { status: 404 });
    const byId = new Map(snapshot.articles.map((a) => [a.id, a]));
    return Response.json(
      { cluster, articles: cluster.memberIds.map((id) => byId.get(id)).filter(Boolean) },
      { headers: cacheHeaders(snapshot.version, `c${clusterId}`) },
    );
  }

  const since = searchParams.get("since");
  const offset = clampInt(searchParams.get("offset"), 0, 0, 5_000);
  const limit = clampInt(searchParams.get("limit"), 120, 1, 300);

  let articles = rankedArticles(snapshot.articles, now);
  if (since) {
    const cutoff = Date.parse(since);
    if (Number.isFinite(cutoff)) {
      articles = articles.filter((a) => Date.parse(a.firstSeenAt) > cutoff);
    }
  }

  const page = articles.slice(offset, offset + limit);

  // The version is a content hash, so a conditional request costs one hash
  // comparison instead of the whole corpus on the wire. It covers the paging
  // parameters too — the same version at a different offset is a different body.
  const etag = `"${snapshot.version}-${offset}-${limit}-${since ?? ""}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, ...baseCache() } });
  }

  return Response.json(
    {
      version: snapshot.version,
      syncedAt: snapshot.syncedAt,
      origin: snapshot.origin,
      total: articles.length,
      offset,
      articles: page,
      // Clusters are small and the client needs the whole index to expand any
      // card's "also reported by", so they are not paged.
      clusters: offset === 0 ? snapshot.clusters : undefined,
      sources: offset === 0 ? snapshot.sources : undefined,
      stats: offset === 0 ? snapshot.stats : undefined,
      warnings: offset === 0 ? snapshot.warnings : undefined,
      enrichment: offset === 0 ? snapshot.enrichment : undefined,
    },
    { headers: { ETag: etag, ...baseCache() } },
  );
}

/**
 * Rank by `liveScore`, which applies recency decay to the stored, recency-free
 * `baseScore`. Done here rather than at sync time precisely so the stored
 * snapshot — and therefore its content hash — does not change every hour.
 */
function rankedArticles(articles: readonly NewsArticle[], now: number): NewsArticle[] {
  return articles
    .map((article) => ({ article, score: liveScore(article, now) }))
    .sort((a, b) => b.score - a.score || (a.article.id < b.article.id ? -1 : 1))
    .map((entry) => entry.article);
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function baseCache(): Record<string, string> {
  return {
    // Revalidate with the origin every time, but let a CDN keep serving the last
    // copy for an hour and refresh behind the request. Mirrors the server-side
    // stale-while-revalidate in `lib/news/store.ts`.
    "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
  };
}

function cacheHeaders(version: string, suffix = ""): Record<string, string> {
  return { ETag: `"${version}${suffix ? `-${suffix}` : ""}"`, ...baseCache() };
}
