"use client";

import {
  BY_PROJECT,
  PROJECT_CHUNKS,
  deleteByIndex,
  getAllByIndex,
  idbAvailable,
  openChatDb,
  putMany,
} from "./idb";
import { chunkProjectFiles, estimateTokens, filesFingerprint, type Chunk } from "./chunk";
import { cosine, type Embedder, type Embedding } from "./embed";
import { uuid } from "./types";
import { getSupabaseBrowser } from "@/lib/supabase/client";

/**
 * Retrieval over a project's knowledge (spec §4.5).
 *
 * Two storage backends, mirroring the rest of the app:
 *  - IndexedDB (default, offline): chunk vectors are stored locally and scored
 *    with an in-browser brute-force cosine. Fine at project scale — a few
 *    hundred chunks — and the only path that works with no network.
 *  - Supabase pgvector (opt-in): `retrieveRemote` wires the previously-dead
 *    `match_embeddings` RPC. It requires a real 1536-dim embedding model, so it
 *    is used only when a provider embedder is configured AND the user is signed
 *    in. Unverified against a live database (see SELF-AUDIT).
 */

interface StoredChunk {
  id: string;
  projectId: string;
  fileName: string;
  chunkIndex: number;
  text: string;
  vector: number[];
  dims: number;
  model: string;
  /** Fingerprint of the files this chunk was built from, for staleness checks. */
  fingerprint: string;
}

export interface RetrievedChunk {
  fileName: string;
  chunkIndex: number;
  text: string;
  score: number;
}

async function db(): Promise<IDBDatabase | null> {
  if (!idbAvailable()) return null;
  try {
    return await openChatDb();
  } catch {
    return null;
  }
}

/** True when `projectId` already has a current index for these files. */
export async function isIndexed(
  projectId: string,
  files: { name: string; text: string }[],
): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  const rows = await getAllByIndex<StoredChunk>(d, PROJECT_CHUNKS, BY_PROJECT, projectId);
  if (rows.length === 0) return false;
  return rows[0].fingerprint === filesFingerprint(files);
}

/**
 * Build (or rebuild) the chunk index for a project.
 *
 * Idempotent by fingerprint: if the files are unchanged since the last index,
 * this is a no-op, so it is cheap to call on every send. When they have
 * changed, the project's old chunks are cleared first so a shrunk file can't
 * leave orphans behind.
 */
export async function indexProject(
  projectId: string,
  files: { name: string; text: string }[],
  embed: Embedder,
): Promise<{ indexed: boolean; chunks: number }> {
  const d = await db();
  if (!d) return { indexed: false, chunks: 0 };

  const fingerprint = filesFingerprint(files);
  if (await isIndexed(projectId, files)) {
    const existing = await getAllByIndex<StoredChunk>(d, PROJECT_CHUNKS, BY_PROJECT, projectId);
    return { indexed: false, chunks: existing.length };
  }

  const chunks: Chunk[] = chunkProjectFiles(files);
  if (chunks.length === 0) {
    await deleteByIndex(d, PROJECT_CHUNKS, BY_PROJECT, projectId);
    return { indexed: true, chunks: 0 };
  }

  const embeddings: Embedding[] = await embed(chunks.map((c) => c.text));
  const rows: StoredChunk[] = chunks.map((c, i) => ({
    id: uuid(),
    projectId,
    fileName: c.fileName,
    chunkIndex: c.chunkIndex,
    text: c.text,
    vector: embeddings[i].vector,
    dims: embeddings[i].dims,
    model: embeddings[i].model,
    fingerprint,
  }));

  // Replace atomically-ish: clear then write. A crash between the two leaves an
  // empty index, which `isIndexed` reports as stale and the next send rebuilds.
  await deleteByIndex(d, PROJECT_CHUNKS, BY_PROJECT, projectId);
  await putMany(d, PROJECT_CHUNKS, rows);
  return { indexed: true, chunks: rows.length };
}

/** Drop a project's index (e.g. on project delete). */
export async function clearProjectIndex(projectId: string): Promise<void> {
  const d = await db();
  if (!d) return;
  await deleteByIndex(d, PROJECT_CHUNKS, BY_PROJECT, projectId);
}

/** Top-k chunks for a query vector, scored by cosine. Local path. */
export async function retrieveLocal(
  projectId: string,
  query: Embedding,
  k = 6,
): Promise<RetrievedChunk[]> {
  const d = await db();
  if (!d) return [];
  const rows = await getAllByIndex<StoredChunk>(d, PROJECT_CHUNKS, BY_PROJECT, projectId);
  return rows
    // Only compare vectors produced the same way — mixing lexical and provider
    // vectors, or two dimensions, would score nonsense.
    .filter((r) => r.dims === query.dims && r.model === query.model)
    .map((r) => ({
      fileName: r.fileName,
      chunkIndex: r.chunkIndex,
      text: r.text,
      score: cosine(r.vector, query.vector),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/**
 * Top-k chunks via Supabase pgvector (`match_embeddings`). Requires a signed-in
 * session and a 1536-dim query vector. Returns [] on any failure so the caller
 * can fall back to the local path.
 */
/**
 * NOTE: unreachable in the shipped app.
 *
 * Every call site passes `lexicalEmbedder` (512 dims, `lib/chat/embed.ts`), and
 * the guard below early-returns unless the query carries 1536. `providerEmbedder`
 * exists but is not wired to any caller, so the pgvector path has no way to run.
 * Kept rather than deleted because the schema and the RPC are both live in
 * `supabase/migrations/0001`, and wiring an embedding model is a settings change
 * rather than a rewrite — but it should not be described as working.
 */
export async function retrieveRemote(
  projectId: string,
  query: Embedding,
  k = 6,
): Promise<RetrievedChunk[]> {
  if (query.dims !== 1536) return [];
  const client = await getSupabaseBrowser();
  if (!client) return [];
  try {
    const { data, error } = await client.rpc("match_embeddings", {
      query_embedding: query.vector,
      match_scope: `project:${projectId}`,
      match_count: k,
    });
    if (error || !Array.isArray(data)) return [];
    return data.map((r: { content: string; metadata?: { fileName?: string; chunkIndex?: number }; similarity: number }) => ({
      fileName: r.metadata?.fileName ?? "knowledge",
      chunkIndex: r.metadata?.chunkIndex ?? 0,
      text: r.content,
      score: r.similarity,
    }));
  } catch {
    return [];
  }
}

/**
 * Format retrieved chunks as a knowledge block for the system prompt, mirroring
 * the `<project_file>` shape `projectContext` uses for whole-file stuffing, so
 * the model sees a consistent format on both paths.
 */
export function formatRetrieved(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "";
  const blocks = chunks.map(
    (c) =>
      `<project_file name="${c.fileName}" chunk="${c.chunkIndex}">\n${c.text}\n</project_file>`,
  );
  return (
    "Relevant excerpts retrieved from the project's knowledge base. Ground your " +
    "answer in these and say so when you use them:\n\n" +
    blocks.join("\n\n")
  );
}

/**
 * The full retrieval step: embed the query, pull top-k, format.
 *
 * Prefers the remote path when the query is 1536-dim (a real embedding model
 * was used) and a session exists; otherwise, and on any remote miss, uses the
 * local index.
 */
export async function retrieveContext(
  projectId: string,
  query: string,
  embed: Embedder,
  k = 6,
): Promise<string> {
  const [q] = await embed([query]);
  if (!q) return "";
  let chunks: RetrievedChunk[] = [];
  if (q.dims === 1536) chunks = await retrieveRemote(projectId, q, k);
  if (chunks.length === 0) chunks = await retrieveLocal(projectId, q, k);
  return formatRetrieved(chunks);
}

/**
 * The auto-RAG threshold (spec §4.5). Below this many tokens of file knowledge,
 * everything is stuffed into the prompt; above it, retrieval kicks in.
 *
 * ~150K is Claude's documented switchover. It is high on purpose: stuffing is
 * strictly better when it fits, and only a genuinely large corpus benefits from
 * retrieval, which trades completeness for the ability to answer at all.
 */
export const RAG_STUFF_THRESHOLD_TOKENS = 150_000;

export interface ProjectKnowledge {
  id: string;
  instructions: string;
  files: { name: string; text: string }[];
}

/** Whole-file stuffing, matching projects-store's projectContext file format. */
function stuffFiles(files: { name: string; text: string }[]): string {
  return files
    .filter((f) => f.text.trim())
    .map((f) => `<project_file name="${f.name}">\n${f.text.trim()}\n</project_file>`)
    .join("\n\n");
}

/**
 * Compose the project block for the system prompt, choosing between stuffing and
 * retrieval by total knowledge size.
 *
 * Instructions are ALWAYS included in full — they are the behavioural override,
 * not knowledge to retrieve. Only the file knowledge switches paths. When it
 * switches, the project is indexed lazily (idempotent, so repeated sends are
 * cheap) and the top-k chunks for `query` replace the stuffed files.
 */
export async function resolveProjectContext(
  project: ProjectKnowledge,
  query: string,
  embed: Embedder,
  opts: { thresholdTokens?: number; k?: number } = {},
): Promise<{ context: string; retrieved: boolean }> {
  const threshold = opts.thresholdTokens ?? RAG_STUFF_THRESHOLD_TOKENS;
  const parts: string[] = [];
  const instructions = project.instructions.trim();
  if (instructions) parts.push(instructions);

  const fileTokens = estimateTokens(project.files.map((f) => f.text).join("\n"));
  const useRetrieval = fileTokens > threshold && project.files.length > 0;

  if (!useRetrieval) {
    const stuffed = stuffFiles(project.files);
    if (stuffed) parts.push(stuffed);
    return { context: parts.join("\n\n"), retrieved: false };
  }

  await indexProject(project.id, project.files, embed);
  const retrieved = await retrieveContext(project.id, query, embed, opts.k ?? 6);
  if (retrieved) parts.push(retrieved);
  return { context: parts.join("\n\n"), retrieved: true };
}
