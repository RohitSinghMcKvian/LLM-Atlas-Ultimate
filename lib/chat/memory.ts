// Lightweight memory recall. The shipped implementation is local and keyless:
// facts are scored by token overlap with the current message plus a mild
// recency prior — enough to surface "you're vegetarian" / "you use pnpm" style
// context without an embedding provider. When Supabase + an embedding model are
// configured, the same MemoryItem[] can be mirrored to the `embeddings` table
// and recalled via the match_embeddings() RPC for true semantic recall (§4.7).

export interface MemoryItem {
  id: string;
  content: string;
  /** "auto" = captured from a message; "manual" = added by the user. */
  source: "auto" | "manual";
  createdAt: number;
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
