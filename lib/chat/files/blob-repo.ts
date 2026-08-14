"use client";

/**
 * Binary deliverables, kept as bytes.
 *
 * The workspace stores `content: string`, which is right for source files and
 * wrong for the thing that makes code execution worth having: a `.xlsx` is a zip
 * container, and round-tripping it through UTF-8 produces mojibake that opens in
 * nothing — with the original bytes already gone by the time anyone notices. So
 * produced binaries get their own store, keyed the same way as workspace files
 * so the two share one address space and a path cannot mean two things.
 *
 * Base64 in the text column would have avoided a migration and cost a third more
 * space plus an encode and a decode on every read, on data whose whole purpose is
 * to be handed to a download link unchanged.
 */

import { BLOB_FILES, BY_CONVERSATION, del, deleteByIndex, get, getAllByIndex, openChatDb, put } from "../idb";

export interface BlobFile {
  conversationId: string;
  /** Relative, matching the workspace's own paths. */
  path: string;
  mime: string;
  bytes: ArrayBuffer;
  createdAt: number;
}

/** Metadata without the payload, for listings that must not read megabytes. */
export type BlobInfo = Omit<BlobFile, "bytes"> & { size: number };

/**
 * Caps, and why they are not the workspace's.
 *
 * `WS_MAX_TOTAL_BYTES` bounds what a build may grow to over its life, written a
 * file at a time by a model the user is watching. This bounds what unattended
 * scripts may accumulate in one conversation — a plotting loop that saves a PNG
 * per iteration is an ordinary accident, and IndexedDB quota is shared with
 * every other thing this origin stores.
 */
export const MAX_BLOB_BYTES = 4 * 1024 * 1024;
export const MAX_BLOBS_PER_CONVERSATION = 32;
export const MAX_BLOB_TOTAL_BYTES = 16 * 1024 * 1024;

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    // A rejection is deliberately not cached: an upgrade blocked by another tab
    // is transient, and caching it would disable downloads for the session.
    dbPromise = openChatDb().catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

/** Test seam: drop the memoized connection so a fresh IDBFactory is picked up. */
export function resetBlobDb(): void {
  dbPromise = null;
}

/** Extension → MIME, for the download link and the preview decision. */
const MIME: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
  zip: "application/zip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  parquet: "application/vnd.apache.parquet",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
};

export function mimeForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

export interface BlobWriteResult {
  ok: boolean;
  /** Why the write was refused, in a sentence the model can pass on. */
  reason?: string;
}

/**
 * Store one produced file, enforcing the caps.
 *
 * Refuses rather than evicting. Deciding on the user's behalf which of their
 * generated files to delete is not a decision this layer can make well, and a
 * refusal the model can report is more useful than a silent disappearance.
 */
export async function writeBlob(
  conversationId: string,
  path: string,
  bytes: ArrayBuffer,
): Promise<BlobWriteResult> {
  if (bytes.byteLength > MAX_BLOB_BYTES) {
    return {
      ok: false,
      reason: `${path} is ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB, over the ${MAX_BLOB_BYTES / 1024 / 1024}MB limit for a generated file.`,
    };
  }

  const existing = await listBlobs(conversationId);
  const replacing = existing.find((b) => b.path === path);
  if (!replacing && existing.length >= MAX_BLOBS_PER_CONVERSATION) {
    return {
      ok: false,
      reason: `This conversation already holds ${MAX_BLOBS_PER_CONVERSATION} generated files, the maximum.`,
    };
  }
  const total =
    existing.reduce((n, b) => n + b.size, 0) - (replacing?.size ?? 0) + bytes.byteLength;
  if (total > MAX_BLOB_TOTAL_BYTES) {
    return {
      ok: false,
      reason: `Saving ${path} would take this conversation past its ${MAX_BLOB_TOTAL_BYTES / 1024 / 1024}MB limit for generated files.`,
    };
  }

  await put(await db(), BLOB_FILES, {
    conversationId,
    path,
    mime: mimeForPath(path),
    bytes,
    createdAt: Date.now(),
  });
  return { ok: true };
}

export async function readBlob(
  conversationId: string,
  path: string,
): Promise<BlobFile | undefined> {
  return get<BlobFile>(await db(), BLOB_FILES, [conversationId, path]);
}

/**
 * Everything this conversation produced, without the payloads.
 *
 * IndexedDB has no projection, so the rows are read in full and the buffers
 * dropped — which is still far better than holding sixteen megabytes of
 * ArrayBuffer in React state for a list of filenames.
 */
export async function listBlobs(conversationId: string): Promise<BlobInfo[]> {
  const rows = await getAllByIndex<BlobFile>(
    await db(),
    BLOB_FILES,
    BY_CONVERSATION,
    conversationId,
  );
  return rows
    .map(({ bytes, ...rest }) => ({ ...rest, size: bytes.byteLength }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function removeBlob(conversationId: string, path: string): Promise<void> {
  await del(await db(), BLOB_FILES, [conversationId, path]);
}

/**
 * Drop everything a conversation produced.
 *
 * Called from the conversation-delete cascade. Without it a deleted chat would
 * strand its megabytes indefinitely — invisible, because nothing lists them.
 */
export async function clearBlobs(conversationId: string): Promise<void> {
  await deleteByIndex(await db(), BLOB_FILES, BY_CONVERSATION, conversationId);
}
