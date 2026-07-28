// A JSON fetch with a timeout and bounded retry.
//
// The repo's only existing timeout idiom is an inline `AbortSignal.timeout()` in
// the `keys/test` and `search` routes; `streamChatEvents` has provider failover
// but no timeout at all. The sync job runs unattended on a schedule, so a hung
// upstream connection must not pin a serverless invocation until the platform
// kills it — hence a real primitive here.

export interface FetchJsonOptions {
  timeoutMs?: number;
  /** Retries *after* the first attempt. */
  retries?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
}

export class SyncFetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SyncFetchError";
  }
}

/** Only rate limits and upstream outages are worth trying again. */
function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function backoffMs(attempt: number, base: number): number {
  const exponential = base * 2 ** attempt;
  // Full jitter — two providers polled concurrently on a fixed schedule would
  // otherwise retry in lockstep.
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchJson<T>(
  url: string,
  headers: Record<string, string>,
  options: FetchJsonOptions = {},
): Promise<T> {
  const { timeoutMs = 12_000, retries = 2, baseDelayMs = 500, signal } = options;
  let lastError: SyncFetchError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new SyncFetchError("Aborted");

    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", ...headers },
        cache: "no-store",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const error = new SyncFetchError(
          `${url} responded ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
          res.status,
        );
        if (attempt < retries && isRetryable(res.status)) {
          lastError = error;
          await sleep(backoffMs(attempt, baseDelayMs));
          continue;
        }
        throw error;
      }

      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof SyncFetchError) throw err;
      // Transport failure, timeout, or malformed JSON.
      const error = new SyncFetchError(
        err instanceof Error ? `${url}: ${err.message}` : `${url}: request failed`,
      );
      if (attempt < retries && !signal?.aborted) {
        lastError = error;
        await sleep(backoffMs(attempt, baseDelayMs));
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new SyncFetchError(`${url}: request failed`);
}
