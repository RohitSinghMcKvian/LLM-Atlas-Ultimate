// Lightweight memory recall. The shipped implementation is local and keyless:
// facts are scored by token overlap with the current message plus a mild
// recency prior — enough to surface "you're vegetarian" / "you use pnpm" style
// context without an embedding provider. When Supabase + an embedding model are
// configured, the same MemoryItem[] can be mirrored to the `embeddings` table
// and recalled via the match_embeddings() RPC for true semantic recall (§4.7).

/**
 * What kind of thing a remembered fact is (spec §4.7 "memory categories").
 *
 * Deliberately few and concrete. Categories exist so the user can see at a
 * glance *why* something is being injected into every conversation, and delete a
 * whole class of it — a long undifferentiated list is unreviewable, and an
 * unreviewable memory is one people stop trusting. More categories would look
 * tidier and be harder to assign correctly.
 */
export type MemoryCategory = "preference" | "identity" | "project" | "fact";

export const MEMORY_CATEGORIES: {
  id: MemoryCategory;
  label: string;
  hint: string;
}[] = [
  { id: "preference", label: "Preferences", hint: "How you want Atlas to work" },
  { id: "identity", label: "About you", hint: "Role, background, context" },
  { id: "project", label: "Projects", hint: "What you're working on" },
  { id: "fact", label: "Other", hint: "Anything else worth keeping" },
];

export interface MemoryItem {
  id: string;
  content: string;
  /** "auto" = captured from a message; "manual" = added by the user. */
  source: "auto" | "manual";
  /** Optional so items stored before P4 keep loading; treated as "fact". */
  category?: MemoryCategory;
  createdAt: number;
}

/** The category of an item, with the pre-P4 default applied. */
export function categoryOf(item: MemoryItem): MemoryCategory {
  return item.category ?? "fact";
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "to", "of", "in", "on", "for", "is",
  "are", "was", "were", "be", "i", "you", "it", "this", "that", "with", "my",
  "me", "we", "he", "she", "they", "as", "at", "by", "so", "do", "does", "can",
  "please", "remember", "note", "about",
]);

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length > 2 && !STOP.has(t),
  );
}

/** Recall the top-k memories most relevant to `query`. */
export function recallMemories(
  items: MemoryItem[],
  query: string,
  k = 4,
): MemoryItem[] {
  if (!items.length) return [];
  const q = new Set(tokenize(query));
  if (q.size === 0) return [];
  const now = Date.now();
  const scored = items
    .map((it) => {
      const toks = tokenize(it.content);
      let overlap = 0;
      for (const t of toks) if (q.has(t)) overlap++;
      if (overlap === 0) return { it, score: 0 };
      // Normalize by fact length, add a small recency nudge (~30-day halflife).
      const ageDays = (now - it.createdAt) / 86_400_000;
      const recency = 1 / (1 + ageDays / 30);
      return { it, score: overlap / Math.sqrt(toks.length + 1) + 0.15 * recency };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((s) => s.it);
}

/**
 * Detect an explicit "remember …" instruction in a user message and return the
 * fact to store, or null. Intentionally conservative — we only auto-capture
 * when the user clearly asks us to remember something.
 */
export function extractMemory(userText: string): string | null {
  const t = userText.trim();
  const m =
    /^(?:please\s+)?remember(?:\s+that)?[:,]?\s+(.+)/i.exec(t) ||
    /^note(?:\s+that)?[:,]?\s+(.+)/i.exec(t) ||
    /^(?:for future reference|fyi)[:,]?\s+(.+)/i.exec(t);
  if (!m) return null;
  const fact = m[1].trim().replace(/\s+/g, " ");
  return fact.length > 3 && fact.length < 500 ? fact : null;
}

/**
 * Guess a category from the wording of a fact.
 *
 * Keyword heuristics, not a model call: classification runs the moment a fact is
 * captured, and spending a request — and a round trip — to label a one-line note
 * is out of proportion. Guessing wrong is cheap because the category is editable
 * in the memory dialog; guessing slowly is not. Order matters, most specific
 * first, and "preference" wins ties because it is the category users most want
 * to be able to review and revoke.
 */
export function classifyMemory(content: string): MemoryCategory {
  const t = content.toLowerCase();
  if (
    /\b(prefer|prefers|likes?|dislikes?|hates?|always|never|avoid|don'?t use|use\b.*instead|style|tone|format|concise|verbose|metric|imperial)\b/.test(
      t,
    )
  ) {
    return "preference";
  }
  if (
    /\b(i am|i'?m|my name|works? (at|for)|based in|lives? in|studies|engineer|developer|designer|student|manager|founder|years? of experience)\b/.test(
      t,
    )
  ) {
    return "identity";
  }
  if (
    /\b(project|repo|repository|codebase|app|building|shipping|deadline|client|stack|migrat|deploy)\b/.test(
      t,
    )
  ) {
    return "project";
  }
  return "fact";
}

/**
 * Compose a plain-language summary of what is remembered, grouped by category.
 *
 * Local and deterministic — no model call. This is a *starting point* the user
 * edits, and a generated draft they can correct is more useful than a blank box.
 * It is also why the summary is stored separately from the items: once edited, it
 * is the user's own text and must not be silently regenerated over.
 */
export function composeMemorySummary(items: MemoryItem[]): string {
  if (items.length === 0) return "";
  const groups = new Map<MemoryCategory, string[]>();
  for (const it of items) {
    const c = categoryOf(it);
    const list = groups.get(c) ?? [];
    list.push(it.content.trim());
    groups.set(c, list);
  }
  const order: MemoryCategory[] = ["identity", "preference", "project", "fact"];
  const sections: string[] = [];
  for (const c of order) {
    const list = groups.get(c);
    if (!list?.length) continue;
    const label = MEMORY_CATEGORIES.find((m) => m.id === c)?.label ?? c;
    sections.push(`${label}:\n${list.map((l) => `- ${l}`).join("\n")}`);
  }
  return sections.join("\n\n");
}
