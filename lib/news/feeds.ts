import type { NewsTopic } from "./types";

// The source registry.
//
// Every feed here is a publicly documented RSS/Atom endpoint that needs no key,
// which is what makes Atlas News work the moment the repo is cloned — the same
// promise `lib/catalog/baseline.ts` makes for the model catalog. Optional keyed
// providers (NewsAPI, GNews) layer on top in `sync/adapters/`, they never
// replace this.
//
// TIERS AND WHY THEY EXIST
//
// `tier` is not decoration — it feeds `lib/news/sync/verify.ts` directly. An
// item can only reach the `verified` level if it came from a `first_party` feed
// AND its canonical link is on that publisher's own domain, or if the story is
// corroborated across domains and at least one of those is first-party. So the
// registry is the trust root: a wrong `domains` entry silently downgrades every
// article from that source forever, which is exactly what `feeds.test.ts` #4
// checks for.
//
// KNOWN GAP: ANTHROPIC
//
// Anthropic publishes no stable first-party RSS/Atom feed. The honest options
// were (a) point at a third-party mirror, or (b) leave the gap. A mirror would
// be actively harmful here: the item's canonical link would not be on
// anthropic.com, `publisher_domain_match` would fail, and `verify.ts` would
// stamp it `unconfirmed` — worse than no first-party entry at all, because the
// UI would show Anthropic news looking less trustworthy than everyone else's.
// So Anthropic is covered through the press and analyst tiers, where it
// correctly reads as `corroborated` rather than `verified`, and through the
// optional keyed layer. Revisit if a first-party feed appears.

export type FeedTier = "first_party" | "research" | "press" | "analyst";

export interface FeedSource {
  /** Stable slug. Appears in URL filter state, so renaming one breaks shared links. */
  id: string;
  name: string;
  url: string;
  /** Used to resolve relative links in the feed, and linked from the source filter. */
  homepage: string;
  tier: FeedTier;
  /**
   * The brand this source speaks *for*. Set only when the feed is that brand's
   * own channel — it is what makes an item a first-party announcement rather
   * than coverage of one.
   */
  brand?: string;
  /** 0..1 base trust, folded into `baseScore` and the verification score. */
  weight: number;
  /**
   * Registrable domains this source may canonically link to. An article whose
   * link lands outside this set is republished content, and `verify.ts` caps it
   * at `unconfirmed` regardless of tier.
   *
   * Subdomains match implicitly (`developers.googleblog.com` is covered by
   * `googleblog.com`), so list the registrable domain, not the host.
   */
  domains: string[];
  /** Topics every item from this feed starts with. Seeds, not overrides. */
  topicHint?: NewsTopic[];
  /** General-tech feeds must pass the AI-relevance gate in `topics.ts`. */
  requiresAiFilter?: boolean;
  /**
   * One-line kill switch for a feed that has rotted. Left explicit rather than
   * deleting the entry, so the next person can see what was tried and why.
   */
  enabled?: boolean;
  /**
   * Aggregator feeds (Google News etc.) whose links are redirect shims. They can
   * corroborate a story but may never lead a cluster, because their "domain" is
   * the aggregator's, not a publisher's. Off unless ATLAS_NEWS_AGGREGATORS=true.
   */
  aggregator?: boolean;
}

// ── Tier 1 — first-party vendor and lab channels ────────────────────────────
//
// The announcement itself, on the announcer's own domain. These are the only
// sources that can produce a `verified` item on their own.

const FIRST_PARTY: FeedSource[] = [
  {
    id: "openai",
    name: "OpenAI",
    url: "https://openai.com/news/rss.xml",
    homepage: "https://openai.com/news/",
    tier: "first_party",
    brand: "OpenAI",
    weight: 1,
    domains: ["openai.com"],
    topicHint: ["models"],
  },
  {
    id: "deepmind",
    name: "Google DeepMind",
    url: "https://deepmind.google/blog/rss.xml",
    homepage: "https://deepmind.google/discover/blog/",
    tier: "first_party",
    brand: "Google",
    weight: 1,
    domains: ["deepmind.google", "deepmind.com"],
    topicHint: ["research"],
  },
  {
    id: "google-research",
    name: "Google Research",
    url: "https://research.google/blog/rss/",
    homepage: "https://research.google/blog/",
    tier: "first_party",
    brand: "Google",
    weight: 0.95,
    // `.google` is a real TLD, so `research.google` IS the registrable domain.
    domains: ["research.google"],
    topicHint: ["research"],
  },
  {
    id: "google-dev",
    name: "Google Developers",
    url: "https://developers.googleblog.com/feeds/posts/default",
    homepage: "https://developers.googleblog.com/",
    tier: "first_party",
    brand: "Google",
    weight: 0.95,
    domains: ["googleblog.com", "blog.google", "google.dev"],
    topicHint: ["tools"],
    requiresAiFilter: true,
  },
  {
    id: "meta-ai",
    name: "Meta Newsroom",
    // `ai.meta.com/blog/rss/` 404s as of 2026-07-28 — Meta retired the AI blog's
    // dedicated feed. The corporate newsroom is the remaining first-party
    // channel, so it carries the AI filter: most of what it publishes is not AI.
    url: "https://about.fb.com/news/feed/",
    homepage: "https://about.fb.com/news/",
    tier: "first_party",
    brand: "Meta",
    weight: 0.95,
    domains: ["fb.com", "meta.com"],
    topicHint: ["models", "open-source"],
    requiresAiFilter: true,
  },
  {
    id: "google-ai-blog",
    name: "Google — The Keyword (AI)",
    // Moved under /innovation-and-ai/ in 2026. The old path 301s, and the
    // fetcher does not follow redirects, so this reported as a dead source.
    url: "https://blog.google/innovation-and-ai/technology/ai/rss/",
    homepage: "https://blog.google/innovation-and-ai/technology/ai/",
    tier: "first_party",
    brand: "Google",
    weight: 0.95,
    domains: ["blog.google"],
    topicHint: ["models"],
  },
  {
    id: "aws-ml",
    name: "AWS Machine Learning",
    url: "https://aws.amazon.com/blogs/machine-learning/feed/",
    homepage: "https://aws.amazon.com/blogs/machine-learning/",
    tier: "first_party",
    brand: "Amazon",
    weight: 0.85,
    domains: ["amazon.com"],
    topicHint: ["infrastructure", "tools"],
  },
  {
    id: "qwen",
    name: "Qwen",
    // Qwen publishes from a GitHub Pages site. `domains` is the exact host
    // rather than the registrable domain (`github.io`), so the publisher check
    // stays precise — otherwise every GitHub Pages site would satisfy it.
    url: "https://qwenlm.github.io/blog/index.xml",
    homepage: "https://qwenlm.github.io/blog/",
    tier: "first_party",
    brand: "Alibaba",
    weight: 0.9,
    domains: ["qwenlm.github.io"],
    topicHint: ["models", "open-source"],
  },
  {
    id: "microsoft-research",
    name: "Microsoft Research",
    url: "https://www.microsoft.com/en-us/research/feed/",
    homepage: "https://www.microsoft.com/en-us/research/blog/",
    tier: "first_party",
    brand: "Microsoft",
    weight: 0.95,
    domains: ["microsoft.com"],
    topicHint: ["research"],
    requiresAiFilter: true,
  },
  {
    id: "nvidia-dev",
    name: "NVIDIA Developer",
    url: "https://developer.nvidia.com/blog/feed/",
    homepage: "https://developer.nvidia.com/blog/",
    tier: "first_party",
    brand: "NVIDIA",
    weight: 0.9,
    domains: ["nvidia.com"],
    topicHint: ["infrastructure"],
    requiresAiFilter: true,
  },
  {
    id: "nvidia-news",
    name: "NVIDIA Newsroom",
    url: "https://nvidianews.nvidia.com/releases.xml",
    homepage: "https://nvidianews.nvidia.com/",
    tier: "first_party",
    brand: "NVIDIA",
    weight: 0.9,
    domains: ["nvidia.com"],
    topicHint: ["infrastructure"],
    requiresAiFilter: true,
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    url: "https://huggingface.co/blog/feed.xml",
    homepage: "https://huggingface.co/blog",
    tier: "first_party",
    brand: "Hugging Face",
    weight: 0.95,
    domains: ["huggingface.co"],
    topicHint: ["open-source"],
  },
  {
    id: "mistral",
    name: "Mistral AI",
    url: "https://mistral.ai/news/feed.xml",
    homepage: "https://mistral.ai/news/",
    tier: "first_party",
    brand: "Mistral",
    weight: 1,
    domains: ["mistral.ai"],
    topicHint: ["models"],
    // feed.xml 404s and the host refuses our requests entirely (checked 2026-07-28).
    // Re-enable the moment a working feed reappears.
    enabled: false,
  },
  {
    id: "cohere",
    name: "Cohere",
    url: "https://cohere.com/blog/rss.xml",
    homepage: "https://cohere.com/blog",
    tier: "first_party",
    brand: "Cohere",
    weight: 0.95,
    domains: ["cohere.com", "cohere.ai"],
    topicHint: ["models"],
    // Redirects to an HTML blog index; no feed served (checked 2026-07-28).
    // Re-enable the moment a working feed reappears.
    enabled: false,
  },
  {
    id: "together",
    name: "Together AI",
    url: "https://www.together.ai/blog/rss.xml",
    homepage: "https://www.together.ai/blog",
    tier: "first_party",
    brand: "Together",
    weight: 0.85,
    domains: ["together.ai", "together.xyz"],
    topicHint: ["infrastructure", "open-source"],
  },
  {
    id: "groq",
    name: "Groq",
    url: "https://groq.com/feed/",
    homepage: "https://groq.com/blog/",
    tier: "first_party",
    brand: "Groq",
    weight: 0.85,
    domains: ["groq.com"],
    topicHint: ["infrastructure"],
    // Redirects to an HTML page; the WordPress feed was retired (checked 2026-07-28).
    // Re-enable the moment a working feed reappears.
    enabled: false,
  },
  {
    id: "stability",
    name: "Stability AI",
    url: "https://stability.ai/news?format=rss",
    homepage: "https://stability.ai/news",
    tier: "first_party",
    brand: "Stability AI",
    weight: 0.85,
    domains: ["stability.ai"],
    topicHint: ["multimodal"],
    // The ?format=rss endpoint now redirects to an HTML page (checked 2026-07-28).
    // Re-enable the moment a working feed reappears.
    enabled: false,
  },
  {
    id: "langchain",
    name: "LangChain",
    url: "https://blog.langchain.dev/rss/",
    homepage: "https://blog.langchain.dev/",
    tier: "first_party",
    brand: "LangChain",
    weight: 0.8,
    domains: ["langchain.dev", "langchain.com"],
    topicHint: ["agents", "tools"],
    // blog.langchain.dev now redirects to langchain.com/blog/rss, which serves HTML (checked 2026-07-28).
    // Re-enable the moment a working feed reappears.
    enabled: false,
  },
  {
    id: "vllm",
    name: "vLLM",
    url: "https://blog.vllm.ai/feed.xml",
    homepage: "https://blog.vllm.ai/",
    tier: "first_party",
    brand: "vLLM",
    weight: 0.85,
    domains: ["vllm.ai"],
    topicHint: ["infrastructure", "open-source"],
    // blog.vllm.ai redirects to vllm.ai/feed.xml, which 404s (checked 2026-07-28).
    // Re-enable the moment a working feed reappears.
    enabled: false,
  },
  {
    id: "pytorch",
    name: "PyTorch",
    url: "https://pytorch.org/blog/feed.xml",
    homepage: "https://pytorch.org/blog/",
    tier: "first_party",
    brand: "PyTorch",
    weight: 0.85,
    domains: ["pytorch.org"],
    topicHint: ["open-source", "tools"],
  },
  // ANTHROPIC — see the "KNOWN GAP" note at the top of this file. No stable
  // first-party feed exists; a mirror would fail `publisher_domain_match` and
  // make Anthropic news read as LESS trustworthy than everyone else's. Coverage
  // comes from the press tier instead. Add here the moment one ships:
  // {
  //   id: "anthropic", name: "Anthropic", url: "<first-party feed>",
  //   homepage: "https://www.anthropic.com/news", tier: "first_party",
  //   brand: "Anthropic", weight: 1, domains: ["anthropic.com"],
  // },
];

// ── Tier 2 — research ───────────────────────────────────────────────────────
//
// Preprints and lab blogs. arXiv gets `research_preprint` treatment in
// `verify.ts` — a paper on arxiv.org IS the primary document, so it reaches
// `verified` on its own even though arXiv is nobody's press office.

const RESEARCH: FeedSource[] = [
  {
    id: "arxiv-cs-ai",
    name: "arXiv cs.AI",
    url: "https://rss.arxiv.org/rss/cs.AI",
    homepage: "https://arxiv.org/list/cs.AI/recent",
    tier: "research",
    weight: 0.85,
    domains: ["arxiv.org"],
    topicHint: ["research"],
  },
  {
    id: "arxiv-cs-cl",
    name: "arXiv cs.CL",
    url: "https://rss.arxiv.org/rss/cs.CL",
    homepage: "https://arxiv.org/list/cs.CL/recent",
    tier: "research",
    weight: 0.85,
    domains: ["arxiv.org"],
    topicHint: ["research"],
  },
  {
    id: "arxiv-cs-lg",
    name: "arXiv cs.LG",
    url: "https://rss.arxiv.org/rss/cs.LG",
    homepage: "https://arxiv.org/list/cs.LG/recent",
    tier: "research",
    weight: 0.85,
    domains: ["arxiv.org"],
    topicHint: ["research"],
  },
  {
    id: "bair",
    name: "Berkeley AI Research",
    url: "https://bair.berkeley.edu/blog/feed.xml",
    homepage: "https://bair.berkeley.edu/blog/",
    tier: "research",
    weight: 0.85,
    domains: ["berkeley.edu"],
    topicHint: ["research"],
  },
  {
    id: "mit-news-ai",
    name: "MIT News — AI",
    url: "https://news.mit.edu/rss/topic/artificial-intelligence2",
    homepage: "https://news.mit.edu/topic/artificial-intelligence2",
    tier: "research",
    weight: 0.8,
    domains: ["mit.edu"],
    topicHint: ["research"],
  },
  {
    id: "stanford-hai",
    name: "Stanford HAI",
    url: "https://hai.stanford.edu/news/rss.xml",
    homepage: "https://hai.stanford.edu/news",
    tier: "research",
    weight: 0.8,
    domains: ["stanford.edu"],
    topicHint: ["research", "policy"],
    // Returns HTTP 200 with an empty body (checked 2026-07-28).
    // Re-enable the moment a working feed reappears.
    enabled: false,
  },
  {
    id: "allenai",
    name: "Allen Institute for AI",
    url: "https://allenai.org/rss.xml",
    homepage: "https://allenai.org/blog",
    tier: "research",
    weight: 0.85,
    domains: ["allenai.org"],
    topicHint: ["research", "open-source"],
  },
  {
    id: "eleuther",
    name: "EleutherAI",
    url: "https://blog.eleuther.ai/index.xml",
    homepage: "https://blog.eleuther.ai/",
    tier: "research",
    weight: 0.8,
    domains: ["eleuther.ai"],
    topicHint: ["research", "open-source"],
  },
];

// ── Tier 3 — press ──────────────────────────────────────────────────────────
//
// Coverage, not announcement. Two press sources on different domains reporting
// the same thing is what `corroborated` means. Several of these are general
// technology sections, so they carry `requiresAiFilter`.

const PRESS: FeedSource[] = [
  {
    id: "techcrunch-ai",
    name: "TechCrunch AI",
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
    homepage: "https://techcrunch.com/category/artificial-intelligence/",
    tier: "press",
    weight: 0.7,
    domains: ["techcrunch.com"],
  },
  {
    id: "theverge-ai",
    name: "The Verge AI",
    url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    homepage: "https://www.theverge.com/ai-artificial-intelligence",
    tier: "press",
    weight: 0.7,
    domains: ["theverge.com"],
  },
  {
    id: "arstechnica-ai",
    name: "Ars Technica AI",
    url: "https://feeds.arstechnica.com/arstechnica/technology-lab",
    homepage: "https://arstechnica.com/ai/",
    tier: "press",
    weight: 0.7,
    domains: ["arstechnica.com"],
    requiresAiFilter: true,
  },
  {
    id: "venturebeat-ai",
    name: "VentureBeat AI",
    url: "https://venturebeat.com/category/ai/feed/",
    homepage: "https://venturebeat.com/category/ai/",
    tier: "press",
    weight: 0.65,
    domains: ["venturebeat.com"],
  },
  {
    id: "techreview-ai",
    name: "MIT Technology Review",
    url: "https://www.technologyreview.com/topic/artificial-intelligence/feed",
    homepage: "https://www.technologyreview.com/topic/artificial-intelligence/",
    tier: "press",
    weight: 0.7,
    domains: ["technologyreview.com"],
  },
  {
    id: "theregister-ai",
    name: "The Register AI",
    url: "https://www.theregister.com/software/ai_ml/headlines.atom",
    homepage: "https://www.theregister.com/software/ai_ml/",
    tier: "press",
    weight: 0.65,
    domains: ["theregister.com"],
  },
  {
    id: "wired-ai",
    name: "WIRED AI",
    url: "https://www.wired.com/feed/tag/ai/latest/rss",
    homepage: "https://www.wired.com/tag/artificial-intelligence/",
    tier: "press",
    weight: 0.65,
    domains: ["wired.com"],
  },
  {
    id: "ieee-spectrum-ai",
    name: "IEEE Spectrum AI",
    url: "https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss",
    homepage: "https://spectrum.ieee.org/topic/artificial-intelligence/",
    tier: "press",
    weight: 0.7,
    domains: ["ieee.org"],
  },
  {
    id: "zdnet-ai",
    name: "ZDNET AI",
    url: "https://www.zdnet.com/topic/artificial-intelligence/rss.xml",
    homepage: "https://www.zdnet.com/topic/artificial-intelligence/",
    tier: "press",
    weight: 0.55,
    domains: ["zdnet.com"],
    // ZDNET's AI section carries a lot of commerce content. Without this gate a
    // live sync pulled in "Costco will take your old tech and gift you a gift
    // card", which is not AI news by any reading.
    requiresAiFilter: true,
    // Retired by the publisher, not by us. Measured 2026-09-04: this URL answers
    // 301 to https://www.zdnet.com/news/rss.xml, which answers 404; so do
    // /rss.xml, /topic/ai/rss.xml and /blog/rss.xml; and the homepage advertises
    // no `application/rss+xml` autodiscovery link at all. There is nothing left
    // to point at.
    //
    // Left as a disabled entry rather than deleted, per the note on `enabled`:
    // the next person to wonder where ZDNET went can see what was tried. Turn it
    // back on the day they publish a feed again — the only cost of it being here
    // is this comment.
    enabled: false,
  },
];

// ── Tier 4 — analyst ────────────────────────────────────────────────────────
//
// Independent, opinionated, and frequently the first to notice something. Rated
// above general press but below a lab's own announcement.

const ANALYST: FeedSource[] = [
  {
    id: "import-ai",
    name: "Import AI",
    url: "https://importai.substack.com/feed",
    homepage: "https://importai.substack.com/",
    tier: "analyst",
    weight: 0.7,
    domains: ["substack.com"],
    topicHint: ["research", "policy"],
  },
  {
    id: "simonwillison",
    name: "Simon Willison",
    url: "https://simonwillison.net/atom/everything/",
    homepage: "https://simonwillison.net/",
    tier: "analyst",
    weight: 0.7,
    domains: ["simonwillison.net"],
    requiresAiFilter: true,
  },
  {
    id: "the-batch",
    name: "The Batch — DeepLearning.AI",
    url: "https://www.deeplearning.ai/the-batch/feed/",
    homepage: "https://www.deeplearning.ai/the-batch/",
    tier: "analyst",
    weight: 0.7,
    domains: ["deeplearning.ai"],
    // The /feed endpoint 404s (checked 2026-07-28).
    // Re-enable the moment a working feed reappears.
    enabled: false,
  },
];

// ── Aggregators (opt-in) ────────────────────────────────────────────────────
//
// Google News query feeds are excellent recall and terrible provenance: every
// link is a news.google.com redirect, so `canonical_link` resolves to the
// aggregator rather than the publisher, and letting those hosts into the image
// allowlist would widen the proxy's attack surface for no benefit. Enabled only
// by ATLAS_NEWS_AGGREGATORS=true, and never allowed to lead a cluster.

const AGGREGATORS: FeedSource[] = [
  {
    id: "gnews-ai",
    name: "Google News — AI",
    url: "https://news.google.com/rss/search?q=artificial+intelligence+when:1d&hl=en-US&gl=US&ceid=US:en",
    homepage: "https://news.google.com/",
    tier: "press",
    weight: 0.35,
    domains: ["google.com"],
    aggregator: true,
  },
  {
    id: "gnews-llm",
    name: "Google News — LLMs",
    url: "https://news.google.com/rss/search?q=large+language+model+OR+LLM+when:1d&hl=en-US&gl=US&ceid=US:en",
    homepage: "https://news.google.com/",
    tier: "press",
    weight: 0.35,
    domains: ["google.com"],
    aggregator: true,
  },
];

/** Every registered feed, aggregators included. Order is tier-major. */
export const NEWS_FEEDS: readonly FeedSource[] = [
  ...FIRST_PARTY,
  ...RESEARCH,
  ...ANALYST,
  ...PRESS,
  ...AGGREGATORS,
];

export const FEED_MAP: ReadonlyMap<string, FeedSource> = new Map(
  NEWS_FEEDS.map((f) => [f.id, f]),
);

export function getFeed(id: string): FeedSource | undefined {
  return FEED_MAP.get(id);
}

/**
 * Fetch order for one sync.
 *
 * Tier-major and deliberately so: the whole sweep runs under a global abort, and
 * if it fires we want the first-party announcements already in hand rather than
 * a complete set of press coverage about announcements we missed.
 */
const TIER_ORDER: Record<FeedTier, number> = {
  first_party: 0,
  research: 1,
  analyst: 2,
  press: 3,
};

/**
 * The feeds a sync should actually poll, in fetch order.
 *
 * `env` is a plain string dictionary rather than `NodeJS.ProcessEnv`: Next's
 * ambient declaration makes `NODE_ENV` required, which would force every test to
 * construct a whole fake environment just to flip one flag.
 */
export function activeFeeds(
  env: Record<string, string | undefined> = process.env,
): FeedSource[] {
  const allowAggregators = env.ATLAS_NEWS_AGGREGATORS === "true";
  return NEWS_FEEDS.filter((f) => f.enabled !== false)
    .filter((f) => allowAggregators || !f.aggregator)
    .slice()
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.weight - a.weight);
}

export const FEED_TIER_LABEL: Record<FeedTier, string> = {
  first_party: "First-party",
  research: "Research",
  analyst: "Analyst",
  press: "Press",
};

/** Display order for grouping sources in the filter popover. */
export const FEED_TIER_ORDER: readonly FeedTier[] = [
  "first_party",
  "research",
  "analyst",
  "press",
];
