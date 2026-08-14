/**
 * Does this model accept `tools`?
 *
 * The catalog cannot answer that honestly. `lib/catalog/sync/nvidia.ts`
 * reconstructs a model from its id alone and, unable to confirm tool calling per
 * model, claimed the safe thing: `toolUse: false`. Safe for a badge, ruinous for
 * a gate — the chat client read that field to decide whether to send `tools` at
 * all, so every NIM-synced model without a hand-curated twin ran as a single-shot
 * completion with the agent loop switched off. NVIDIA sorts first in the route
 * priority, so that was the default path for the free catalog.
 *
 * The fix is to stop treating absence of proof as proof of absence. Three states,
 * not two:
 *
 *  - **yes** — the catalog verified it. Offer tools.
 *  - **unknown** — nobody checked. Offer tools anyway; the provider is the only
 *    authority, and the router recovers from a rejection in one round trip.
 *  - **no** — a provider actually rejected them for this model. Believe that,
 *    and stop paying for the round trip.
 *
 * "no" is only ever *learned*, never assumed. It comes from a real 400 recorded
 * against a real request, which is why the negative is worth more than any
 * catalog claim: it describes the route that actually served the user.
 *
 * Pure. The store that holds the learned negatives lives in
 * `lib/store/tool-support-store.ts`; the retry that produces them lives in
 * `lib/router/index.ts`.
 */

import type { CatalogModel } from "@/lib/catalog/types";

export type ToolSupport = "yes" | "no" | "unknown";

/**
 * How long a learned negative is trusted.
 *
 * Bounded rather than permanent because providers add tool support to existing
 * models — NIM has done it repeatedly — and a cache that never expires would
 * turn one bad afternoon into a model that is permanently degraded for that user,
 * with no way to discover otherwise short of clearing site data.
 */
export const NEGATIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The learned negative wins over the catalog.
 *
 * Deliberately, and in both directions. A catalog `toolUse: true` that a provider
 * rejects is wrong about *this* route; a catalog `toolUse: false` is, as often as
 * not, `nvidia.ts` declining to guess. Only an observed rejection is evidence.
 */
export function toolSupportFor(
  model: CatalogModel | undefined,
  negatives: Record<string, number> = {},
  now: number = Date.now(),
): ToolSupport {
  if (!model) return "unknown";
  const learned = negatives[model.id];
  if (typeof learned === "number" && now - learned < NEGATIVE_TTL_MS) return "no";
  return model.capabilities.toolUse ? "yes" : "unknown";
}

/** Fail open: only a learned rejection withholds tools. */
export function shouldOfferTools(support: ToolSupport): boolean {
  return support !== "no";
}

/**
 * Whether a 400/422 is the provider objecting to `tools` specifically.
 *
 * Modelled on `rejectsStreamOptions` in `lib/router/index.ts`, but stricter. That
 * one can match on the field name alone because nothing else in a chat request is
 * called `stream_options`. "tool" appears in ordinary error prose — a malformed
 * `tool_call_id`, an unknown function name, a tool message with no matching call
 * — and misreading one of those as "this model has no tools" would teach a
 * permanent negative from a transient mistake. So both halves must match: the
 * field, and language that means the endpoint does not implement it.
 */
export function rejectsTools(status: number, body: string): boolean {
  if (status !== 400 && status !== 422) return false;
  if (!/\btools?\b|\btool_choice\b|\bfunction[_ ]?call/i.test(body)) return false;
  return /(not\s+support|unsupported|does\s+not\s+accept|no\s+support|unrecogni[sz]|unknown\s+(field|parameter|argument)|extra\s+inputs?\s+are\s+not\s+permitted|not\s+(allowed|permitted|available)|invalid[_ ]?(request[_ ]?)?(error)?.{0,40}\btools?\b)/i.test(
    body,
  );
}

/** Drop negatives past their TTL. Returns the same object when nothing expired. */
export function expireNegatives(
  negatives: Record<string, number>,
  now: number = Date.now(),
  ttlMs: number = NEGATIVE_TTL_MS,
): Record<string, number> {
  const live: Record<string, number> = {};
  let dropped = false;
  for (const [id, at] of Object.entries(negatives)) {
    if (now - at < ttlMs) live[id] = at;
    else dropped = true;
  }
  return dropped ? live : negatives;
}

/**
 * What the user is told when a turn ran without the tools it was offered.
 *
 * Never silent. A turn that quietly lost its tools looks exactly like a model
 * that chose not to use them, and the user's next move — asking again, more
 * firmly — cannot work.
 */
export const TOOL_DOWNGRADE_NOTE =
  "This model does not accept tools — answered without them.";
