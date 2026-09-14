import { NextRequest } from "next/server";
import { PROVIDERS } from "@/lib/catalog";
import type { ProviderId } from "@/lib/catalog/types";
import { readUserKeys } from "@/lib/router/user-keys";
import { modelsEndpointFor, protocolHeaders } from "@/lib/router/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Validates a BYOK key for ANY provider.
 *
 * The key arrives per-request in `x-atlas-key-<provider>` (or the legacy
 * `x-openrouter-key`), is forwarded exactly once, and is never stored, logged,
 * or echoed back. The response is a sanitized projection — a label and, where
 * the provider offers it, remaining credit — never the key itself.
 *
 * Two strategies, because only one provider tells us anything interesting:
 *
 *   * **OpenRouter** has `GET /key`, which reports label, usage, limit and
 *     free-tier status. Worth a special case: it is the only endpoint that can
 *     answer "how much credit is left".
 *   * **Everyone else** gets an authenticated `GET /models`. It proves the key
 *     is accepted, which is the actual question, and it is the cheapest
 *     authenticated call every OpenAI-compatible provider supports. Anthropic's
 *     path and auth header differ, so both come from `lib/router/protocol.ts`
 *     rather than being rebuilt here.
 */
export async function POST(req: NextRequest) {
  const keys = readUserKeys(req.headers);
  const url = new URL(req.url);
  const asked = url.searchParams.get("provider") as ProviderId | null;

  // Which provider to test: the one asked for, else whichever key was sent.
  const provider: ProviderId | undefined =
    asked && asked in PROVIDERS ? asked : (Object.keys(keys)[0] as ProviderId | undefined);

  if (!provider || !(provider in PROVIDERS)) {
    return Response.json({ ok: false, error: "Unknown provider" }, { status: 400 });
  }
  const key = keys[provider];
  if (!key) {
    return Response.json({ ok: false, error: "No key provided" }, { status: 400 });
  }

  const meta = PROVIDERS[provider];
  const base = process.env[`${provider.toUpperCase()}_BASE_URL`] || meta.defaultBaseUrl;

  // A wrong-looking paste is worth catching before spending a round trip on it.
  if (meta.keyPrefix && !key.startsWith(meta.keyPrefix)) {
    return Response.json({
      ok: false,
      error: `That does not look like a ${meta.name} key — they start with "${meta.keyPrefix}".`,
    });
  }

  return provider === "openrouter"
    ? testOpenRouter(base, key)
    : testGeneric(provider, base, key);
}

async function testOpenRouter(base: string, key: string) {
  let res: Response;
  try {
    res = await fetch(`${base}/key`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return Response.json({ ok: false, error: "Could not reach OpenRouter" }, { status: 502 });
  }

  if (res.status === 401 || res.status === 403) {
    return Response.json({ ok: false, error: "Key was rejected by OpenRouter" });
  }
  if (!res.ok) {
    return Response.json({ ok: false, error: `OpenRouter responded ${res.status}` });
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
    provider: "openrouter",
    label: d.label ?? "OpenRouter key",
    usage: typeof d.usage === "number" ? d.usage : 0,
    limit: d.limit ?? null,
    limitRemaining: d.limit_remaining ?? null,
    isFreeTier: Boolean(d.is_free_tier),
    rateLimit: d.rate_limit ?? null,
  });
}

async function testGeneric(provider: ProviderId, base: string, key: string) {
  const meta = PROVIDERS[provider];
  const protocol = meta.protocol ?? "openai";

  let res: Response;
  try {
    res = await fetch(modelsEndpointFor(protocol, base), {
      headers: protocolHeaders(protocol, key),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return Response.json({ ok: false, error: `Could not reach ${meta.name}` }, { status: 502 });
  }

  if (res.status === 401 || res.status === 403) {
    return Response.json({ ok: false, error: `Key was rejected by ${meta.name}` });
  }
  if (!res.ok) {
    return Response.json({ ok: false, error: `${meta.name} responded ${res.status}` });
  }

  // The model count is the only useful signal a bare listing carries, and it
  // doubles as proof the response was really this provider's.
  const json = (await res.json().catch(() => null)) as {
    data?: unknown[];
    models?: unknown[];
  } | null;
  const count = (json?.data ?? json?.models ?? []).length;

  return Response.json({
    ok: true,
    provider,
    label: `${meta.name} key`,
    modelCount: count,
  });
}
