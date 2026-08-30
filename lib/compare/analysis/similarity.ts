// Which answers said the same thing.
//
// The question a multi-model run is really asking is "did asking more than one
// model buy me anything". Two answers that converge tell you the result is
// stable; one that diverges is either the insight or the error, and either way
// it is where to look first.
//
// Cosine over term-frequency vectors, not embeddings. Deliberately:
//
//   * It is free and instant, so it runs on every depth including Quick, where
//     an embedding round trip per lane would be most of the run's cost.
//   * It is deterministic, so the same two answers always score the same and the
//     number can be trusted between runs.
//   * At this scale it is enough. Distinguishing "these two answers cover the
//     same ground" from "these two do not" does not need semantics; it needs
//     vocabulary overlap, which is exactly what this measures.
//
// The honest limit: two answers that agree in different words score low. The
// claim matrix is what catches that, and it costs a model call.

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is",
  "are", "was", "were", "be", "been", "being", "it", "its", "as", "at", "by",
  "from", "that", "this", "these", "those", "but", "if", "then", "than", "so",
  "can", "will", "would", "should", "may", "not", "you", "your", "we", "our",
  "they", "their", "there", "here", "when", "which", "while", "into", "more",
  "most", "such", "also", "both", "each", "other", "some", "any", "all",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    // Fenced code would dominate the vector with syntax rather than substance.
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

export type Vector = Map<string, number>;

export function vectorize(text: string): Vector {
  const v: Vector = new Map();
  for (const term of tokenize(text)) v.set(term, (v.get(term) ?? 0) + 1);
  return v;
}

/** Cosine similarity, 0 (nothing shared) to 1 (identical vocabulary profile). */
export function cosine(a: Vector, b: Vector): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  // Iterate the smaller vector: the intersection is all that contributes.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [term, count] of small) {
    const other = large.get(term);
    if (other) dot += count * other;
  }
  if (dot === 0) return 0;
  const norm = (v: Vector) => Math.sqrt([...v.values()].reduce((s, n) => s + n * n, 0));
  return dot / (norm(a) * norm(b));
}

export interface SimilarityPair {
  a: string;
  b: string;
  score: number;
}

export interface SimilarityReport {
  /** Every unordered pair, most similar first. */
  pairs: SimilarityPair[];
  /** laneId to laneId to score, for the heatmap. Self-similarity is 1. */
  matrix: Record<string, Record<string, number>>;
  /** Groups of lanes that broadly agreed. Singletons are the outliers. */
  clusters: string[][];
  /** Mean pairwise similarity. High means the extra models bought little. */
  consensus: number;
  /** The lane least like the others, when there is one. */
  outlier?: string;
}

/**
 * Above this, two answers are treated as covering the same ground.
 *
 * Tuned against real answers rather than derived: prose from different models on
 * one question lands around 0.3-0.5 when they disagree and 0.6+ when they do
 * not. It is a display threshold, not a claim about meaning.
 */
export const CLUSTER_THRESHOLD = 0.55;

/**
 * Group lanes by transitive similarity — single-link clustering.
 *
 * Transitive on purpose: if A matches B and B matches C, all three are covering
 * the same ground even if A and C word it differently. The alternative would
 * split obvious agreement into pairs.
 */
export function cluster(
  laneIds: string[],
  matrix: Record<string, Record<string, number>>,
  threshold = CLUSTER_THRESHOLD,
): string[][] {
  const parent = new Map(laneIds.map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  for (const a of laneIds) {
    for (const b of laneIds) {
      if (a >= b) continue;
      if ((matrix[a]?.[b] ?? 0) >= threshold) parent.set(find(a), find(b));
    }
  }
  const groups = new Map<string, string[]>();
  for (const id of laneIds) {
    const root = find(id);
    groups.set(root, [...(groups.get(root) ?? []), id]);
  }
  // Largest first: the majority view before the dissent.
  return [...groups.values()].sort((x, y) => y.length - x.length);
}

/**
 * Compare every answer with every other.
 *
 * Lanes with no text are excluded rather than scored as zero: a failed lane is
 * not a dissenting opinion, and counting it would drag the consensus number down
 * for a reason that has nothing to do with the answers.
 */
export function compareAnswers(
  lanes: { id: string; text: string }[],
  threshold = CLUSTER_THRESHOLD,
): SimilarityReport {
  const answered = lanes.filter((l) => l.text.trim().length > 0);
  const ids = answered.map((l) => l.id);
  const vectors = new Map(answered.map((l) => [l.id, vectorize(l.text)]));

  const matrix: Record<string, Record<string, number>> = {};
  for (const id of ids) matrix[id] = { [id]: 1 };

  const pairs: SimilarityPair[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];
      const score = Math.round(cosine(vectors.get(a)!, vectors.get(b)!) * 100) / 100;
      matrix[a][b] = score;
      matrix[b][a] = score;
      pairs.push({ a, b, score });
    }
  }
  pairs.sort((x, y) => y.score - x.score);

  const clusters = cluster(ids, matrix, threshold);
  const consensus =
    pairs.length > 0 ? Math.round((pairs.reduce((s, p) => s + p.score, 0) / pairs.length) * 100) / 100 : 0;

  // An outlier only exists when the rest agree: with two lanes, or with every
  // lane in its own cluster, "least similar" is not a meaningful label.
  let outlier: string | undefined;
  if (ids.length >= 3 && clusters.length > 1 && clusters[0].length > 1) {
    const loners = clusters.slice(1).flat();
    if (loners.length === 1) outlier = loners[0];
  }

  return { pairs, matrix, clusters, consensus, outlier };
}

/** One line for the analysis header. */
export function describeSimilarity(report: SimilarityReport, nameOf: (id: string) => string): string {
  if (report.pairs.length === 0) return "Only one answer to compare.";
  if (report.clusters.length === 1) {
    return `All ${report.clusters[0].length} answers covered the same ground.`;
  }
  if (report.outlier) return `${nameOf(report.outlier)} took a different line from the rest.`;
  return `${report.clusters.length} distinct lines of argument.`;
}
