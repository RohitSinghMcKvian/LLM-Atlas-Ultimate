import type { Verification, VerificationLevel, VerificationSignal } from "../types";
import type { RawArticle } from "./types";

// What Atlas is willing to claim about a story, and why.
//
// Every level below is a statement about PROVENANCE, never about truth. Atlas
// cannot know whether a report is correct; it can know who published it, whether
// the link lands on that publisher's own domain, and how many independent
// publishers said the same thing. The UI says exactly this, and the deep dive
// enumerates the individual signals so a reader can disagree with the verdict
// on the evidence rather than on faith.

/** The evidence a cluster provides about one of its members. */
export interface ClusterEvidence {
  /** Distinct registrable domains across the cluster. */
  domains: string[];
  /** Distinct feed ids across the cluster. */
  sourceIds: string[];
  /** At least one member is a first-party announcement on its own domain. */
  hasFirstParty: boolean;
}

const ARXIV_PATH = /\/(abs|pdf|html)\/\d{4}\.\d{4,5}(v\d+)?/;

/** Weight each signal contributes to the ordering score. Negatives subtract. */
const SIGNAL_WEIGHTS: Record<VerificationSignal, number> = {
  first_party_source: 40,
  publisher_domain_match: 20,
  canonical_link: 10,
  multi_domain: 18,
  multi_source: 6,
  research_preprint: 15,
  author_attributed: 4,
  domain_mismatch: -45,
  no_canonical_link: -50,
  single_low_trust: -12,
};

/**
 * Compute the signals, the level, and the ordering score for one article.
 *
 * Pure and total: given the same article and cluster evidence it always returns
 * the same verdict, which is what keeps the snapshot hash stable and makes the
 * whole matrix testable without a network.
 */
export function verifyArticle(article: RawArticle, evidence: ClusterEvidence): Verification {
  const signals: VerificationSignal[] = [];

  // --- Positive signals ---

  // A usable destination: absolute https, a real host, and an actual path. A
  // link to a homepage is not a link to a story.
  const canonical = Boolean(article.url) && /^https?:\/\//i.test(article.url) && hasPath(article.url);
  if (canonical) signals.push("canonical_link");
  else signals.push("no_canonical_link");

  if (canonical && article.domainMatch) signals.push("publisher_domain_match");
  if (canonical && !article.domainMatch) signals.push("domain_mismatch");

  const firstParty = article.tier === "first_party" && article.domainMatch && canonical;
  if (firstParty) signals.push("first_party_source");

  const preprint = article.domain === "arxiv.org" && ARXIV_PATH.test(safePath(article.url));
  if (preprint) signals.push("research_preprint");

  const distinctDomains = new Set(evidence.domains).size;
  const distinctSources = new Set(evidence.sourceIds).size;

  // `multi_domain`, not `multi_source`, is what gates corroboration. Three
  // TechCrunch section feeds are one publisher, and counting them as three would
  // manufacture confidence out of syndication.
  if (distinctSources >= 2) signals.push("multi_source");
  if (distinctDomains >= 2) signals.push("multi_domain");

  if (article.author) signals.push("author_attributed");

  // A lone item from a low-trust source with nobody else reporting it.
  if (distinctDomains < 2 && article.sourceWeight < 0.6) signals.push("single_low_trust");

  // --- Level, first match wins ---

  const level = decideLevel({
    canonical,
    domainMatch: article.domainMatch,
    firstParty,
    preprint,
    distinctDomains,
    clusterHasFirstParty: evidence.hasFirstParty,
  });

  // --- Ordering score ---

  let score = 0;
  for (const signal of signals) score += SIGNAL_WEIGHTS[signal];
  // Corroboration beyond the second domain still counts, with diminishing return.
  if (distinctDomains > 2) score += Math.min(10, (distinctDomains - 2) * 4);
  score += Math.round(article.sourceWeight * 10);

  return {
    level,
    score: clamp(score, 0, 100),
    signals,
    corroboration: distinctSources,
    distinctDomains,
    firstParty: evidence.hasFirstParty,
  };
}

interface LevelInput {
  canonical: boolean;
  domainMatch: boolean;
  firstParty: boolean;
  preprint: boolean;
  distinctDomains: number;
  clusterHasFirstParty: boolean;
}

function decideLevel(input: LevelInput): VerificationLevel {
  // A missing or off-domain link caps everything, regardless of tier. If a
  // first-party feed emits an item that links off its own domain, the feed is
  // republishing someone else's story, and Atlas will not stamp that verified
  // just because of who syndicated it.
  if (!input.canonical || !input.domainMatch) return "unconfirmed";

  // The announcement itself, on the announcer's domain.
  if (input.firstParty) return "verified";
  // Independent publishers agreeing, at least one of whom is the primary source.
  if (input.distinctDomains >= 2 && input.clusterHasFirstParty) return "verified";
  // A preprint on arXiv IS the primary document, even though arXiv is nobody's
  // press office.
  if (input.preprint) return "verified";

  if (input.distinctDomains >= 2) return "corroborated";

  return "reported";
}

function hasPath(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return path.length > 1;
  } catch {
    return false;
  }
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** Verification for a whole cluster — the strongest verdict among its members. */
const LEVEL_RANK: Record<VerificationLevel, number> = {
  verified: 3,
  corroborated: 2,
  reported: 1,
  unconfirmed: 0,
};

export function bestVerification(members: readonly Verification[]): Verification {
  if (!members.length) {
    return {
      level: "unconfirmed",
      score: 0,
      signals: ["no_canonical_link"],
      corroboration: 0,
      distinctDomains: 0,
      firstParty: false,
    };
  }
  return members
    .slice()
    .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || b.score - a.score)[0];
}

/**
 * Plain-English reason for each signal, shown in the deep-dive panel.
 *
 * Uses `host`, not `domain`: the reader is being told where the link goes, and
 * "qwenlm.github.io" is the useful answer where the registrable domain would say
 * "github.io". `domain` remains the right unit for *counting* independence.
 */
export function signalLabel(
  signal: VerificationSignal,
  article: { host: string; brand?: string },
): string {
  switch (signal) {
    case "first_party_source":
      return `Published by ${article.brand ?? "the source"} on ${article.host}, its own domain`;
    case "publisher_domain_match":
      return `The link points to ${article.host}, the publisher's own domain`;
    case "canonical_link":
      return "Links directly to the original article";
    case "multi_source":
      return "Reported by more than one feed";
    case "multi_domain":
      return "Reported independently by more than one publisher";
    case "research_preprint":
      return "Is a preprint on arXiv — the primary document";
    case "author_attributed":
      return "Carries a named author";
    case "domain_mismatch":
      return `The link leaves ${article.host} — this source is republishing`;
    case "no_canonical_link":
      return "No usable link to an original article";
    case "single_low_trust":
      return "A single lower-trust source, not yet corroborated";
  }
}

/** Whether a signal argues for or against the verdict. */
export function isNegativeSignal(signal: VerificationSignal): boolean {
  return SIGNAL_WEIGHTS[signal] < 0;
}

export const VERIFICATION_LEVEL_RANK = LEVEL_RANK;
