// Carrying the shared evidence into a window that cannot hold it.
//
// The design promise is that every lane answers from the *same* evidence. A
// 32k-context model cannot physically hold what a 1M-context model can, so the
// promise has to be "the same evidence, carried differently" rather than "as much
// as fits". Two rules make that survivable:
//
//   1. **Numbers never change.** `formatResearchContext` numbers sources by array
//      position, so handing a narrow lane a subset would make its `[2]` a
//      different source from a wide lane's `[2]`. The evidence panel's "cited by"
//      column would then be quietly wrong, and `reconcileCitations` would validate
//      against the wrong list. Every selection here keeps the original 1-based
//      index, so `[7]` means source seven in every lane.
//   2. **The lane is told.** A lane reading an abridged pack says so in its own
//      context, because a model that does not know it is missing sources will
//      confidently answer as though it has them all.
//
// Selection is lexical, not semantic: deterministic, free, testable without a
// model, and good enough to rank a dozen snippets against one question. Embedding
// the pack per lane would cost a round trip per run to reorder twelve items.

import { estimateTokens } from "@/lib/engine/context";
import type { WebSource } from "@/lib/chat/types";
import type { ContextFit, EvidencePack } from "./types";

/** A source with the number it must keep. */
export interface NumberedSource {
  /** 1-based, and authoritative — it is what citations are validated against. */
  n: number;
  source: WebSource;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is",
  "are", "was", "were", "be", "been", "what", "which", "how", "why", "when",
  "between", "about", "that", "this", "it", "as", "at", "by", "from", "vs",
]);

function terms(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * How well one source answers the question, by term overlap.
 *
 * Title matches count double: a term in the title is what the page is *about*,
 * while a term in a snippet may be an aside. Distinct terms rather than a count,
 * so a page that repeats one keyword twenty times does not outrank one that
 * covers the whole question.
 */
export function relevance(source: WebSource, question: string): number {
  const wanted = new Set(terms(question));
  if (wanted.size === 0) return 0;
  const title = new Set(terms(source.title ?? ""));
  const snippet = new Set(terms(source.snippet ?? ""));
  let score = 0;
  for (const word of wanted) {
    if (title.has(word)) score += 2;
    else if (snippet.has(word)) score += 1;
  }
  return score / (wanted.size * 2);
}

/** Tokens one numbered source costs in the rendered context. */
export function sourceTokens(item: NumberedSource): number {
  const { source } = item;
  return estimateTokens(`[${item.n}] ${source.title}\n${source.url}\n${source.snippet}\n\n`);
}

/**
 * Pick the sources that fit, best first, then restore reading order.
 *
 * Ranked by relevance to decide *what* survives; re-sorted by number to decide
 * *how it reads*, because a list that jumps 7, 2, 9 looks like a bug and gives
 * the model no reason to trust the ordering.
 */
export function selectSources(
  sources: WebSource[],
  question: string,
  budgetTokens: number,
): NumberedSource[] {
  const numbered: NumberedSource[] = sources.map((source, i) => ({ n: i + 1, source }));
  if (budgetTokens <= 0) return [];

  const ranked = [...numbered].sort((a, b) => {
    const d = relevance(b.source, question) - relevance(a.source, question);
    // Ties go to the earlier source: the research loop found it first, from a
    // more central query.
    return d !== 0 ? d : a.n - b.n;
  });

  const kept: NumberedSource[] = [];
  let spent = 0;
  for (const item of ranked) {
    const cost = sourceTokens(item);
    if (spent + cost > budgetTokens) continue;
    kept.push(item);
    spent += cost;
  }
  return kept.sort((a, b) => a.n - b.n);
}

/**
 * Render numbered sources with their numbers stated explicitly.
 *
 * Deliberately not `formatResearchContext`, which derives the number from array
 * position — the one thing a subset must not do.
 */
export function formatNumbered(items: NumberedSource[], total: number): string {
  if (items.length === 0) {
    return "No sources were available for this answer. Say so plainly rather than answering from memory.";
  }
  const abridged =
    items.length < total
      ? ` Only ${items.length} of the ${total} sources gathered for this question fit here, so some ` +
        "evidence is missing — say what you could not establish rather than filling the gap."
      : "";
  const blocks = items.map((i) => `[${i.n}] ${i.source.title}\n${i.source.url}\n${i.source.snippet}`);
  return (
    "Sources gathered for this question. Cite them inline by number, like [1] or [2][3]. " +
    "The numbers are fixed: cite a source by the number shown, and do not renumber them. " +
    "Do not cite a number that is not in this list, and do not state as fact anything these " +
    `sources do not support — say what you could not establish instead.${abridged}\n\n` +
    blocks.join("\n\n")
  );
}

/** Chars kept from an attached document when the whole thing cannot fit. */
export const DOC_EXCERPT_CHARS = 4_000;

/**
 * The context text for one lane.
 *
 * `stuff` is the whole pack and the only fit with no quality cost. `rag` keeps
 * the most relevant sources that fit. `map-reduce` is the same selection over a
 * much tighter budget with documents cut to an excerpt — a lane whose window
 * cannot hold the ask and its own answer has nothing better available, and an
 * abridged context it knows about beats a request the provider rejects outright.
 */
export function buildLaneContext(
  pack: EvidencePack,
  fit: ContextFit,
  budgetTokens: number,
  question: string,
): string | undefined {
  const hasSources = pack.sources.length > 0;
  const hasDocs = pack.documents.length > 0;
  if (!hasSources && !hasDocs) return undefined;

  // Documents are the user's own material, so they are served first out of the
  // budget: someone who attached a file asked about that file.
  const blocks: string[] = [];
  let left = Math.max(0, budgetTokens);

  if (hasDocs) {
    const excerpt = fit === "stuff" ? Number.POSITIVE_INFINITY : DOC_EXCERPT_CHARS;
    const rendered = pack.documents.map((d) => {
      const text = d.text.length > excerpt ? `${d.text.slice(0, excerpt)}\n…[truncated]` : d.text;
      return `--- ${d.name} ---\n${text}`;
    });
    const body = rendered.join("\n\n");
    blocks.push(`Files the user attached. Refer to them by name, not by citation number.\n\n${body}`);
    left -= estimateTokens(body);
  }

  if (hasSources) {
    const budget = fit === "stuff" ? Number.POSITIVE_INFINITY : Math.max(0, left);
    const selected = selectSources(pack.sources, question, budget);
    blocks.push(formatNumbered(selected, pack.sources.length));
  }

  return blocks.join("\n\n");
}
