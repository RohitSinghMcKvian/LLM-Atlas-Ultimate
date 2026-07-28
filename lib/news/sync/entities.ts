import type { CatalogSnapshot } from "@/lib/catalog/snapshot";
import type { CatalogModel } from "@/lib/catalog/types";
import { resolveModelId } from "@/lib/catalog/resolve";

// Linking articles to the model catalog.
//
// This is what makes the news feed part of Atlas rather than an RSS reader
// bolted onto it: a story about Nova 3 carries a chip that opens the model in
// /compare, and the "What changed" rail can join real catalog movement to the
// coverage of it.
//
// THE INVARIANT THIS FILE EXISTS TO GUARANTEE
//
// Every id emitted here has been through `resolveModelId` against the snapshot
// that was live at sync time. The retired `lib/news/data.ts` carried
// hand-written ids, two of which (`deepseek-r1`, `mistral-large-2`) had gone
// stale and rendered as dead chips with nothing to signal the reference was
// broken; `data.test.ts` existed solely to catch that. Here the class of bug is
// structural rather than tested-for — an unresolvable name simply produces no
// chip.

/** A story is about a handful of models at most; more than this is a listicle. */
export const MAX_MODELS = 4;
export const MAX_ORGS = 4;

/**
 * Organisations worth recognising, with the aliases press actually writes.
 *
 * Keyed by the canonical name so it lines up with `CatalogModel.provider`, which
 * is what the rail and the source filter group by.
 */
const ORG_ALIASES: Record<string, string[]> = {
  OpenAI: ["openai", "open ai"],
  Anthropic: ["anthropic"],
  Google: ["google", "google deepmind", "deepmind", "google research", "alphabet"],
  Meta: ["meta", "meta ai", "facebook ai", "fair"],
  Microsoft: ["microsoft", "msft", "microsoft research"],
  NVIDIA: ["nvidia"],
  Mistral: ["mistral", "mistral ai"],
  DeepSeek: ["deepseek"],
  Alibaba: ["alibaba", "qwen team"],
  xAI: ["xai", "x.ai"],
  Cohere: ["cohere"],
  "Hugging Face": ["hugging face", "huggingface"],
  Amazon: ["amazon", "aws", "amazon web services"],
  Apple: ["apple"],
  IBM: ["ibm"],
  "Stability AI": ["stability ai", "stability.ai"],
  "AI21": ["ai21", "ai21 labs"],
  Perplexity: ["perplexity"],
  Groq: ["groq"],
  Together: ["together ai", "together.ai"],
  Baidu: ["baidu"],
  Tencent: ["tencent"],
  Moonshot: ["moonshot", "moonshot ai", "kimi"],
  Zhipu: ["zhipu", "zhipu ai", "z.ai"],
  Reka: ["reka"],
  Databricks: ["databricks", "mosaicml"],
  Snowflake: ["snowflake"],
  Allen: ["allen institute", "ai2", "allenai"],
};

function boundary(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Model names are full of punctuation and version numbers ("Claude Opus 4.8",
  // "GPT-5.5"), so spaces, hyphens and dots are treated as interchangeable
  // separators — press writes all three.
  const body = escaped.replace(/[\s\-.]+/g, "[\\s\\-.]+");
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, "i");
}

const ORG_PATTERNS: { org: string; re: RegExp }[] = Object.entries(ORG_ALIASES).flatMap(
  ([org, aliases]) => aliases.map((alias) => ({ org, re: boundary(alias) })),
);

/**
 * Model names too generic to link on their own.
 *
 * "Llama" alone is a family, not a model, and linking it to whichever Llama
 * happens to sort first is a confidently wrong answer. These require a version
 * number alongside them, which the name matcher gets for free by only matching
 * full catalog names.
 */
const AMBIGUOUS_NAMES = new Set([
  "llama", "gemma", "mistral", "claude", "gemini", "gpt", "qwen", "phi", "grok",
  "command", "nova", "titan", "jamba", "yi", "glm", "kimi", "sonnet", "opus",
  "haiku", "pro", "flash", "mini", "turbo", "ultra", "large", "small", "medium",
  "instruct", "chat", "base", "vision", "coder", "math", "reasoner", "thinking",
]);

interface ModelMatcher {
  id: string;
  re: RegExp;
  /** Longer names win, so "Claude Opus 4.8" beats "Claude Opus". */
  length: number;
}

/**
 * Build the matcher set for a snapshot.
 *
 * Cached on the snapshot object itself via a WeakMap, mirroring the derivation
 * caches in `lib/catalog/index.ts`: a new snapshot is a new identity and
 * therefore a cache miss, so the cache can go cold but never stale.
 */
const MATCHER_CACHE = new WeakMap<CatalogSnapshot, ModelMatcher[]>();

function matchersFor(snapshot: CatalogSnapshot): ModelMatcher[] {
  const cached = MATCHER_CACHE.get(snapshot);
  if (cached) return cached;

  const matchers: ModelMatcher[] = [];
  for (const model of snapshot.models) {
    for (const name of candidateNames(model)) {
      if (name.length < 5) continue;
      if (AMBIGUOUS_NAMES.has(name.toLowerCase())) continue;
      matchers.push({ id: model.id, re: boundary(name), length: name.length });
    }
  }

  // Longest first: the first match wins, and a specific name must not be
  // shadowed by a prefix of itself.
  matchers.sort((a, b) => b.length - a.length);
  MATCHER_CACHE.set(snapshot, matchers);
  return matchers;
}

/** The strings a publisher might plausibly use for this model. */
function candidateNames(model: CatalogModel): string[] {
  const names = new Set<string>();
  names.add(model.name);

  // Drop a leading brand that press usually omits: "Anthropic Claude Opus 4.8"
  // is written "Claude Opus 4.8".
  const withoutBrand = model.name.replace(new RegExp(`^${model.provider}\\s+`, "i"), "").trim();
  if (withoutBrand && withoutBrand !== model.name) names.add(withoutBrand);

  // The id itself, hyphens and all — some posts write "gpt-5.5" verbatim.
  names.add(model.id.replace(/-/g, " "));

  return [...names].filter(Boolean);
}

export interface EntityResult {
  models: string[];
  orgs: string[];
}

/**
 * Extract catalog model ids and organisation names from an article.
 *
 * `title` is matched with priority over `body`: a model named in the headline is
 * what the story is about, whereas one named in the body may be a comparison.
 */
export function extractEntities(
  title: string,
  body: string,
  snapshot: CatalogSnapshot,
): EntityResult {
  // A long body is mostly context by the time it reaches here, and scanning all
  // of it against ~400 matchers per article is the hot loop of the whole sync.
  const haystackTitle = title ?? "";
  const haystackBody = (body ?? "").slice(0, 2_000);
  const combined = `${haystackTitle}\n${haystackBody}`;
  if (!combined.trim()) return { models: [], orgs: [] };

  const found: { id: string; inTitle: boolean; length: number }[] = [];
  const seen = new Set<string>();

  for (const matcher of matchersFor(snapshot)) {
    if (seen.has(matcher.id)) continue;
    const inTitle = matcher.re.test(haystackTitle);
    if (!inTitle && !matcher.re.test(haystackBody)) continue;

    // The invariant. An id that no longer resolves produces no chip at all,
    // rather than a chip that goes nowhere.
    const resolved = resolveModelId(matcher.id);
    if (!resolved) continue;
    if (seen.has(resolved)) continue;

    seen.add(matcher.id);
    seen.add(resolved);
    found.push({ id: resolved, inTitle, length: matcher.length });
  }

  const models = found
    .sort((a, b) => Number(b.inTitle) - Number(a.inTitle) || b.length - a.length)
    .slice(0, MAX_MODELS)
    .map((m) => m.id);

  const orgs: string[] = [];
  for (const { org, re } of ORG_PATTERNS) {
    if (orgs.includes(org)) continue;
    if (re.test(combined)) orgs.push(org);
    if (orgs.length >= MAX_ORGS) break;
  }

  return { models, orgs };
}

/** Canonical organisation name for an alias, or undefined. */
export function canonicalOrg(name: string): string | undefined {
  const needle = name.trim().toLowerCase();
  for (const [org, aliases] of Object.entries(ORG_ALIASES)) {
    if (org.toLowerCase() === needle || aliases.includes(needle)) return org;
  }
  return undefined;
}
