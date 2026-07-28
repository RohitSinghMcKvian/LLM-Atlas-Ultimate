// Identity and value normalization shared by both provider adapters.
//
// The single most important rule in the sync pipeline lives here: a synced model
// is matched against the curated overlay by `matchKey`, and on a hit the merged
// model keeps the **curated id verbatim**. That is what preserves every existing
// `/chat?model=…` link, every persisted `activeModelId`, and every default-model
// constant across a catalog that is otherwise regenerated daily.

/**
 * Provider variant suffixes. These denote a different *serving tier* of the same
 * weights, not a different model, so they collapse into extra `routes[]` entries
 * on the base model rather than becoming catalog entries of their own.
 */
export const VARIANT_SUFFIXES = [
  ":free",
  ":thinking",
  ":extended",
  ":nitro",
  ":floor",
  ":online",
] as const;

/** Strip a known variant suffix. Returns the input unchanged when there is none. */
export function stripVariant(providerId: string): string {
  const colon = providerId.indexOf(":");
  if (colon === -1) return providerId;
  const suffix = providerId.slice(colon);
  return VARIANT_SUFFIXES.includes(suffix as (typeof VARIANT_SUFFIXES)[number])
    ? providerId.slice(0, colon)
    : providerId;
}

/** The variant suffix (`"free"`, `"nitro"`, …) or `undefined`. */
export function variantOf(providerId: string): string | undefined {
  const colon = providerId.indexOf(":");
  if (colon === -1) return undefined;
  const suffix = providerId.slice(colon);
  return VARIANT_SUFFIXES.includes(suffix as (typeof VARIANT_SUFFIXES)[number])
    ? suffix.slice(1)
    : undefined;
}

/**
 * A provider model id → an Atlas catalog id.
 *
 * `"openai/gpt-5.5"` → `"gpt-5-5"`, which is exactly the id the curated catalog
 * already uses. That alignment is deliberate: it means the overlay match usually
 * succeeds on the id alone, and the derived id is a sensible public URL when it
 * doesn't.
 */
export function atlasId(providerId: string): string {
  const withoutVariant = stripVariant(providerId);
  const lastSlash = withoutVariant.lastIndexOf("/");
  const bare = lastSlash === -1 ? withoutVariant : withoutVariant.slice(lastSlash + 1);

  return bare
    .toLowerCase()
    .replace(/[._\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Naming noise that carries no identity — dropped before matching. Deliberately
// excludes `-preview`: `gemini-3-pro-preview` and `gemini-3-pro` are frequently
// distinct models with distinct pricing, and collapsing them would merge two
// real entries.
const MATCH_NOISE = /-(instruct|it|chat|hf|latest)$/;

/**
 * A loose key for matching the *same* model across providers and against the
 * curated overlay. Never use it as a public id: it is lossy by design
 * (`"llama-3-3-70b-instruct"` and `"llama-3.3-70b"` both key to `llama3370b`).
 */
export function matchKey(providerIdOrAtlasId: string): string {
  let id = atlasId(providerIdOrAtlasId);
  // Suffixes can stack: "...-instruct-hf".
  for (let i = 0; i < 3; i++) {
    const next = id.replace(MATCH_NOISE, "");
    if (next === id) break;
    id = next;
  }
  return id.replace(/[^a-z0-9]/g, "");
}

/**
 * Round to 6 decimal places.
 *
 * Mandatory for pricing: OpenRouter quotes per-token USD as strings, and
 * `Number("0.0000003") * 1e6` is `0.30000000000000004`, which both bloats the
 * serialized payload and makes every snapshot hash differ from the last.
 */
export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Per-token USD string → USD per 1M tokens. Non-numeric input becomes 0. */
export function perMillion(perToken: string | number | null | undefined): number {
  const n = typeof perToken === "number" ? perToken : Number(perToken);
  if (!Number.isFinite(n) || n < 0) return 0;
  return round6(n * 1e6);
}

const MAX_BLURB = 180;

/**
 * First sentence of a provider description, capped.
 *
 * OpenRouter descriptions run 500–1500 characters of markdown with embedded
 * links. Unclamped they are the single largest contributor to the client
 * payload — 345 of them outweigh every other field combined.
 */
export function clampBlurb(description: string | null | undefined): string {
  if (!description) return "";

  const flat = description
    // Markdown links → their label.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!flat) return "";

  // Prefer a sentence boundary, but only if it yields something substantial —
  // otherwise a leading abbreviation would truncate the whole blurb.
  const sentence = flat.match(/^.*?[.!?](?=\s|$)/)?.[0];
  const base = sentence && sentence.length >= 40 ? sentence : flat;
  if (base.length <= MAX_BLURB) return base.trim();

  const cut = base.slice(0, MAX_BLURB);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/** Unix seconds → `YYYY-MM-DD`. Falls back to `fallback` for junk input. */
export function isoDate(unixSeconds: number | null | undefined, fallback: string): string {
  if (!unixSeconds || !Number.isFinite(unixSeconds)) return fallback;
  const ms = unixSeconds * 1000;
  // Guard against both seconds/millis confusion and absurd values.
  if (ms < Date.parse("2015-01-01") || ms > Date.now() + 365 * 86_400_000) return fallback;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * FNV-1a, 32-bit, as 8 lowercase hex chars.
 *
 * Used to version a snapshot by content: identical upstream data produces an
 * identical version, which lets `installSnapshot` no-op and skip re-rendering
 * every catalog consumer on a sync that changed nothing.
 */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
