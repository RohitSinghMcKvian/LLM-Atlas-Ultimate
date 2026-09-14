import type { LaneQuota } from "./lanes";

// Reconciling the local estimate against what the provider actually says.
//
// The ledger's own count is an estimate and always will be: it misses spend
// from other deployments sharing the same operator key, it misses requests the
// provider counted but Atlas never saw complete, and the numbers in
// `lib/catalog/providers.ts` go stale as free tiers move. Every response the
// provider sends carries the truth in its headers, so **provider truth always
// overrides the estimate** — that is the single rule this module implements.
//
// The formats are not standardised, so all three families in use are read:
//
//   * OpenAI-style (`x-ratelimit-remaining-requests`) — Groq, OpenAI, DeepSeek,
//     Mistral, Cerebras, xAI. Reset is a *duration* like `"2m59.56s"`.
//   * Anthropic (`anthropic-ratelimit-requests-remaining`). Reset is an
//     RFC 3339 *timestamp*.
//   * OpenRouter (`x-ratelimit-remaining`). Reset is *epoch milliseconds*.

/** `"2m59.56s"`, `"1s"`, `"500ms"`, `"1h30m"` → milliseconds. */
function parseDuration(raw: string): number | undefined {
  const re = /(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)/g;
  let total = 0;
  let matched = false;
  for (const m of raw.matchAll(re)) {
    matched = true;
    const n = Number(m[1]);
    const unit = m[2];
    total +=
      unit === "ms" ? n
      : unit === "s" ? n * 1_000
      : unit === "m" ? n * 60_000
      : unit === "h" ? n * 3_600_000
      : n * 86_400_000;
  }
  return matched ? total : undefined;
}

/**
 * A reset header in any of the observed spellings → epoch ms.
 *
 * A bare number is genuinely ambiguous — it could be epoch ms, epoch seconds,
 * or a delta in seconds — so magnitude decides. The thresholds are far apart
 * enough that no real value is misread: a delta is at most a few thousand
 * seconds, while epoch seconds passed 1e9 in 2001 and epoch ms passed 1e12 in
 * 2001 as well.
 */
export function parseResetAt(raw: string | null, now: number): number | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (!s) return undefined;

  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n >= 1e12) return n; // epoch milliseconds
    if (n >= 1e9) return n * 1_000; // epoch seconds
    return now + n * 1_000; // a delta, in seconds
  }

  // Unit-bearing durations must be tried before Date.parse: some runtimes will
  // happily parse "2m" as a date rather than rejecting it.
  const dur = parseDuration(s);
  if (dur !== undefined) return now + dur;

  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * `Retry-After` → milliseconds from now. Seconds or an HTTP-date, per RFC 9110.
 *
 * Clamped at zero so a date already in the past reads as "retry now" rather
 * than a negative delay that would look like a bug downstream.
 */
export function parseRetryAfter(raw: string | null, now: number): number | undefined {
  const at = parseResetAt(raw, now);
  return at === undefined ? undefined : Math.max(0, at - now);
}

/** The header families, in the order they are tried. */
const FAMILIES = [
  {
    limit: (u: string) => `x-ratelimit-limit-${u}`,
    remaining: (u: string) => `x-ratelimit-remaining-${u}`,
    reset: (u: string) => `x-ratelimit-reset-${u}`,
  },
  {
    limit: (u: string) => `anthropic-ratelimit-${u}-limit`,
    remaining: (u: string) => `anthropic-ratelimit-${u}-remaining`,
    reset: (u: string) => `anthropic-ratelimit-${u}-reset`,
  },
  // OpenRouter's unsuffixed spelling. Requests only — it publishes no token
  // headers — so it is tried last and only matches a `requests` window.
  {
    limit: () => "x-ratelimit-limit",
    remaining: () => "x-ratelimit-remaining",
    reset: () => "x-ratelimit-reset",
  },
] as const;

function readNumber(h: Headers, name: string): number | undefined {
  const raw = h.get(name);
  if (raw === null) return undefined;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Overwrite each quota with the provider's own account of it.
 *
 * A window the provider says nothing about is returned untouched — silence is
 * not evidence, and zeroing an unreported window would free a lane the ledger
 * had correctly blocked.
 *
 * `limit` is adopted from the provider too, not just `remaining`: when the
 * table in `providers.ts` has gone stale, the provider's own number is the one
 * worth keeping, and `used` derived against a wrong limit would be wrong twice.
 */
export function applyProviderHeaders(
  quotas: readonly LaneQuota[],
  headers: Headers,
  now: number,
): LaneQuota[] {
  const retryAfter = parseRetryAfter(headers.get("retry-after"), now);

  return quotas.map((q) => {
    // OpenRouter's unsuffixed headers describe request counts only.
    const families = q.unit === "requests" ? FAMILIES : FAMILIES.slice(0, 2);

    for (const f of families) {
      const remaining = readNumber(headers, f.remaining(q.unit));
      if (remaining === undefined) continue;

      const limit = readNumber(headers, f.limit(q.unit)) ?? q.limit;
      const resetsAt = parseResetAt(headers.get(f.reset(q.unit)), now) ?? q.resetsAt;
      return {
        ...q,
        limit,
        used: Math.max(0, limit - remaining),
        resetsAt,
      };
    }

    // No per-window headers, but a Retry-After means this lane is spent right
    // now even though the ledger had not counted it there yet — the case where
    // another deployment shares the key.
    if (retryAfter !== undefined && retryAfter > 0) {
      return { ...q, used: Math.max(q.used, q.limit), resetsAt: now + retryAfter };
    }
    return q;
  });
}
