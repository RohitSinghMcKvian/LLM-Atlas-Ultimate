"use client";

import { getSupabaseBrowser, isSupabaseConfigured } from "@/lib/supabase/client";
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
    patch: Partial<Pick<Conversation, "title" | "pinned" | "modelId" | "projectId" | "updatedAt">>,
  ): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  listMessages(conversationId: string): Promise<ChatMessage[]>;
  addMessage(conversationId: string, msg: ChatMessage): Promise<void>;
  updateMessage(
    conversationId: string,
    id: string,
    patch: Partial<ChatMessage>,
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
    costUsd: r.cost_usd ?? undefined,
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
          cost_usd: msg.costUsd ?? null,
        });
      if (error) throw error;
      await (await db())
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId);
    },
    async updateMessage(conversationId, id, patch) {
      const row: Record<string, unknown> = {};
      if (patch.content !== undefined) row.content = patch.content;
      if (patch.reasoning !== undefined) row.reasoning = patch.reasoning;
      if (patch.toolCalls !== undefined) row.tool_calls = patch.toolCalls;
      if (patch.pinned !== undefined) return; // messages.pinned not persisted
      if (patch.promptTokens !== undefined) row.prompt_tokens = patch.promptTokens;
      if (patch.completionTokens !== undefined) row.completion_tokens = patch.completionTokens;
      if (Object.keys(row).length === 0) return;
      const { error } = await (await db()).from("messages").update(row).eq("id", id);
      if (error) throw error;
    },
  };
}

let cached: ChatRepo | null = null;

/** The active chat repository for this browser session. */
export function chatRepo(): ChatRepo {
  if (!cached) cached = isSupabaseConfigured() ? makeSupabaseRepo() : localRepo;
  return cached;
}
