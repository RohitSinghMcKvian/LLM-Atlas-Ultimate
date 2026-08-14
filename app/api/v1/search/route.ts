import { NextRequest } from "next/server";
import { providerById } from "@/lib/research/providers";
import type { WebSource } from "@/lib/chat/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Web search, routed to whichever backend the user chose (§4.6).
 *
 * Was hard-wired to a keyless DuckDuckGo scrape. That remains the default and the
 * only zero-configuration path; a user with a key for Brave, Tavily or Exa can
 * point at one instead. The key arrives per-request in `x-search-key`, is
 * forwarded once, and is never stored, logged or echoed — the same BYOK contract
 * as the chat and embeddings routes (§1.3).
 *
 * How the request is built and how the response is read live in
 * lib/research/providers.ts, so this route stays a fetch plus error handling and
 * the provider quirks are unit-tested without a network.
 *
 * Search failure is never fatal to a chat turn: every path returns
 * `{ sources: [] }` rather than an error status, because a research turn that
 * degrades to "no results" is recoverable and one that throws is not.
 */

const TIMEOUT_MS = 9_000;

interface Body {
  query?: string;
  count?: number;
  provider?: string;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const query = String(body.query ?? "").trim();
  const count = Math.min(10, Math.max(1, Number(body.count) || 5));
  if (!query) return Response.json({ sources: [] });

  const provider = providerById(body.provider);
  const key = req.headers.get("x-search-key")?.trim() || undefined;

  // A keyed provider selected without a key would otherwise produce a 401 the
  // user cannot interpret. Say what is missing instead.
  if (provider.needsKey && !key) {
    return Response.json(
      { sources: [], error: `${provider.label} needs an API key. Add one in settings.` },
      { status: 200 },
    );
  }

  const spec = provider.request(query, count, key);
  try {
    const res = await fetch(spec.url, {
      method: spec.method,
      headers: spec.headers,
      body: spec.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      // The provider's status, not its body: an error body can echo the query and
      // sometimes the key, and neither belongs in a response Atlas relays.
      return Response.json({
        sources: [],
        error: `${provider.label} returned HTTP ${res.status}.`,
      });
    }
    const raw = spec.html ? await res.text() : await res.json();
    const sources: WebSource[] = provider.parse(raw, count);
    return Response.json({ sources, provider: provider.id });
  } catch {
    // Timeout, network failure, or a markup change that broke the scrape.
    return Response.json({ sources: [], error: `${provider.label} did not respond.` });
  }
}
