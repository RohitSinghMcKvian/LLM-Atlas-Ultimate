import { clusterId, fnv1a } from "./normalize";
import type { RawArticle } from "./types";

// Grouping the same story as told by different publishers.
//
// This is what turns "37 feeds" into "verified": a cluster spanning three
// independent registrable domains is evidence in a way that any single item is
// not, and the corroboration count on every card comes from here.
//
// THE COST OF BEING WRONG IS ASYMMETRIC
//
// A missed merge shows the reader two cards instead of one — mildly untidy. A
// bad merge makes a real story *disappear* into an unrelated cluster where
// nobody will look for it, and inflates a corroboration count that the UI
// presents as evidence. So every threshold here leans conservative, and the UI
// always enumerates a cluster's members so a bad merge is inspectable rather
// than invisible.

/** Words that carry no distinguishing signal in a headline. */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "for", "nor", "so", "yet", "of", "to", "in", "on",
  "at", "by", "from", "with", "as", "is", "are", "was", "were", "be", "been", "being",
  "it", "its", "this", "that", "these", "those", "will", "would", "can", "could", "may",
  "might", "has", "have", "had", "do", "does", "did", "not", "no", "new", "now", "more",
  "most", "than", "then", "into", "over", "after", "before", "up", "down", "out", "about",
  "how", "why", "what", "when", "who", "which", "you", "your", "we", "our", "us", "they",
  "their", "he", "she", "his", "her", "says", "said", "report", "reports", "reportedly",
]);

/** Tokenise a headline into meaningful lowercase words. */
export function titleTokens(title: string): string[] {
  return (title ?? "")
    .toLowerCase()
    // Keep digits and dots joined so "4.8" and "gpt-5" survive as one token.
    .replace(/[^a-z0-9.\-\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[.\-]+|[.\-]+$/g, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Cap on a stored sketch.
 *
 * Sized so an ordinary headline is kept whole: unigrams, bigrams and trigrams of
 * a 12-word headline come to ~33 shingles. Only a genuinely long title reaches
 * the cap, and when it does the smallest hashes are the ones kept, so sketches
 * stay comparable across documents.
 *
 * ~30 hashes × 8 chars × 600 articles is roughly 150 KB inside the snapshot
 * record. That record is server-only and never crosses the wire, so the budget
 * is disk, not bandwidth.
 */
export const SIGNATURE_SIZE = 64;

/**
 * A shingle sketch of a headline.
 *
 * Unigrams, bigrams and trigrams of the significant tokens, hashed and sorted.
 * Two publishers writing up the same launch preserve word order in a way that
 * survives rewriting, which is exactly what shingles capture; comparing them is
 * a set intersection rather than an O(words²) alignment.
 *
 * Persisted on the snapshot record so a later sync re-clusters a carried-forward
 * article without recomputing it.
 */
export function signatureOf(title: string, extra: readonly string[] = []): string[] {
  const tokens = titleTokens(title);
  if (!tokens.length) return [];

  const shingles = new Set<string>();
  // Unigrams keep short headlines ("Nova 3 ships") comparable at all.
  for (const token of tokens) shingles.add(token);
  for (let i = 0; i + 1 < tokens.length; i++) shingles.add(`${tokens[i]} ${tokens[i + 1]}`);
  for (let i = 0; i + 2 < tokens.length; i++) {
    shingles.add(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }
  // Entities are strong evidence and worth carrying into the sketch directly.
  for (const e of extra) if (e) shingles.add(`@${e.toLowerCase()}`);

  return [...shingles]
    .map((s) => fnv1a(s))
    .sort()
    .slice(0, SIGNATURE_SIZE);
}

/**
 * Jaccard similarity of the two sketches, 0..1.
 *
 * Exact rather than estimated, which is why `SIGNATURE_SIZE` is generous enough
 * that a normal headline is never truncated at all.
 *
 * The bottom-k MinHash estimator was tried here first and is a trap at this
 * scale. It is unbiased, but its variance at k=12 swamps the signal: two
 * headlines differing by a single word ("costs fall as capacity grows" versus
 * "costs fall while capacity grows") have a true Jaccard of 0.50 and the
 * estimator returned 0.33 — below the merge threshold, so a genuine duplicate
 * never clustered. Sampling error is not worth paying for when the sets are
 * thirty elements and the comparison is a set intersection either way.
 *
 * When a very long headline *does* overflow the cap, both sketches keep their
 * smallest hashes, so the retained subsets remain comparable and the result
 * under-estimates. That is the direction to be wrong in — a missed merge shows
 * two cards; a bad merge hides a story and inflates a corroboration count.
 */
function sketchSimilarity(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0;

  const setB = new Set(b);
  let shared = 0;
  for (const hash of new Set(a)) if (setB.has(hash)) shared++;

  const union = new Set(a).size + setB.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Newsroom vocabulary: real words, but ones that say nothing about *which*
 * story this is.
 *
 * These are not stopwords — they carry meaning and belong in the similarity
 * score. They are excluded only from the "do these two headlines share something
 * distinctive?" test, because "OpenAI announces a price cut for its flagship
 * model" and "Google announces a price cut for its flagship model" share five
 * words and describe entirely different events. Every shared word there is on
 * this list; the words that differ are the story.
 */
const GENERIC_TOKENS = new Set([
  "ai", "model", "models", "launch", "launches", "launched", "announce", "announces",
  "announced", "announcing", "introduce", "introduces", "introducing", "unveil", "unveils",
  "release", "releases", "released", "ship", "ships", "update", "updates", "updated",
  "upgrade", "add", "adds", "added", "bring", "brings", "brought", "arrive", "arrives",
  "price", "prices", "pricing", "cut", "cuts", "flagship", "available", "availability",
  "general", "preview", "beta", "version", "support", "supports", "feature", "features",
  "tool", "tools", "api", "apis", "open", "free", "faster", "better", "best", "first",
  "latest", "company", "companies", "startup", "users", "developers", "customers",
  "platform", "service", "system", "data", "tech", "technology", "week", "day", "today",
  "year", "million", "billion", "percent", "study", "research", "paper", "papers",
  // Human-interest filler. These merged "How AI is expanding what people do at
  // work" (OpenAI) with "Announcing the AI Glasses Impact Grant Recipients:
  // Helping People Work, Learn…" (Meta) on live data — two unrelated stories
  // presented as mutual corroboration across two domains, which is the exact
  // failure this whole gate exists to prevent.
  "people", "person", "work", "works", "working", "world", "help", "helps", "helping",
  "make", "makes", "making", "use", "uses", "using", "get", "gets", "getting", "way",
  "ways", "need", "needs", "want", "know", "knows", "see", "look", "take", "takes",
  "thing", "things", "time", "times", "build", "builds", "building", "start", "starts",
  "future", "impact", "grant", "report", "reports",
]);

/**
 * A token is evidence of a shared *event* only if it is both non-generic and
 * uncommon in this corpus.
 *
 * The list above cannot anticipate everything: on any given day a term can be in
 * a third of the headlines and mean nothing. Corpus document frequency catches
 * that automatically, and it costs one pass over the titles.
 */
const RARE_TOKEN_MAX_SHARE = 0.08;

function buildDocumentFrequency(articles: readonly RawArticle[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const article of articles) {
    for (const token of new Set(titleTokens(article.title))) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }
  return df;
}

/** Distinct significant tokens two headlines share. */
function sharedTokens(a: readonly string[], b: readonly string[]): number {
  const setB = new Set(b);
  let shared = 0;
  for (const t of new Set(a)) if (setB.has(t)) shared++;
  return shared;
}

/** Shared tokens that actually identify a story: non-generic and corpus-rare. */
function sharedDistinctiveTokens(
  a: readonly string[],
  b: readonly string[],
  isRare: (token: string) => boolean,
): number {
  const setB = new Set(b);
  let shared = 0;
  for (const t of new Set(a)) {
    if (GENERIC_TOKENS.has(t)) continue;
    if (!isRare(t)) continue;
    if (setB.has(t)) shared++;
  }
  return shared;
}

/**
 * Overlap coefficient: shared / size of the smaller set.
 *
 * Jaccard punishes a length difference, and headline length varies enormously
 * for the same event — "Welcome Inkling by Thinking Machines" (4 significant
 * words) against "Together AI brings Thinking Machines Lab's new model Inkling
 * on day 0" (9). Jaccard scores that 0.30 and the pair never merges; the overlap
 * coefficient scores it 0.75, which is the honest reading of "everything the
 * short headline says, the long one also says".
 */
function overlapCoefficient(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const smaller = Math.min(setA.size, setB.size);
  if (!smaller) return 0;

  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared++;
  return shared / smaller;
}

function sharesEntity(a: RawArticle, b: RawArticle): boolean {
  if (a.models.some((m) => b.models.includes(m))) return true;
  if (a.orgs.some((o) => b.orgs.includes(o))) return true;
  return false;
}

/** Minimum n-gram sketch overlap for the strict path. */
const SIMILARITY_THRESHOLD = 0.34;
/** Minimum unigram overlap coefficient for the reworded-headline path. */
const OVERLAP_THRESHOLD = 0.5;
/**
 * Same-publisher pairs need stronger textual agreement, because they skip the
 * same-event check below. Two arXiv papers that merely share "low-rank
 * adaptation" scored 0.5 on live data and must not collapse into one entry.
 */
const SAME_DOMAIN_OVERLAP_THRESHOLD = 0.6;
/** Two stories published more than this far apart are follow-ups, not the same report. */
const MAX_SPAN_MS = 4 * 24 * 3_600_000;

/**
 * The merge decision.
 *
 * Two questions, asked in order, and they are genuinely different questions:
 *
 *   1. Are these plausibly the same text? Either the n-gram sketches agree
 *      (near-identical phrasing) or the unigram overlap is high (same facts,
 *      rewritten). The sketch alone is not enough — a publisher rewriting a
 *      headline destroys almost every bigram and trigram, which is how a
 *      first-party announcement and the press coverage of it were failing to
 *      merge on live data even at 0.36 unigram similarity.
 *
 *   2. Are they the same *event*? Similarity alone merges "OpenAI announces a
 *      price cut for its flagship model" with the identical sentence about
 *      Google. Across domains this pair will be counted as independent
 *      corroboration and badged accordingly, so it must show either a shared
 *      catalog model or organisation, or two shared tokens that are neither
 *      newsroom filler nor common in today's corpus.
 *
 * Same-publisher pairs skip question 2 — one outlet does not report the same
 * story twice by coincidence, and no corroboration claim is being made — but pay
 * a higher bar on question 1 instead.
 *
 * The asymmetry from the file header applies throughout: a missed merge costs a
 * duplicate card, a bad merge hides a story and inflates a number the UI presents
 * as evidence. Every threshold here is set on that basis.
 */
function shouldMerge(
  a: RawArticle,
  b: RawArticle,
  isRare: (token: string) => boolean,
): boolean {
  const gap = Math.abs(Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  if (Number.isFinite(gap) && gap > MAX_SPAN_MS) return false;

  // Exact same destination — the same article syndicated twice.
  if (a.urlKey === b.urlKey) return true;

  const tokensA = titleTokens(a.title);
  const tokensB = titleTokens(b.title);
  if (sharedTokens(tokensA, tokensB) < 2) return false;

  const sketch = sketchSimilarity(a.signature, b.signature);
  const overlap = overlapCoefficient(tokensA, tokensB);

  // Question 1.
  if (sketch < SIMILARITY_THRESHOLD && overlap < OVERLAP_THRESHOLD) return false;

  if (a.domain === b.domain) {
    return sketch >= SIMILARITY_THRESHOLD || overlap >= SAME_DOMAIN_OVERLAP_THRESHOLD;
  }

  // Question 2.
  if (sharesEntity(a, b)) return true;
  return sharedDistinctiveTokens(tokensA, tokensB, isRare) >= 2;
}

// --- Union-find -------------------------------------------------------------

class DisjointSet {
  private parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }

  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
    // Path compression, iterative — the recursive form is a stack overflow
    // waiting for a pathological chain.
    let cursor = x;
    while (this.parent[cursor] !== root) {
      const next = this.parent[cursor];
      this.parent[cursor] = root;
      cursor = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent[rootB] = rootA;
  }
}

// --- Lead election ----------------------------------------------------------

const TIER_RANK: Record<RawArticle["tier"], number> = {
  first_party: 0,
  research: 1,
  analyst: 2,
  press: 3,
};

/**
 * Pick the article that represents a cluster.
 *
 * The announcement outranks the coverage: a reader who opens one card should
 * land on the primary source. Aggregators are excluded outright — their links
 * are redirect shims, so leading with one would send the reader to a redirector
 * and break `publisher_domain_match` for the whole cluster.
 */
function electLead(members: RawArticle[]): RawArticle {
  const eligible = members.filter((m) => !m.aggregator);
  const pool = eligible.length ? eligible : members;

  return pool.slice().sort((a, b) => {
    // A domain mismatch means the item is republished; never lead with it.
    if (a.domainMatch !== b.domainMatch) return a.domainMatch ? -1 : 1;
    if (TIER_RANK[a.tier] !== TIER_RANK[b.tier]) return TIER_RANK[a.tier] - TIER_RANK[b.tier];
    if (a.sourceWeight !== b.sourceWeight) return b.sourceWeight - a.sourceWeight;
    // Earliest wins — the first to report it.
    const timeA = Date.parse(a.publishedAt);
    const timeB = Date.parse(b.publishedAt);
    if (timeA !== timeB) return timeA - timeB;
    // Total order, so the same input always produces the same lead and the
    // snapshot's content hash stays stable.
    return a.id < b.id ? -1 : 1;
  })[0];
}

export interface ClusterAssignment {
  /** Article id → cluster id. */
  clusterOf: Map<string, string>;
  /** Cluster id → member ids, lead first then descending source weight. */
  members: Map<string, string[]>;
  /** Cluster id → the lead article's id. */
  leads: Map<string, string>;
}

/**
 * Group articles into clusters.
 *
 * Blocked comparison rather than all-pairs: an article is only compared against
 * others that share a sketch hash. At ~600 articles the all-pairs form is
 * 180 000 comparisons every sync, and each one tokenises two headlines.
 */
export function clusterArticles(articles: readonly RawArticle[]): ClusterAssignment {
  const set = new DisjointSet(articles.length);

  // Corpus-relative rarity, computed once. On a small corpus every token looks
  // rare, so the cap has a floor — otherwise the first sync after a cold start
  // would merge far more aggressively than a steady-state one.
  const df = buildDocumentFrequency(articles);
  const maxDocs = Math.max(3, Math.floor(articles.length * RARE_TOKEN_MAX_SHARE));
  const isRare = (token: string) => (df.get(token) ?? 0) <= maxDocs;

  // Inverted index from sketch hash to candidate positions.
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < articles.length; i++) {
    for (const hash of articles[i].signature) {
      const bucket = buckets.get(hash);
      if (bucket) bucket.push(i);
      else buckets.set(hash, [i]);
    }
    // Exact-URL duplicates must merge even when the headline was rewritten.
    const urlBucket = `url:${articles[i].urlKey}`;
    const existing = buckets.get(urlBucket);
    if (existing) existing.push(i);
    else buckets.set(urlBucket, [i]);
  }

  const compared = new Set<string>();
  for (const bucket of buckets.values()) {
    // A hash shared by half the corpus is a stopword that survived tokenisation;
    // comparing everything in it costs more than the merges are worth.
    if (bucket.length < 2 || bucket.length > 40) continue;

    for (let x = 0; x < bucket.length; x++) {
      for (let y = x + 1; y < bucket.length; y++) {
        const i = bucket[x];
        const j = bucket[y];
        const key = i < j ? `${i}:${j}` : `${j}:${i}`;
        if (compared.has(key)) continue;
        compared.add(key);

        if (set.find(i) === set.find(j)) continue;
        if (shouldMerge(articles[i], articles[j], isRare)) set.union(i, j);
      }
    }
  }

  // Collect members by root.
  const byRoot = new Map<number, RawArticle[]>();
  for (let i = 0; i < articles.length; i++) {
    const root = set.find(i);
    const group = byRoot.get(root);
    if (group) group.push(articles[i]);
    else byRoot.set(root, [articles[i]]);
  }

  const clusterOf = new Map<string, string>();
  const members = new Map<string, string[]>();
  const leads = new Map<string, string>();

  for (const group of byRoot.values()) {
    const lead = electLead(group);
    // Derived from the lead's id rather than from a counter, so a cluster keeps
    // its identity across syncs as long as the lead does — which is what lets
    // "expanded" UI state and shared links survive an hourly rebuild.
    const id = clusterId(lead.id);

    const ordered = group
      .slice()
      .sort((a, b) => {
        if (a.id === lead.id) return -1;
        if (b.id === lead.id) return 1;
        if (a.sourceWeight !== b.sourceWeight) return b.sourceWeight - a.sourceWeight;
        return Date.parse(a.publishedAt) - Date.parse(b.publishedAt);
      })
      .map((a) => a.id);

    members.set(id, ordered);
    leads.set(id, lead.id);
    for (const article of group) clusterOf.set(article.id, id);
  }

  return { clusterOf, members, leads };
}
