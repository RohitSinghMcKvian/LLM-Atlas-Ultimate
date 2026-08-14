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
  /**
   * The model produced this, rather than the user attaching it (§P12).
   *
   * Generated images reuse `Attachment` on purpose: persistence, branching,
   * export and the vision round-trip all already understand it, and a parallel
   * `images` field would have to be taught to each of them. The flag exists
   * because the transcript renders the two differently — an attachment is a
   * chip, a generated image is the answer and is shown full size.
   */
  generated?: boolean;
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
  /**
   * Image-output tokens included in `completionTokens` (§P13). Kept so the cost
   * line can charge them at the model's image rate instead of its text rate.
   */
  imageTokens?: number;
  /** Derived USD cost for this turn (input+output), when tokens are known. */
  costUsd?: number;
  error?: boolean;
  pinned?: boolean;
  /**
   * Folded by compaction: still in the transcript, no longer sent to the model.
   *
   * An inclusion flag, deliberately NOT a tree edit — `parentId` is untouched,
   * so `activePath`, the sibling stepper and `activeLeafId` all behave exactly
   * as they did. Compaction shrinks the request, not the conversation.
   */
  folded?: boolean;
  /**
   * Resume requests made because the provider truncated the answer at its output
   * limit. Shown in the activity row, because a page that had to be assembled
   * from four requests is worth knowing about — silently stitching it would hide
   * a real reason for a seam or a repeated line.
   */
  continuations?: number;
  /** The answer is still unfinished: truncated, and out of resume attempts. */
  truncated?: boolean;
  /**
   * Errors the artifact threw while running, reported by the sandboxed frame.
   * Model-authored output, so it is treated as data everywhere it is used.
   */
  artifactErrors?: string[];
  /**
   * A capability the route refused, so this turn ran without it — today only
   * "this model does not accept tools". Not an error: the answer is real. But
   * without it the turn is indistinguishable from a model that simply chose not
   * to search or write anything, and the user's natural response — asking again,
   * more firmly — cannot work.
   *
   * Transient, like `truncated` and `artifactErrors`. It describes the route that
   * served this request rather than the message, and the durable half of the fact
   * is already kept by `lib/store/tool-support-store.ts`.
   */
  capabilityNote?: string;
  /**
   * The turn ran out of budget before it ran out of work.
   *
   * `stoppedBy` is the sentence; `stopReason` is what the UI branches on, since
   * each stop deserves a different control — a round cap gets a Continue button,
   * a cost ceiling gets a settings link, and a detected loop gets neither
   * because another identical round is not what the user needs.
   *
   * These used to be one line of italic prose appended to the answer, which made
   * "carry on" something the user had to reconstruct and retype. Transient, like
   * the fields above: the workspace and ledger are what actually persist, and
   * they are what a resumed turn reads.
   */
  stoppedBy?: string;
  stopReason?: string;
  /** Round-cap resumptions already spent on this turn, for the auto allowance. */
  resumeCount?: number;
  /**
   * Binary deliverables this turn produced — the .xlsx, .docx or .pdf that
   * `run_python` wrote.
   *
   * The bytes live in their own IndexedDB store keyed by conversation and path;
   * this is the pointer, so the turn that produced a file is the turn that
   * offers it. Without it a generated spreadsheet would exist and be invisible,
   * which is the same failure as not generating it.
   *
   * Transient, like the fields above: the store is the durable record, and a
   * reload lists it from there.
   */
  producedFiles?: { path: string; size: number; mime: string }[];
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
  /**
   * Last message on the branch the user was viewing. Persisted with the
   * conversation (not in browser-local UI state) so the same branch is restored
   * on another device. `activeFromLeaf` rebuilds the pointer map from it.
   */
  activeLeafId?: string | null;
  pinned?: boolean;
  /**
   * Created in incognito, so it exists only in memory for this session.
   *
   * In-memory ONLY — no driver writes it, because nothing about a temporary
   * conversation is written at all. It is kept in the store's list rather than
   * omitted so every existing lookup (`conversations.find(...)` for the active
   * model, project and title) keeps working; the history rail hides these, and
   * leaving incognito discards them.
   */
  temporary?: boolean;
  createdAt: number;
  updatedAt: number;
}

export const uuid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
