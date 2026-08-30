import { NextRequest } from "next/server";
import { sse, SSE_HEADERS } from "@/lib/router/sse";
import { providerById } from "@/lib/research/providers";
import { gatherEvidence } from "@/lib/compare/evidence";
import { callerKey, compareLimiter } from "@/lib/compare/rate-limit";
import { EMPTY_EVIDENCE, type Depth, type EvidenceEvent } from "@/lib/compare/types";
import type { WebSource } from "@/lib/chat/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Deep runs four rounds of parallel search. The budget in
 * `lib/compare/evidence.ts` caps the loop at 180 s so this ceiling is a backstop
 * rather than the thing that ends the stage.
 */
export const maxDuration = 300;

const SEARCH_TIMEOUT_MS = 9_000;
const SEARCH_COUNT = 8;

/**
 * A scraped response larger than this that yielded no results is a page we
 * were served instead of results, not an empty result set. A genuine
 * no-results page is far smaller than an anti-bot interstitial.
 */
const BLOCKED_PAGE_BYTES = 2_000;

interface Body {
  question: string;
  briefQueries: string[];
  depth: Depth;
  documents?: { name: string; text: string }[];
  /** Search backend id, per `lib/research/providers.ts`. Defaults to keyless DuckDuckGo. */
  provider?: string;
}

/**
 * Build the one evidence pack every lane will answer from.
 *
 * Streams round-by-round rather than returning at the end, because Deep can run
 * for minutes and "12 sources across 3 rounds" arriving as it happens is the
 * difference between a progress bar and a spinner.
 *
 * Search runs server-side rather than in the browser: the loop is already
 * server code (`runResearch` + `fanOut`), the scrape backends do not allow
 * cross-origin requests, and BYOK search keys should not be spent from a page.
 */
export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.question?.trim()) {
    return Response.json({ error: "question is required" }, { status: 400 });
  }

  const decision = compareLimiter.check(callerKey(req.headers), 1);
  if (!decision.ok) {
    return Response.json(
      { error: "Too many comparison runs from this address. Try again shortly.", code: "rate_limited" },
      { status: 429, headers: { "retry-after": String(Math.ceil(decision.retryAfterMs / 1000)) } },
    );
  }

  const provider = providerById(body.provider);
  const searchKey = req.headers.get("x-search-key")?.trim() || undefined;

  /**
   * One search. Resolves with `[]` rather than throwing on any failure, which is
   * the contract `runResearch` expects — a dead backend costs one angle, not the
   * run.
   */
  const search = async (query: string): Promise<WebSource[]> => {
    // A keyed backend without a key would 401 on every query; refusing here
    // costs nothing and keeps the loop from burning its whole budget on it.
    if (provider.needsKey && !searchKey) {
      throw new Error(`${provider.label} needs an API key`);
    }
    try {
      const spec = provider.request(query, SEARCH_COUNT, searchKey);
      const res = await fetch(spec.url, {
        method: spec.method,
        headers: spec.headers,
        body: spec.body,
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`${provider.label} returned HTTP ${res.status}`);
      // Scraped backends hand back HTML; the rest hand back JSON.
      const raw = spec.html ? await res.text() : await res.json();
      const sources = provider.parse(raw, SEARCH_COUNT);

      // A scrape that parses to nothing out of a full page of HTML is a backend
      // serving something other than results — DuckDuckGo answers a blocked
      // client with HTTP 202 and an anti-bot page, which `res.ok` accepts and
      // the parser silently reduces to []. Returning [] here would report a
      // clean research stage that found nothing, and every lane would then
      // answer ungrounded with no indication why.
      if (spec.html && sources.length === 0 && typeof raw === "string" && raw.length > BLOCKED_PAGE_BYTES) {
        throw new Error(`${provider.label} returned a page with no results in it`);
      }
      return sources;
    } catch (e) {
      // Rethrown rather than swallowed: `runResearch` records one failure per
      // query, and that count is what tells the user their answers are
      // ungrounded because search broke, not because the topic is obscure.
      throw e instanceof Error ? e : new Error("search failed");
    }
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (e: EvidenceEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(sse(e)));
      };

      try {
        const pack = await gatherEvidence({
          question: body.question,
          briefQueries: Array.isArray(body.briefQueries) ? body.briefQueries : [],
          depth: body.depth ?? "standard",
          documents: body.documents,
          search,
          signal: req.signal,
          onRound: (report) => send({ type: "round", ...report }),
        });
        send({ type: "sources", sources: pack.sources });
        send({ type: "evidence_done", pack });
      } catch (e) {
        // `gatherEvidence` already degrades internally, so reaching here means
        // something outside the loop broke. The run continues without evidence.
        send({ type: "evidence_error", message: (e as Error).message ?? "Research failed." });
        send({ type: "evidence_done", pack: EMPTY_EVIDENCE });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
