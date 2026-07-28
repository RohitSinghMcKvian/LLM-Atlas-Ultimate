import { NextRequest } from "next/server";
import { ATLAS_UA } from "@/lib/news/sync/fetch";
import { isAllowedImageUrl } from "@/lib/news/image";
import { getNewsSnapshot } from "@/lib/news/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The news image proxy.
//
// WHY A PROXY AT ALL
//
// Article images live on three dozen publisher CDNs. The alternatives were:
// hotlink them (broken images wherever a publisher blocks it, and every reader's
// IP handed to every CDN), or add `images.remotePatterns: ["https://**"]` to
// `next.config.mjs` — which turns Next's optimizer into an open image-resizing
// proxy for any URL on the internet. This route is same-origin, so the app needs
// no `remotePatterns` entry at all, and referrers never leave.
//
// WHY IT IS WRITTEN THE WAY IT IS
//
// A route that fetches a URL supplied in a query parameter, using the server's
// own network position, is the textbook SSRF shape. Every gate below exists
// because of that, ordered cheapest first:
//
//   1. Structural: https, no credentials, default port, not an IP literal, not a
//      loopback/link-local/internal name. (`isSafeImageUrl`)
//   2. Snapshot pinning — the real gate. The URL must be one the current corpus
//      references, or be on a host the corpus references. Both sets are written
//      by the sync from images that already passed their feed's domain check, so
//      no attacker-supplied value can widen them.
//   3. `redirect: "manual"`. A 3xx is a failure, not a hop. Following redirects
//      is the classic way to launder gate 1 and 2 into a request to 169.254.169.254.
//   4. Content-type must be an image and must not be SVG, which can carry script.
//   5. A size floor (tracking pixels) and ceiling, enforced on the stream because
//      `Content-Length` can lie.
//
// No client headers are forwarded — no `Referer`, no `Cookie`, no `User-Agent`
// from the browser.

/** Below this is a tracking pixel or a spacer, not a hero image. */
const MIN_BYTES = 1024;
const MAX_BYTES = 3 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 8_000;

/** A failure is cached briefly so a broken image is not re-fetched on every scroll. */
function notFound(): Response {
  return new Response(null, {
    status: 404,
    headers: { "Cache-Control": "public, max-age=300" },
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  const raw = new URL(req.url).searchParams.get("u");
  if (!raw) return notFound();

  const snapshot = await getNewsSnapshot();
  const allowlist = {
    urls: new Set(
      snapshot.articles.map((a) => a.image?.url).filter((u): u is string => Boolean(u)),
    ),
    hosts: snapshot.imageHosts,
  };

  if (!isAllowedImageUrl(raw, allowlist)) return notFound();

  let upstream: Response;
  try {
    upstream = await fetch(raw, {
      // Gate 3.
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*;q=0.8",
        "User-Agent": ATLAS_UA,
      },
    });
  } catch {
    return notFound();
  }

  if (upstream.status !== 200) {
    await upstream.body?.cancel().catch(() => {});
    return notFound();
  }

  // Gate 4.
  const contentType = (upstream.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("image/") || contentType === "image/svg+xml") {
    await upstream.body?.cancel().catch(() => {});
    return notFound();
  }

  // Gate 5, declared half.
  const declared = Number(upstream.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 0) {
    if (declared < MIN_BYTES || declared > MAX_BYTES) {
      await upstream.body?.cancel().catch(() => {});
      return notFound();
    }
  }

  const body = upstream.body;
  if (!body) return notFound();

  // Gate 5, enforced half. The header is advisory and absent on chunked
  // responses, so the ceiling is applied to the bytes as they arrive.
  let transferred = 0;
  const capped = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        transferred += chunk.byteLength;
        if (transferred > MAX_BYTES) {
          controller.error(new Error("image too large"));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );

  return new Response(capped, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      // Publisher images are effectively immutable at a given URL, and this is
      // the highest-volume route in the app once a feed is scrolled.
      "Cache-Control": "public, max-age=604800, s-maxage=2592000, immutable",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
      // Defence in depth: even if a non-image slipped past gate 4, it cannot
      // load anything or run anything.
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Referrer-Policy": "no-referrer",
    },
  });
}
