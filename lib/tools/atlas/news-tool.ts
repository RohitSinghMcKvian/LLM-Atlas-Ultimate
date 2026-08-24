import { z } from "zod";
import { relativeTime } from "@/lib/news/format";
import { DEFAULT_FILTERS, clusterSiblings, selectArticles } from "@/lib/news/select";
import type { NewsArticle, NewsCluster, NewsTopic } from "@/lib/news/types";
import { NEWS_TOPICS } from "@/lib/news/topics";

/**
 * Atlas News, as a tool.
 *
 * Built on `selectArticles` rather than a fresh filter: the News page's topic
 * semantics (OR within topics, AND across filter kinds), its cluster collapsing
 * and its ranking are all decisions that took a while to get right, and an agent
 * answering from a second implementation would quietly disagree with the page
 * the user can open in the next tab.
 *
 * The corpus is injected. `/news` receives it as a server prop and chat does
 * not hold it, so a module that fetched it here would break the offline
 * guarantee for every other Atlas tool in the same registry. Absent corpus is a
 * plain, honest answer rather than an empty result set.
 */

export const newsToolSchema = z.object({
  command: z
    .enum(["search", "story"])
    .describe(
      "search: recent AI news matching a query or topic. story: every publisher that reported one story.",
    ),
  search_query: z.string().max(200).optional(),
  topic: z
    .string()
    .max(40)
    .optional()
    .describe(`One of: ${NEWS_TOPICS.map((t) => t.id).join(", ")}.`),
  article_id: z.string().max(120).optional().describe("For `story`."),
  verified_only: z
    .boolean()
    .default(false)
    .describe("Only stories corroborated across publishers or announced first-party."),
  max_results: z.number().int().min(1).max(12).default(6),
});

export type NewsToolInput = z.output<typeof newsToolSchema>;

export interface NewsCorpus {
  articles: readonly NewsArticle[];
  clusters: readonly NewsCluster[];
}

export interface NewsToolResult {
  content: string;
  /** Real, external URLs - these are citations the user can check. */
  sources?: { title: string; url: string; snippet: string }[];
  isError?: boolean;
}

const NO_CORPUS =
  "Atlas News is not loaded in this session, so recent news cannot be checked. Say that rather than answering from memory - anything you recall about recent releases may be out of date.";

export function runNewsTool(
  input: NewsToolInput,
  corpus: NewsCorpus | null,
  now = Date.now(),
): NewsToolResult {
  if (!corpus || corpus.articles.length === 0) return { content: NO_CORPUS, isError: true };

  if (input.command === "story") return story(input, corpus, now);
  return search(input, corpus, now);
}

function search(input: NewsToolInput, corpus: NewsCorpus, now: number): NewsToolResult {
  const topic = validTopic(input.topic);
  if (input.topic && !topic) {
    return {
      content: `"${input.topic}" is not an Atlas News topic. Valid topics: ${NEWS_TOPICS.map((t) => t.id).join(", ")}.`,
      isError: true,
    };
  }

  const { articles } = selectArticles({
    articles: corpus.articles,
    clusters: corpus.clusters,
    filters: {
      ...DEFAULT_FILTERS,
      query: input.search_query?.trim() ?? "",
      topics: topic ? [topic] : [],
      verifiedOnly: input.verified_only,
    },
    now,
  });

  const top = articles.slice(0, input.max_results);
  if (top.length === 0) {
    return {
      content: `Nothing in the Atlas News corpus matches that. Do not substitute a recollection - say nothing recent was found.`,
    };
  }

  return {
    content: top.map((a) => line(a, now)).join("\n"),
    sources: top.map(toSource),
  };
}

function story(input: NewsToolInput, corpus: NewsCorpus, now: number): NewsToolResult {
  const id = input.article_id?.trim();
  const lead = id ? corpus.articles.find((a) => a.id === id) : undefined;
  if (!lead) {
    return {
      content: id
        ? `No article with id "${id}". Use \`search\` first and pass an id from its results.`
        : "`story` needs an article_id.",
      isError: true,
    };
  }

  const siblings = clusterSiblings(lead, corpus.clusters, corpus.articles);
  const all = [lead, ...siblings.filter((s) => s.id !== lead.id)];
  const lines = [
    `${lead.title}`,
    // Provenance is the claim being made, so it leads rather than trails: Atlas
    // can say who reported something and cannot say whether it is true.
    `Reported by ${new Set(all.map((a) => a.host)).size} publisher(s) - ${lead.verification.level}.`,
    "",
    ...all.map((a) => line(a, now)),
  ];
  return { content: lines.join("\n"), sources: all.map(toSource) };
}

function line(a: NewsArticle, now: number): string {
  const models = a.models.length ? ` - about: ${a.models.join(", ")}` : "";
  return `- ${a.title} (${a.host}, ${relativeTime(a.publishedAt, now)}, ${a.verification.level}) [${a.id}]${models}\n  ${a.summary}`;
}

function toSource(a: NewsArticle) {
  return { title: a.title, url: a.url, snippet: a.summary };
}

function validTopic(raw?: string): NewsTopic | undefined {
  if (!raw) return undefined;
  const found = NEWS_TOPICS.find((t) => t.id === raw);
  return found?.id;
}
