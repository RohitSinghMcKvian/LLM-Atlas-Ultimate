import type { RouterError } from "@/lib/router";

/**
 * Whether a session-turn error is the dock's own version of the
 * "Connect a key to run live models" state `chat-client.tsx` already handles
 * with `<ProviderBanner />`.
 *
 * `RouterError["code"]` survives the SSE stream into `runToolLoop`'s callback
 * and now into the dock's `onError`, so this checks the two codes that mean
 * "no route exists yet" rather than "a route existed and failed" — the
 * dock can offer the same fix chat does only for the former; a rate limit or
 * a dead route needs a different model, not a key.
 */
const NEEDS_PROVIDER_CODES: ReadonlySet<RouterError["code"]> = new Set([
  "no_provider_configured",
  "key_required",
]);

export function needsProviderBanner(code: string | undefined): boolean {
  return code !== undefined && NEEDS_PROVIDER_CODES.has(code as RouterError["code"]);
}
