import type { FreeTier, ProviderMeta } from "./providers";

// Turning a `FreeTier` descriptor into the words a user actually reads.
//
// This lives on its own, and is pure, because the same sentence has to appear in
// at least three places — the Vault connect row, the model picker's badge, and
// the 402/429 copy — and three hand-written variants would drift into three
// different claims about the same tier. It is also the layer where the honesty
// rule in `quota.kind` becomes visible: `"recurring"` may say **Free**,
// `"grant"` must say **Credits**, and nothing else is allowed to decide that.
//
// Deliberately no React and no formatting classes: callers style it.

/** How a lane should be labelled, in one word. */
export type TierLabel = "Free" | "Credits" | "Your key";

/**
 * The badge word for a provider.
 *
 * A provider with no free tier at all (Anthropic, OpenAI) is "Your key" — it is
 * usable, just never free, and saying so plainly is the entire point of the
 * honest-labelling decision.
 */
export function tierLabel(meta: ProviderMeta): TierLabel {
  // The user's own machine is the one lane with no credential and no ceiling.
  if (meta.id === "local") return "Free";
  const kind = meta.freeTier?.quota.kind;
  if (kind === "recurring") return "Free";
  if (kind === "grant") return "Credits";
  return "Your key";
}

/** `1000` → `"1,000"`; `1_000_000_000` → `"1B"`. Keeps limits readable. */
function compact(n: number): string {
  if (n >= 1_000_000_000) return `${trimZero(n / 1_000_000_000)}B`;
  if (n >= 1_000_000) return `${trimZero(n / 1_000_000)}M`;
  return n.toLocaleString("en-US");
}

function trimZero(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}

/**
 * The rate limits, as short phrases: `["30 req/min", "1,000 req/day"]`.
 *
 * Ordered tightest-window-first, because the per-minute ceiling is the one a
 * user actually notices, and a list that opened with a monthly figure would
 * bury it.
 */
export function tierLimits(tier: FreeTier): string[] {
  const q = tier.quota;
  const out: string[] = [];
  if (q.rpm) out.push(`${compact(q.rpm)} req/min`);
  if (q.rpd) out.push(`${compact(q.rpd)} req/day`);
  if (q.tpm) out.push(`${compact(q.tpm)} tok/min`);
  if (q.tpd) out.push(`${compact(q.tpd)} tok/day`);
  if (q.tpMonth) out.push(`${compact(q.tpMonth)} tok/month`);
  if (q.creditsUsd) out.push(`$${compact(q.creditsUsd)} credit`);
  return out;
}

/**
 * One line describing what a provider gives away, in plain words.
 *
 * Examples:
 *   Groq       → "Free forever · 30 req/min · 1,000 req/day · no card"
 *   Cerebras   → "Credits, then paid · $5 credit · card required"
 *   Anthropic  → "No free tier — runs on your own key"
 *
 * The card requirement and any data-sharing condition are surfaced here rather
 * than buried in a tooltip: both are the actual price of a "free" tier, and a
 * user deciding which provider to connect is exactly who needs to know.
 */
export function tierSummary(meta: ProviderMeta): string {
  // Local is not a hosted service: there is no tier, no key and no limit,
  // which the generic branches below have no way to say.
  if (meta.id === "local") return "Runs on your own machine — no key, no limits";

  const tier = meta.freeTier;
  if (!tier) {
    return meta.billing === "operator-funded"
      ? "Runs on the operator's key"
      : "No free tier — runs on your own key";
  }

  const parts: string[] = [
    tier.quota.kind === "recurring" ? "Free forever" : "Credits, then paid",
    ...tierLimits(tier),
    tier.cardRequired ? "card required" : "no card",
  ];
  // Only worth saying when it is a real condition. "none" is the default
  // expectation, so stating it adds noise rather than reassurance.
  if (tier.dataSharing === "required") parts.push("shares your prompts");
  else if (tier.dataSharing === "optional") parts.push("opt-in data sharing");

  return parts.join(" · ");
}

/**
 * Whether this provider is worth offering as a "connect this to get free
 * models" suggestion — a genuinely recurring tier that costs nothing to start.
 *
 * A card requirement disqualifies it: asking for card details is not a free
 * tier in the sense a user means when they click "get free models".
 */
export function isEasyFreeLane(meta: ProviderMeta): boolean {
  const tier = meta.freeTier;
  return Boolean(tier && tier.quota.kind === "recurring" && !tier.cardRequired);
}
