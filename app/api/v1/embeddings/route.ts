import { NextRequest } from "next/server";
import { getProviderRuntime, type UserKeys } from "@/lib/router";
import type { ProviderId } from "@/lib/catalog/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin, stateless BYOK proxy for text embeddings (spec §4.5 RAG).
 *
 * The browser cannot call a provider's `/embeddings` directly (CORS, and the
 * key must not sit in the client bundle), so this forwards an OpenAI-shaped
 * embeddings request to the chosen provider using either the operator's env key
 * or the user's per-request key. The key is forwarded once and never stored,
 * logged, or echoed back — same contract as the chat route.
 *
 * Providers that speak the OpenAI `/embeddings` shape: nvidia, google (compat
 * endpoint), local (Ollama). OpenRouter's embeddings support is inconsistent,
 * so this is not the default path — the client falls back to the offline
 * lexical embedder whenever this route is unavailable.
 */
interface Body {
  model: string;
  input: string[];
  /** Which provider to route to. Defaults to the first embeddings-capable one. */
  provider?: ProviderId;
}

const EMBEDDINGS_PROVIDERS: ProviderId[] = ["nvidia", "google", "local"];

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.model || !Array.isArray(body.input) || body.input.length === 0) {
    return Response.json(
      { error: "model and a non-empty input array are required" },
      { status: 400 },
    );
  }

  const orKey = req.headers.get("x-openrouter-key")?.trim();
  const userKeys: UserKeys = orKey ? { openrouter: orKey } : {};

  // Pick the requested provider, else the first one that is actually configured.
  const providerId =
    body.provider ??
    EMBEDDINGS_PROVIDERS.find((p) => getProviderRuntime(p, userKeys) !== null);

  if (!providerId) {
    return Response.json(
      { error: "No embeddings provider is configured", code: "no_provider_configured" },
      { status: 503 },
    );
  }

  const runtime = getProviderRuntime(providerId, userKeys);
  if (!runtime) {
    return Response.json(
      { error: `Provider ${providerId} is not configured`, code: "no_provider_configured" },
      { status: 503 },
    );
  }

  let res: Response;
  try {
    res = await fetch(`${runtime.baseUrl}/embeddings`, {
      method: "POST",
      headers: runtime.headers,
      body: JSON.stringify({ model: body.model, input: body.input }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return Response.json(
      { error: "Could not reach the embeddings provider" },
      { status: 502 },
    );
  }

  if (!res.ok) {
    // Pass the status through, but not the provider's (possibly key-bearing) body.
    return Response.json(
      { error: `Embeddings request failed (${res.status})` },
      { status: res.status },
    );
  }

  let json: { data?: { embedding: number[] }[] };
  try {
    json = await res.json();
  } catch {
    return Response.json({ error: "Malformed provider response" }, { status: 502 });
  }

  const embeddings = (json.data ?? []).map((d) => d.embedding);
  if (embeddings.length !== body.input.length) {
    return Response.json(
      { error: "Provider returned the wrong number of embeddings" },
      { status: 502 },
    );
  }

  return Response.json({ embeddings, provider: providerId });
}
