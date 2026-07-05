import { NextRequest } from "next/server";
import { PROVIDERS } from "@/lib/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Validates a BYOK OpenRouter key by asking OpenRouter's own key-info endpoint
 * (`GET /api/v1/key`). The key arrives per-request in the `x-openrouter-key`
 * header, is forwarded once, and is never stored, logged, or echoed back.
 *
 * Returns a sanitized view: a masked label plus usage/limit so the Vault can
 * show remaining credit and free-tier status without exposing the raw key.
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-openrouter-key")?.trim();
  if (!key) {
    return Response.json(
      { ok: false, error: "No key provided" },
      { status: 400 },
    );
  }

  const base = process.env.OPENROUTER_BASE_URL || PROVIDERS.openrouter.defaultBaseUrl;

  let res: Response;
  try {
    res = await fetch(`${base}/key`, {
      headers: { Authorization: `Bearer ${key}` },
      // A validation call should be quick; never cache.
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return Response.json(
      { ok: false, error: "Could not reach OpenRouter" },
      { status: 502 },
    );
  }

  if (res.status === 401 || res.status === 403) {
    return Response.json(
      { ok: false, error: "Key was rejected by OpenRouter" },
      { status: 200 },
    );
  }
  if (!res.ok) {
    return Response.json(
      { ok: false, error: `OpenRouter responded ${res.status}` },
      { status: 200 },
    );
  }

  const json = (await res.json().catch(() => null)) as {
    data?: {
      label?: string;
      usage?: number;
      limit?: number | null;
      is_free_tier?: boolean;
      limit_remaining?: number | null;
      rate_limit?: { requests?: number; interval?: string };
    };
  } | null;

  const d = json?.data ?? {};
  return Response.json({
    ok: true,
    label: d.label ?? "OpenRouter key",
    usage: typeof d.usage === "number" ? d.usage : 0,
    limit: d.limit ?? null,
    limitRemaining: d.limit_remaining ?? null,
    isFreeTier: Boolean(d.is_free_tier),
    rateLimit: d.rate_limit ?? null,
  });
}
