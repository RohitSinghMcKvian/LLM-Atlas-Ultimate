"use client";

import { getSupabaseBrowser, remotePersistenceReady } from "@/lib/supabase/client";
import { idbAvailable } from "./idb";
import { isIncognito } from "./incognito";
import { makeIdbRepo } from "./repo-idb";
import { readOnlyRepo } from "./repo-private";
import type { ChatMessage, Conversation, StoredToolCall, Attachment } from "./types";

/**
 * Persistence for Atlas Chat. Backed by Supabase when configured, else
 * localStorage — the app is fully usable either way. Streaming updates stay
 * in-memory; only completed messages and metadata changes are persisted, so
 * writes are infrequent.
 */
export interface ChatRepo {
  /** True when backed by Supabase (vs. local browser storage). */
  readonly remote: boolean;
  listConversations(): Promise<Conversation[]>;
  createConversation(input: {
    id: string;
    title: string;
    modelId?: string;
    projectId?: string | null;
  }): Promise<void>;
  updateConversation(
    id: string,
    patch: Partial<Pick<Conversation, "title" | "pinned" | "modelId" | "projectId" | "activeLeafId" | "updatedAt">>,
  ): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  listMessages(conversationId: string): Promise<ChatMessage[]>;
  addMessage(conversationId: string, msg: ChatMessage): Promise<void>;
  updateMessage(
    conversationId: string,
    id: string,
    patch: Partial<ChatMessage>,
  ): Promise<void>;
  /**
   * Patch several messages at once.
   *
   * Compaction folds forty turns in one action, and doing that through
   * `updateMessage` in a loop is forty transactions on IndexedDB and forty
   * whole-blob rewrites on localStorage — O(n²) on precisely the long thread
   * this feature exists to serve. An unknown id is skipped, not an error.
   *
   * On the interface rather than as a loop at the call site, deliberately:
   * `readOnlyRepo` is an explicit object literal, so a write method that is not
   * added there is a type error. That is the property incognito relies on to
   * block writes added by later phases that never heard of it.
   */
  updateMessages(
    conversationId: string,
    patches: { id: string; patch: Partial<ChatMessage> }[],
  ): Promise<void>;
}

// ── localStorage driver ─────────────────────────────────────────────────────

const KEY = "atlas-chat-v1";

interface LocalBlob {
  conversations: Conversation[];
  messages: Record<string, ChatMessage[]>;
}

function readBlob(): LocalBlob {
  if (typeof localStorage === "undefined") return { conversations: [], messages: {} };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { conversations: [], messages: {} };
    const parsed = JSON.parse(raw);
    return {
      conversations: parsed.conversations ?? [],
      messages: parsed.messages ?? {},
    };
  } catch {
    return { conversations: [], messages: {} };
  }
}

function writeBlob(blob: LocalBlob) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(blob));
  } catch {
    /* quota — ignore */
  }
}

const localRepo: ChatRepo = {
  remote: false,
  async listConversations() {
    return readBlob().conversations.sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async createConversation({ id, title, modelId, projectId }) {
    const blob = readBlob();
    const now = Date.now();
    blob.conversations.unshift({
      id,
      title,
      modelId,
      projectId: projectId ?? null,
      createdAt: now,
      updatedAt: now,
    });
    blob.messages[id] = [];
    writeBlob(blob);
  },
  async updateConversation(id, patch) {
    const blob = readBlob();
    blob.conversations = blob.conversations.map((c) =>
      c.id === id ? { ...c, ...patch, updatedAt: patch.updatedAt ?? Date.now() } : c,
    );
    writeBlob(blob);
  },
  async deleteConversation(id) {
    const blob = readBlob();
    blob.conversations = blob.conversations.filter((c) => c.id !== id);
    delete blob.messages[id];
    writeBlob(blob);
  },
  async listMessages(conversationId) {
    return readBlob().messages[conversationId] ?? [];
  },
  async addMessage(conversationId, msg) {
    const blob = readBlob();
    // Upsert by id: regenerate/persist can re-write the same node.
    const existing = blob.messages[conversationId] ?? [];
    const idx = existing.findIndex((m) => m.id === msg.id);
    blob.messages[conversationId] =
      idx >= 0
        ? existing.map((m) => (m.id === msg.id ? msg : m))
        : [...existing, msg];
    blob.conversations = blob.conversations.map((c) =>
      c.id === conversationId ? { ...c, updatedAt: Date.now() } : c,
    );
    writeBlob(blob);
  },
  async updateMessage(conversationId, id, patch) {
    const blob = readBlob();
    blob.messages[conversationId] = (blob.messages[conversationId] ?? []).map((m) =>
      m.id === id ? { ...m, ...patch } : m,
    );
    writeBlob(blob);
  },
  async updateMessages(conversationId, patches) {
    if (!patches.length) return;
    // One read, one map, one write. This driver keeps every conversation in a
    // single JSON blob, so the per-id loop would re-serialise the whole archive
    // once per folded message.
    const byId = new Map(patches.map((p) => [p.id, p.patch]));
    const blob = readBlob();
    blob.messages[conversationId] = (blob.messages[conversationId] ?? []).map((m) => {
      const patch = byId.get(m.id);
      return patch ? { ...m, ...patch } : m;
    });
    writeBlob(blob);
  },
};

// ── Supabase driver (anon client, permissive RLS) ───────────────────────────

function makeSupabaseRepo(): ChatRepo {
  // getSupabaseBrowser lazy-loads @supabase/supabase-js on first call.
  const db = async () => {
    const c = await getSupabaseBrowser();
    if (!c) throw new Error("Supabase not configured");
    return c;
  };

  const toMessage = (r: any): ChatMessage => ({
    id: r.id,
    role: r.role,
    content: r.content ?? "",
    reasoning: r.reasoning ?? undefined,
    toolCalls: (r.tool_calls as StoredToolCall[]) ?? undefined,
    attachments: (r.attachments as Attachment[]) ?? undefined,
    model: r.model_id ?? undefined,
    promptTokens: r.prompt_tokens ?? undefined,
    completionTokens: r.completion_tokens ?? undefined,
    imageTokens: r.image_tokens ?? undefined,
    costUsd: r.cost_usd ?? undefined,
    pinned: r.pinned ?? undefined,
    folded: r.folded ?? undefined,
    parentId: r.parent_id ?? null,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  });

  return {
    remote: true,
    async listConversations() {
      const { data, error } = await (await db())
        .from("conversations")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        title: r.title,
        modelId: r.model_id ?? undefined,
        projectId: r.project_id ?? null,
        activeLeafId: r.active_leaf_message_id ?? null,
        pinned: r.pinned ?? false,
        createdAt: new Date(r.created_at).getTime(),
        updatedAt: new Date(r.updated_at).getTime(),
      }));
    },
    async createConversation({ id, title, modelId, projectId }) {
      const { error } = await (await db())
        .from("conversations")
        .insert({ id, title, model_id: modelId ?? null, project_id: projectId ?? null });
      if (error) throw error;
    },
    async updateConversation(id, patch) {
      const row: Record<string, unknown> = {};
      if (patch.title !== undefined) row.title = patch.title;
      if (patch.pinned !== undefined) row.pinned = patch.pinned;
      if (patch.modelId !== undefined) row.model_id = patch.modelId;
      if (patch.projectId !== undefined) row.project_id = patch.projectId;
      if (patch.activeLeafId !== undefined) row.active_leaf_message_id = patch.activeLeafId;
      const { error } = await (await db()).from("conversations").update(row).eq("id", id);
      if (error) throw error;
    },
    async deleteConversation(id) {
      const { error } = await (await db()).from("conversations").delete().eq("id", id);
      if (error) throw error;
    },
    async listMessages(conversationId) {
      const { data, error } = await (await db())
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map(toMessage);
    },
    async addMessage(conversationId, msg) {
      // Upsert: regenerate/persist can re-write the same node id.
      const { error } = await (await db())
        .from("messages")
        .upsert({
          id: msg.id,
          conversation_id: conversationId,
          parent_id: msg.parentId ?? null,
          role: msg.role,
          content: msg.content,
          reasoning: msg.reasoning ?? null,
          model_id: msg.model ?? null,
          tool_calls: msg.toolCalls ?? null,
          attachments: msg.attachments ?? null,
          prompt_tokens: msg.promptTokens ?? null,
          completion_tokens: msg.completionTokens ?? null,
          image_tokens: msg.imageTokens ?? null,
          cost_usd: msg.costUsd ?? null,
          pinned: msg.pinned ?? false,
          folded: msg.folded ?? false,
        });
      if (error) throw error;
      await (await db())
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId);
    },
    async updateMessage(conversationId, id, patch) {
      const row = toRow(patch);
      if (Object.keys(row).length === 0) return;
      const { error } = await (await db()).from("messages").update(row).eq("id", id);
      if (error) throw error;
    },
    async updateMessages(conversationId, patches) {
      if (!patches.length) return;
      // Grouped by the patch body, then one `.in()` per distinct body. The fold
      // case — the reason this method exists — is a single body for forty ids,
      // so it collapses to one request.
      const groups = new Map<string, { row: Record<string, unknown>; ids: string[] }>();
      for (const { id, patch } of patches) {
        const row = toRow(patch);
        if (Object.keys(row).length === 0) continue;
        const key = JSON.stringify(row);
        const group = groups.get(key);
        if (group) group.ids.push(id);
        else groups.set(key, { row, ids: [id] });
      }
      const client = await db();
      for (const { row, ids } of groups.values()) {
        const { error } = await client.from("messages").update(row).in("id", ids);
        if (error) throw error;
      }
    },
  };
}

/** The columns a `ChatMessage` patch maps to. Shared by both update paths. */
function toRow(patch: Partial<ChatMessage>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (patch.content !== undefined) row.content = patch.content;
  if (patch.reasoning !== undefined) row.reasoning = patch.reasoning;
  if (patch.toolCalls !== undefined) row.tool_calls = patch.toolCalls;
  if (patch.pinned !== undefined) row.pinned = patch.pinned;
  // Folding decides what is sent to the model, so losing it on reload would
  // silently drop those turns from the request with nothing in their place.
  if (patch.folded !== undefined) row.folded = patch.folded;
  if (patch.promptTokens !== undefined) row.prompt_tokens = patch.promptTokens;
  if (patch.completionTokens !== undefined) row.completion_tokens = patch.completionTokens;
  if (patch.imageTokens !== undefined) row.image_tokens = patch.imageTokens;
  return row;
}

let cached: Promise<ChatRepo> | null = null;

/**
 * The active chat repository for this browser session, in preference order:
 *
 *   1. Supabase — only when signed in. With auth-scoped RLS (migration 0005) a
 *      signed-out client's writes are rejected and its reads come back empty,
 *      so choosing it without a session would silently discard data.
 *   2. IndexedDB — the local-first default (§1.5). Per-record writes and no
 *      practical size ceiling.
 *   3. localStorage — last resort, for environments with no IndexedDB (private
 *      modes, hardened browsers). Same data, worse write amplification.
 *
 * Resolved once and reused; call `resetChatRepo()` after an auth change.
 *
 * In incognito the resolved driver is wrapped read-only (see repo-private.ts).
 * The wrap happens on every call rather than being baked into the cached promise
 * so the mode can be toggled mid-session — the driver selection is cached, the
 * write policy is not.
 */
export function chatRepo(): Promise<ChatRepo> {
  return baseChatRepo().then((r) => (isIncognito() ? readOnlyRepo(r) : r));
}

function baseChatRepo(): Promise<ChatRepo> {
  if (!cached) {
    cached = (async (): Promise<ChatRepo> => {
      if (await remotePersistenceReady()) return makeSupabaseRepo();
      if (idbAvailable()) {
        try {
          const idb = makeIdbRepo();
          // Force the connection open now so a failure (blocked upgrade, denied
          // storage) surfaces here and falls back, rather than at first write.
          await idb.listConversations();
          return idb;
        } catch {
          return localRepo;
        }
      }
      return localRepo;
    })();
  }
  return cached;
}

/** Re-pick the driver after a sign-in or sign-out. */
export function resetChatRepo(): void {
  cached = null;
}
