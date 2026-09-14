import { PROVIDERS } from "@/lib/catalog/providers";
import type { ProviderId } from "@/lib/catalog/types";

// How a user's own provider credentials travel from their browser to an Atlas
// API route, and the one place that parse is written.
//
// Deliberately importable from BOTH sides. It pulls in `@/lib/catalog/providers`
// (~2 KB of metadata) and nothing else — never `./index`, which is the
// server-only gateway. The client builds the headers, the route handler reads
// them back, and both agree because they agree on this file.
//
// SECURITY: these values are secrets in transit. They are never persisted
// server-side, never logged, and never echoed in a response. `scrubSecrets()` in
// `./index` strips them from any upstream error body before it reaches a client.

/**
 * User-supplied keys, forwarded from the browser for a single request.
 *
 * One optional key per provider. Previously this was `{ openrouter?: string }`,
 * which is why OpenRouter was the only provider a user could bring their own
 * credential for.
 */
export type UserKeys = Partial<Record<ProviderId, string>>;

/**
 * One header per provider rather than a single JSON blob.
 *
 * Self-describing, greppable, and small enough that only the handful a request
 * could actually use ever need to be sent. A single JSON header would be more
 * compact but is far easier to log whole by accident.
 */
export const USER_KEY_HEADER_PREFIX = "x-atlas-key-";

/**
 * The single-provider header this generalises.
 *
 * Still accepted so that a tab left open across a deploy keeps working. Remove
 * once no client sends it.
 */
export const LEGACY_OPENROUTER_HEADER = "x-openrouter-key";

/** The header name carrying the user's key for one provider. */
export function userKeyHeaderFor(id: ProviderId): string {
  return `${USER_KEY_HEADER_PREFIX}${id}`;
}

const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

/**
 * Read every user-supplied provider key off an inbound request.
 *
 * Only known provider ids are considered, so an attacker cannot smuggle an
 * arbitrary header through into a runtime. Blank values are dropped rather than
 * stored as "", which would otherwise read as "a key is present" downstream.
 */
export function readUserKeys(h: Headers): UserKeys {
  const keys: UserKeys = {};
  for (const id of PROVIDER_IDS) {
    const value = h.get(userKeyHeaderFor(id))?.trim();
    if (value) keys[id] = value;
  }
  // Legacy header loses to the explicit one when both are present.
  if (!keys.openrouter) {
    const legacy = h.get(LEGACY_OPENROUTER_HEADER)?.trim();
    if (legacy) keys.openrouter = legacy;
  }
  return keys;
}

/** The providers a set of user keys covers — the shape `RouteEnv` wants. */
export function userKeyProviders(keys: UserKeys | undefined): ProviderId[] {
  if (!keys) return [];
  return PROVIDER_IDS.filter((id) => {
    const v = keys[id];
    return typeof v === "string" && v.length > 0;
  });
}

/** Build the outbound headers for a request. Empty object when nothing is set. */
export function userKeyHeaders(keys: UserKeys | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const id of userKeyProviders(keys)) {
    headers[userKeyHeaderFor(id)] = keys![id] as string;
  }
  return headers;
}
