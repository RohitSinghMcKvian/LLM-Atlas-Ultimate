import { SyncFetchError } from "@/lib/catalog/sync/fetch";

// A text fetch with a timeout, bounded retry, conditional requests, and a byte
// cap enforced while reading.
//
// WHY THIS IS A SIBLING OF `lib/catalog/sync/fetch.ts` RATHER THAN A REFACTOR
//
// That file hardcodes `Accept: application/json` and ends in `res.json()` — the
// parse is *inside* the retry loop, so it cannot be wrapped. Generalising it
// into `fetchWith(parser)` would mean editing the code path that ~400 models
// depend on in order to add a feature that does not exist yet, and a regression
// there takes the catalog down. So: a sibling, re-exporting its error type so
// callers still handle one class.
//
// Four things this needs that the catalog's does not:
//
//   • Conditional requests. An hourly sweep over ~37 feeds is mostly 304s if we
//     replay stored ETag/Last-Modified validators, which is the difference
//     between kilobytes and megabytes of upstream traffic every hour. This is
//     the single biggest efficiency win in the whole sync.
//   • A byte cap enforced *during* the read. `Content-Length` is advisory and
//     absent on chunked responses, so trusting it is not a limit at all.
//   • Feed content negotiation, and a descriptive User-Agent — several
//     publishers in the registry 403 an empty or generic one.
//   • Shorter per-attempt budgets. Three dozen feeds must fit inside a 60s
//     serverless invocation, so one slow feed gets 8s per attempt rather than 12s.

export { SyncFetchError };

/**
 * Sent on every upstream request. Identifying the agent with a contact URL is
 * both more polite and, for most publishers, more likely to be served than an
 * anonymous request.
 *
 * "Most" is doing real work in that sentence — see `fetchText`'s UA fallback.
 */
export const ATLAS_UA = "LLMAtlasNewsBot/1.0 (+https://llmatlas.xyz)";

const FEED_ACCEPT =
  "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8";

export interface FetchTextOptions {
  /** Per-attempt budget. Default 8s so 37 feeds fit in `maxDuration = 60`. */
  timeoutMs?: number;
  /**
   * Retries *after* the first attempt.
   *
   * Two, not one. Several CDNs (AWS among them) reset the very first TLS
   * connection from a cold process and serve the identical request fine on the
   * next one — with a single retry those feeds fail roughly half of all syncs.
   * The global fetch budget bounds the worst case, and the steady state is a
   * 304 that never retries at all.
   */
  retries?: number;
  baseDelayMs?: number;
  /** Hard ceiling on the decoded body. Default 2 MB. */
  maxBytes?: number;
  /** Validators from the previous sync. Present ⇒ a conditional request. */
  etag?: string;
  lastModified?: string;
  accept?: string;
  signal?: AbortSignal;
}

export interface FetchTextResult {
  status: "ok" | "not_modified";
  /** Empty when `not_modified`. */
  body: string;
  /** Validators to persist for the next sync. */
  etag?: string;
  lastModified?: string;
  httpStatus: number;
  ms: number;
  /** The byte cap was reached and the body was cut short. */
  truncated: boolean;
}

/** Only rate limits and upstream outages are worth trying again. */
function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function backoffMs(attempt: number, base: number): number {
  const exponential = base * 2 ** attempt;
  // Full jitter — dozens of feeds polled on a fixed hourly schedule would
  // otherwise retry in lockstep and re-create the burst they are backing off from.
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Unwrap what `fetch` actually failed on.
 *
 * Undici reports every transport problem as the same opaque "fetch failed" and
 * hides the real reason on `.cause`. That string ends up in the snapshot's
 * warnings and in the UI's failed-sources strip, where "fetch failed" tells an
 * operator nothing — `ECONNRESET` versus `ENOTFOUND` versus a TLS error is the
 * difference between "retry later", "the URL is wrong" and "fix the registry".
 */
function describeTransportError(err: unknown): string {
  if (!(err instanceof Error)) return "request failed";
  if (err.name === "TimeoutError" || err.name === "AbortError") return "timed out";

  const cause = (err as Error & { cause?: unknown }).cause;
  const causeMessage =
    cause instanceof Error
      ? `${(cause as Error & { code?: string }).code ?? ""} ${cause.message}`.trim()
      : "";

  return causeMessage ? `${err.message} (${causeMessage})` : err.message;
}

/**
 * Read a response body as text, stopping at `maxBytes`.
 *
 * Decoding is streamed rather than done on a fully-buffered `ArrayBuffer`,
 * because buffering first means a hostile or misconfigured endpoint can make the
 * process hold the whole payload before any limit applies. `TextDecoder` with
 * `{ stream: true }` keeps multi-byte sequences intact across chunk boundaries.
 */
async function readCapped(res: Response, maxBytes: number): Promise<{ body: string; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    return text.length > maxBytes
      ? { body: text.slice(0, maxBytes), truncated: true }
      : { body: text, truncated: false };
  }

  const decoder = new TextDecoder("utf-8", { fatal: false });
  let received = 0;
  let out = "";
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      received += value.byteLength;
      if (received > maxBytes) {
        const keep = value.byteLength - (received - maxBytes);
        if (keep > 0) out += decoder.decode(value.subarray(0, keep), { stream: false });
        truncated = true;
        break;
      }
      out += decoder.decode(value, { stream: true });
    }
    if (!truncated) out += decoder.decode();
  } finally {
    // Releasing matters on the truncation path: without it the connection stays
    // open until GC, and 37 of those per sync exhausts the socket pool.
    await reader.cancel().catch(() => {});
  }

  return { body: out, truncated };
}

export async function fetchText(url: string, options: FetchTextOptions = {}): Promise<FetchTextResult> {
  const {
    timeoutMs = 8_000,
    retries = 2,
    baseDelayMs = 600,
    maxBytes = 2_000_000,
    etag,
    lastModified,
    accept = FEED_ACCEPT,
    signal,
  } = options;

  const baseHeaders: Record<string, string> = {
    Accept: accept,
    "Accept-Language": "en",
  };
  if (etag) baseHeaders["If-None-Match"] = etag;
  if (lastModified) baseHeaders["If-Modified-Since"] = lastModified;

  let lastError: SyncFetchError | undefined;
  // Some WAFs reset the connection on a bot-shaped User-Agent before any HTTP
  // response is written — AWS and The Register both do, and both serve the same
  // feed happily with no UA at all. The identifying header stays the default
  // because it is the courteous thing to send; this drops it only after the
  // polite attempt has already failed at the transport layer.
  let dropUserAgent = false;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new SyncFetchError(`${url}: aborted`);
    const started = Date.now();
    const headers = dropUserAgent ? baseHeaders : { ...baseHeaders, "User-Agent": ATLAS_UA };

    try {
      const res = await fetch(url, {
        headers,
        cache: "no-store",
        redirect: "follow",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
      });

      if (res.status === 304) {
        // Nothing changed. Carry the previous validators forward — some servers
        // omit them on a 304, and dropping them would make every later sweep
        // unconditional again.
        await res.body?.cancel().catch(() => {});
        return {
          status: "not_modified",
          body: "",
          etag: res.headers.get("etag") ?? etag,
          lastModified: res.headers.get("last-modified") ?? lastModified,
          httpStatus: 304,
          ms: Date.now() - started,
          truncated: false,
        };
      }

      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        const error = new SyncFetchError(`${url} responded ${res.status}`, res.status);

        // Deliberately NOT retried without the User-Agent on a 403.
        //
        // That was tried, against OpenAI's site, whose article pages all carry a
        // good `og:image` and answer 403 to this fetcher. Removing the UA
        // changes nothing: the same request answers 403 anonymously too, while
        // `curl` with the identical headers is served — so the refusal is keyed
        // on the TLS/HTTP fingerprint, not on what we call ourselves. A retry
        // would have doubled the requests to a publisher who has already said no
        // and fixed nothing, and the only thing that WOULD work is impersonating
        // a browser, which is evading an access control the publisher chose to
        // set. Those articles keep their generated art.
        if (attempt < retries && isRetryable(res.status)) {
          lastError = error;
          await sleep(backoffMs(attempt, baseDelayMs));
          continue;
        }
        throw error;
      }

      const { body, truncated } = await readCapped(res, maxBytes);
      return {
        status: "ok",
        body,
        etag: res.headers.get("etag") ?? undefined,
        lastModified: res.headers.get("last-modified") ?? undefined,
        httpStatus: res.status,
        ms: Date.now() - started,
        truncated,
      };
    } catch (err) {
      if (err instanceof SyncFetchError) throw err;
      const error = new SyncFetchError(`${url}: ${describeTransportError(err)}`);
      if (attempt < retries && !signal?.aborted) {
        lastError = error;
        // A transport-level failure on the first try is exactly the WAF-reset
        // signature, so the retry goes out without the UA. A genuine network
        // problem simply fails twice, which costs one extra request.
        dropUserAgent = true;
        await sleep(backoffMs(attempt, baseDelayMs));
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new SyncFetchError(`${url}: request failed`);
}
