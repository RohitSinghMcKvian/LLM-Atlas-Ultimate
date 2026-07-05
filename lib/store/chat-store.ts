"use client";

import { create } from "zustand";
import { chatRepo } from "@/lib/chat/repo";
import { uuid, type ChatMessage, type Conversation } from "@/lib/chat/types";
import {
  emptyTree,
  activePath,
  activeLeafId,
  putNode,
  patchNode,
  selectSibling as selectSiblingPure,
  treeFromList,
  type Tree,
} from "@/lib/chat/tree";
import { loadBranchState, saveBranchState, clearBranchState } from "@/lib/chat/branch-state";
import { messageCostUsd } from "@/lib/chat/cost";

function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 48 ? `${t.slice(0, 48)}…` : t || "New chat";
}

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  /** DAG of turns for the active conversation. */
  tree: Tree;
  /** Derived active path — what the thread renders. */
  messages: ChatMessage[];
  hydrated: boolean;
  remote: boolean;

  init: () => Promise<void>;
  select: (id: string) => Promise<void>;
  newChat: () => void;
  ensureConversation: (
    firstText: string,
    modelId?: string,
    projectId?: string | null,
  ) => Promise<string>;
  setProject: (conversationId: string, projectId: string | null) => Promise<void>;
  /**
   * Add a turn. If `msg.parentId` is undefined it attaches to the active leaf
   * (normal append); pass an explicit parentId to create a sibling branch
   * (edit / regenerate). Persists when `persist` is true.
   */
  addMessage: (msg: ChatMessage, persist?: boolean) => Promise<void>;
  patchMessage: (id: string, patch: Partial<ChatMessage>) => void;
  persistMessage: (id: string) => Promise<void>;
  /** Switch which sibling is shown at a branch point. */
  selectSibling: (id: string) => void;
  rename: (id: string, title: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const repo = () => chatRepo();

function bumpConversation(list: Conversation[], id: string): Conversation[] {
  const now = Date.now();
  return list
    .map((c) => (c.id === id ? { ...c, updatedAt: now } : c))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

/** Fold in a derived cost once tokens are known (kept alongside the node). */
function withCost(msg: ChatMessage): ChatMessage {
  if (
    msg.role === "assistant" &&
    msg.completionTokens != null &&
    msg.costUsd == null
  ) {
    return { ...msg, costUsd: messageCostUsd(msg.model, msg.promptTokens, msg.completionTokens) };
  }
  return msg;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeId: null,
  tree: emptyTree(),
  messages: [],
  hydrated: false,
  remote: false,

  async init() {
    if (get().hydrated) return;
    try {
      const conversations = await repo().listConversations();
      set({
        conversations: conversations.sort(
          (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
        ),
        hydrated: true,
        remote: repo().remote,
      });
    } catch (e) {
      console.warn("[chat] failed to load conversations", e);
      set({ hydrated: true, remote: repo().remote });
    }
  },

  async select(id) {
    if (get().activeId === id) return;
    set({ activeId: id, tree: emptyTree(), messages: [] });
    try {
      const list = await repo().listMessages(id);
      if (get().activeId !== id) return; // switched again mid-load
      const tree: Tree = { ...treeFromList(list), active: loadBranchState(id) };
      set({ tree, messages: activePath(tree) });
    } catch (e) {
      console.warn("[chat] failed to load messages", e);
    }
  },

  newChat() {
    set({ activeId: null, tree: emptyTree(), messages: [] });
  },

  async ensureConversation(firstText, modelId, projectId) {
    const existing = get().activeId;
    if (existing) return existing;
    const id = uuid();
    const now = Date.now();
    const conv: Conversation = {
      id,
      title: titleFrom(firstText),
      modelId,
      projectId: projectId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ conversations: [conv, ...s.conversations], activeId: id }));
    try {
      await repo().createConversation({ id, title: conv.title, modelId, projectId });
    } catch (e) {
      console.warn("[chat] failed to create conversation", e);
    }
    return id;
  },

  async setProject(conversationId, projectId) {
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, projectId } : c,
      ),
    }));
    try {
      await repo().updateConversation(conversationId, { projectId });
    } catch (e) {
      console.warn("[chat] failed to set project", e);
    }
  },

  async addMessage(msg, persist = false) {
    const node = withCost(
      msg.parentId === undefined ? { ...msg, parentId: activeLeafId(get().tree) } : msg,
    );
    set((s) => {
      const tree = putNode(s.tree, node);
      return { tree, messages: activePath(tree) };
    });
    const convId = get().activeId;
    if (convId) saveBranchState(convId, get().tree.active);
    if (persist && convId) {
      try {
        await repo().addMessage(convId, node);
        set((s) => ({ conversations: bumpConversation(s.conversations, convId) }));
      } catch (e) {
        console.warn("[chat] failed to persist message", e);
      }
    }
  },

  patchMessage(id, patch) {
    set((s) => {
      const cur = s.tree.nodes[id];
      if (!cur) return s;
      const merged = withCost({ ...cur, ...patch });
      const tree = patchNode(s.tree, id, merged);
      return { tree, messages: activePath(tree) };
    });
  },

  async persistMessage(id) {
    const convId = get().activeId;
    const msg = get().tree.nodes[id];
    if (!convId || !msg) return;
    try {
      await repo().addMessage(convId, msg);
      set((s) => ({ conversations: bumpConversation(s.conversations, convId) }));
    } catch (e) {
      console.warn("[chat] failed to persist message", e);
    }
  },

  selectSibling(id) {
    set((s) => {
      const active = selectSiblingPure(s.tree, id);
      const tree: Tree = { ...s.tree, active };
      return { tree, messages: activePath(tree) };
    });
    const convId = get().activeId;
    if (convId) saveBranchState(convId, get().tree.active);
  },

  async rename(id, title) {
    const clean = title.trim() || "Untitled";
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, title: clean } : c,
      ),
    }));
    try {
      await repo().updateConversation(id, { title: clean });
    } catch (e) {
      console.warn("[chat] failed to rename", e);
    }
  },

  async togglePin(id) {
    const conv = get().conversations.find((c) => c.id === id);
    if (!conv) return;
    const pinned = !conv.pinned;
    set((s) => ({
      conversations: s.conversations
        .map((c) => (c.id === id ? { ...c, pinned } : c))
        .sort(
          (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
        ),
    }));
    try {
      await repo().updateConversation(id, { pinned });
    } catch (e) {
      console.warn("[chat] failed to pin", e);
    }
  },

  async remove(id) {
    const wasActive = get().activeId === id;
    clearBranchState(id);
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      ...(wasActive ? { activeId: null, tree: emptyTree(), messages: [] } : {}),
    }));
    try {
      await repo().deleteConversation(id);
    } catch (e) {
      console.warn("[chat] failed to delete", e);
    }
  },
}));
