// Embeddings for project-knowledge retrieval (spec §4.5).
//
// Two backends, chosen by what's available (graceful degradation, §1.2):
//
//  - LEXICAL (default): a feature-hashed bag-of-words vector computed entirely
//    in the browser. Deterministic, offline, zero-dependency, and the only path
//    that honours §1.5 (fully usable offline). It is not semantic — it matches
//    on shared terms, not meaning — but combined with the fact that small
//    projects are stuffed whole, its job is to beat truncation on a large
//    corpus, which shared-term overlap does well enough.
//
//  - PROVIDER (opt-in): a real embedding model via the BYOK /api/v1/embeddings
//    proxy. Semantic, but requires a key and an embedding-capable model, and
//    sends the text to a third party, so it is never the default.
//
// A vector always travels with its `dims` and `model` tag so the retrieval
// store never compares vectors that were produced differently.

export interface Embedding {
  vector: number[];
  dims: number;
  /** "lexical" or the provider model id — retrieval only compares matching tags. */
  model: string;
}

export type Embedder = (texts: string[]) => Promise<Embedding[]>;

/** Dimension of the lexical space. A power of two keeps the hash mask cheap. */
export const LEXICAL_DIMS = 512;
export const LEXICAL_MODEL = "lexical";

/** Lowercase alphanumeric tokens, length ≥ 2. */
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
}

/** FNV-1a of a token, folded into [0, dims). */
function hashToken(token: string, dims: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % dims;
}

/**
 * Feature-hashed, L2-normalized term-frequency vector.
 *
 * Sublinear (1 + log tf) term weighting damps the effect of a word repeated
 * many times, and a second hash decides the sign of each contribution so that
 * unrelated tokens colliding into the same bucket tend to cancel rather than
 * reinforce. L2-normalization makes the dot product a cosine, so retrieval can
 * skip per-query magnitude division.
 */
export function lexicalEmbed(text: string, dims = LEXICAL_DIMS): Embedding {
  const vec = new Array<number>(dims).fill(0);
  const counts = new Map<string, number>();
  for (const tok of tokenize(text)) counts.set(tok, (counts.get(tok) ?? 0) + 1);

  for (const [tok, tf] of counts) {
    const weight = 1 + Math.log(tf);
    const bucket = hashToken(tok, dims);
    const sign = hashToken(tok + "#", 2) === 0 ? 1 : -1;
    vec[bucket] += sign * weight;
  }

  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dims; i++) vec[i] /= norm;

  return { vector: vec, dims, model: LEXICAL_MODEL };
}

/** The offline embedder: lexical vectors for every input. */
export const lexicalEmbedder: Embedder = async (texts) =>
  texts.map((t) => lexicalEmbed(t));

/**
 * Cosine similarity of two vectors. Returns 0 for a dimension or empty
 * mismatch rather than throwing, so a corrupt stored vector can't crash a
 * retrieval pass — it just ranks last.
 */
export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * A provider-backed embedder over the BYOK proxy. The user's key travels in the
 * header the proxy forwards; it is never persisted. Falls back to lexical if
 * the call fails, so retrieval degrades rather than breaking.
 */
export function providerEmbedder(opts: {
  model: string;
  keyHeaders: Record<string, string>;
  dims?: number;
  signal?: AbortSignal;
}): Embedder {
  return async (texts) => {
    try {
      const res = await fetch("/api/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...opts.keyHeaders },
        body: JSON.stringify({ model: opts.model, input: texts }),
        signal: opts.signal,
      });
      if (!res.ok) throw new Error(`embeddings ${res.status}`);
      const data = (await res.json()) as { embeddings: number[][] };
      if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) {
        throw new Error("malformed embeddings response");
      }
      return data.embeddings.map((vector) => ({
        vector,
        dims: vector.length,
        model: opts.model,
      }));
    } catch {
      // Degrade to offline rather than failing the retrieval.
      return texts.map((t) => lexicalEmbed(t));
    }
  };
}
