// UI-side chat types for Atlas Chat. Persisted via lib/chat/repo.ts (Supabase
// when configured, else localStorage). Ids are UUIDs so the same value is valid
// for both drivers.

export type AttachmentKind =
  | "image"
  | "pdf"
  | "docx"
  | "text"
  | "csv"
  | "xlsx"
  | "code";

export interface Attachment {
  id: string;
  name: string;
  kind: AttachmentKind;
  mime: string;
  size: number;
  /** Images: a data URL passed to vision models. */
  dataUrl?: string;
  /** Extracted text (non-image types) injected into the prompt. */
  text?: string;
  /** Set when parsing failed; text holds the reason. */
  failed?: boolean;
}

export interface StoredToolCall {
  id: string;
  name: string;
  arguments?: string;
  result?: string;
}

/** A web-search result surfaced with a message (citations, §4.6). */
export interface WebSource {
  title: string;
  url: string;
  snippet: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  toolCalls?: StoredToolCall[];
  attachments?: Attachment[];
  /** Web-search results attached to this turn (rendered as a Sources strip). */
  sources?: WebSource[];
  /** Model id used to produce an assistant message. */
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  /** Derived USD cost for this turn (input+output), when tokens are known. */
  costUsd?: number;
  error?: boolean;
  pinned?: boolean;
  /**
   * Tree parent (previous turn on this branch), or null/undefined for a root.
   * Enables edit-branches and regenerate-variants: siblings share a parentId.
   */
  parentId?: string | null;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  modelId?: string;
  /** Owning project (shared instructions/knowledge injection, §4.5). */
  projectId?: string | null;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

export const uuid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
